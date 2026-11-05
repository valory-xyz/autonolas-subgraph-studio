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

// Transfer(address,address,uint256) — ERC-20 and ERC-721 share the topic; topics[2] is `to` in both
export const TRANSFER_TOPIC = Bytes.fromHexString("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
// SafeReceived(address,uint256)
export const SAFE_RECEIVED_TOPIC = Bytes.fromHexString("0x3d0ce9bfc3ed7d6862dbb28b2dea94561fe714a1b4d019aa8af39730d1ad7c3d")

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
  addressType.isSafe = isContract && !GnosisSafe.bind(addr).try_getThreshold().reverted
  addressType.checkedAt = block.number
  addressType.save()
  return addressType
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

// The user's side of a funding flow: the operator Safe, any other Safe, or an EOA that is not
// one of the service's agent EOAs (gas sent to those is a cost, not a withdrawal)
export function isUserSide(
  addr: Address,
  serviceSafe: Address,
  event: ethereum.Event,
  readAddressType: AddressTypeReader
): boolean {
  let service = getServiceByAgent(serviceSafe)
  if (service == null) {
    log.warning("[FUNDING_SOURCE] No service found for safe {}", [serviceSafe.toHexString()])
    return false
  }
  if (isServiceOwnAddress(addr, serviceSafe, service)) {
    return false
  }
  // The tx sender is always an EOA, though an EIP-7702 one has code and is no Safe
  if (addr.equals(Address.fromBytes(service.operatorSafe)) || addr.equals(event.transaction.from)) {
    return true
  }
  let addressType = readAddressType(addr, event.block)
  return !addressType.isContract || addressType.isSafe
}

export const ABI_WORD = 32

// The uint256 in the ABI word at `offset`
export function uintAt(bytes: Uint8Array, offset: i32): BigInt {
  return BigInt.fromUnsignedBytes(changetype<Bytes>(bytes.slice(offset, offset + ABI_WORD).reverse()))
}

// The address in the ABI word at `offset` (its last 20 bytes)
export function addressAt(bytes: Uint8Array, offset: i32): Address {
  return Address.fromBytes(Bytes.fromUint8Array(bytes.subarray(offset + 12, offset + ABI_WORD)))
}

// True when the receipt shows anything coming back to the Safe: an ERC-20 / ERC-721 Transfer
// to it, or its own SafeReceived. Outflows in such a tx are swaps or LP entries.
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
  }
  return false
}

// An outflow to `addr` is a withdrawal when `addr` is the user side, or a contract that sent
// nothing back to the Safe in the same tx (e.g. an EIP-7702 wallet). Needs `receipt: true`.
export function isWithdrawalRecipient(
  addr: Address,
  serviceSafe: Address,
  event: ethereum.Event,
  readAddressType: AddressTypeReader
): boolean {
  if (isUserSide(addr, serviceSafe, event, readAddressType)) {
    return true
  }
  let service = getServiceByAgent(serviceSafe)
  if (service == null || isServiceOwnAddress(addr, serviceSafe, service)) {
    return false
  }
  let receipt = event.receipt
  if (receipt == null) {
    log.warning("[WITHDRAWAL] No receipt for tx {} — outflow to contract {} not counted", [
      event.transaction.hash.toHexString(),
      addr.toHexString()
    ])
    return false
  }
  return !receiptHasInflowTo(serviceSafe, receipt)
}

// Legacy isSafe function - now checks if address is any service safe
export function isSafe(addr: Address, txHash: string = ""): boolean {
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
