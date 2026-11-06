import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts"
import { AggregatorV3Interface } from "../generated/templates/Safe/AggregatorV3Interface"
import { GnosisSafe } from "../generated/templates/Safe/GnosisSafe"
import { AddressType, Service } from "../generated/schema"
import { 
  ETH_USD_FEED,
  USDC_USD_FEED,
  getServiceByAgent
} from "./config"
import { getTokenPriceUSD } from "./priceDiscovery"
import { calculatePortfolioMetrics } from "./helpers"
import { WETH } from "./constants"

// Transfer(address,address,uint256) — ERC-20 and ERC-721 share the topic; topics[2] is `to` in both
const TRANSFER_TOPIC = Bytes.fromHexString("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
// SafeReceived(address,uint256)
const SAFE_RECEIVED_TOPIC = Bytes.fromHexString("0x3d0ce9bfc3ed7d6862dbb28b2dea94561fe714a1b4d019aa8af39730d1ad7c3d")
// WETH9 Deposit(address indexed dst, uint256 wad): wrapping emits this, not a Transfer
const WETH_DEPOSIT_TOPIC = Bytes.fromHexString("0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c")

export function isEOA(addr: Address, block: ethereum.Block, txHash: string = ""): boolean {
  // Use the official Graph Protocol method to check if address has code
  let hasCode = ethereum.hasCode(addr).inner
  let isEOA = !hasCode // Invert: hasCode=true means contract, so isEOA=false
  
  return isEOA
}

// Reads whether an address has code and is a Safe. Handlers pass getAddressType; Matchstick has
// no ethereum.hasCode, so tests pass a reader over AddressType rows they seeded.
export type AddressTypeReader = (addr: Address, block: ethereum.Block) => AddressType

// Cached code / Safe check to avoid repeated RPC calls
export function getAddressType(addr: Address, block: ethereum.Block): AddressType {
  let addressType = AddressType.load(addr)
  if (addressType != null) {
    return addressType
  }

  let isContract = ethereum.hasCode(addr).inner
  addressType = new AddressType(addr)
  addressType.isContract = isContract
  addressType.isSafe = isSafeContract(addr, isContract)
  addressType.checkedAt = block.number
  addressType.save()
  return addressType
}

export function isSafeContract(addr: Address, isContract: boolean): boolean {
  return isContract && !GnosisSafe.bind(addr).try_getThreshold().reverted
}

export function containsAddress(list: Bytes[], addr: Bytes): boolean {
  for (let i = 0; i < list.length; i++) {
    if (list[i].equals(addr)) {
      return true
    }
  }
  return false
}

// The service's own side: its Safe, its agent EOAs, or the zero address (mint / burn)
function isServiceOwnAddress(addr: Address, serviceSafe: Address, service: Service): boolean {
  return addr.equals(serviceSafe) || addr.equals(Address.zero()) || containsAddress(service.agentInstances, addr)
}

function loadFundingService(serviceSafe: Address): Service | null {
  let service = getServiceByAgent(serviceSafe)
  if (service == null) {
    log.warning("[FUNDING_SOURCE] No service found for safe {}", [serviceSafe.toHexString()])
  }
  return service
}

// The user's side, once the service's own addresses are ruled out: the operator Safe, the tx
// sender (always an EOA, though an EIP-7702 one has code and is no Safe), any other Safe, or an EOA
function isUserSideOther(addr: Address, service: Service, event: ethereum.Event, readAddressType: AddressTypeReader): boolean {
  if (addr.equals(Address.fromBytes(service.operatorSafe)) || addr.equals(event.transaction.from)) {
    return true
  }
  let addressType = readAddressType(addr, event.block)
  return !addressType.isContract || addressType.isSafe
}

// Gas sent to an agent EOA is a cost, not a withdrawal
export function isUserSide(
  addr: Address,
  serviceSafe: Address,
  event: ethereum.Event,
  readAddressType: AddressTypeReader
): boolean {
  let service = loadFundingService(serviceSafe)
  if (service == null || isServiceOwnAddress(addr, serviceSafe, service)) {
    return false
  }
  return isUserSideOther(addr, service, event, readAddressType)
}

export const ABI_WORD = 32

// The uint256 in the ABI word at `offset`
export function uintAt(bytes: Uint8Array, offset: i32): BigInt {
  return BigInt.fromUnsignedBytes(changetype<Bytes>(bytes.slice(offset, offset + ABI_WORD).reverse()))
}

// An address fills the last 20 bytes of its ABI word
const ADDRESS_PADDING = 12

// The address in the ABI word at `offset`
export function addressAt(bytes: Uint8Array, offset: i32): Address {
  return Address.fromBytes(Bytes.fromUint8Array(bytes.subarray(offset + ADDRESS_PADDING, offset + ABI_WORD)))
}

// True when the receipt shows anything coming back to the Safe: an ERC-20 / ERC-721 Transfer
// to it, a WETH Deposit for it (wrapping), or its own SafeReceived. Outflows in such a tx are
// swaps, wraps or LP entries.
function receiptHasInflowTo(safe: Address, receipt: ethereum.TransactionReceipt): boolean {
  let logs = receipt.logs
  for (let i = 0; i < logs.length; i++) {
    let topics = logs[i].topics
    if (topics.length >= 3 && topics[0].equals(TRANSFER_TOPIC) &&
        addressAt(topics[2], 0).equals(safe)) {
      return true
    }
    if (topics.length >= 1 && topics[0].equals(SAFE_RECEIVED_TOPIC) && logs[i].address.equals(safe)) {
      return true
    }
    if (topics.length >= 2 && topics[0].equals(WETH_DEPOSIT_TOPIC) && logs[i].address.equals(WETH) &&
        addressAt(topics[1], 0).equals(safe)) {
      return true
    }
  }
  return false
}

// An outflow to `addr` is a withdrawal when `addr` is the user side, or a contract when nothing
// came back to the Safe in the same tx, from anyone (e.g. an EIP-7702 wallet). Needs `receipt: true`.
export function isWithdrawalRecipient(
  addr: Address,
  serviceSafe: Address,
  event: ethereum.Event,
  readAddressType: AddressTypeReader
): boolean {
  let service = loadFundingService(serviceSafe)
  if (service == null || isServiceOwnAddress(addr, serviceSafe, service)) {
    return false
  }
  if (isUserSideOther(addr, service, event, readAddressType)) {
    return true
  }
  let receipt = event.receipt
  if (receipt == null) {
    // Every handler that reaches this sets `receipt: true`, so a missing receipt is a manifest bug
    log.error("[WITHDRAWAL] No receipt for tx {} — outflow from safe {} to contract {} not counted", [
      event.transaction.hash.toHexString(),
      serviceSafe.toHexString(),
      addr.toHexString()
    ])
    return false
  }
  return !receiptHasInflowTo(serviceSafe, receipt)
}

// One of our service Safes (not "any Safe", which is AddressType.isSafe / isSafeContract)
export function isServiceSafe(addr: Address): boolean {
  return getServiceByAgent(addr) !== null
}

function fetchFeedUsd(feed: Address): BigDecimal {
  let oracle = AggregatorV3Interface.bind(feed)
  let round = oracle.latestRoundData()
  return round.value1.toBigDecimal().div(BigDecimal.fromString("1e8"))
}

export function getEthUsd(_b: ethereum.Block): BigDecimal {
  return fetchFeedUsd(ETH_USD_FEED)
}

export function getUsdcUsd(_b: ethereum.Block): BigDecimal {
  return BigDecimal.fromString("1.0")
}

// Generic USD price function for any token
export function getUsd(token: Address, block: ethereum.Block): BigDecimal {
  // Use hardcoded pool pricing for all whitelisted tokens
  return getTokenPriceUSD(token, block.timestamp, false)
}

// Portfolio refresh function
export function refreshPortfolio(agent: Address, block: ethereum.Block, updatePortfolio: boolean = true): void {
  if (updatePortfolio) {
    calculatePortfolioMetrics(agent, block)
  }
}
