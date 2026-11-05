import { createMockedFunction, newMockEvent } from "matchstick-as/assembly/index"
import { Address, BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { Transfer } from "../generated/USDC_Native/ERC20"
import { AddressType, NFTPositionMapping, ProtocolPosition, Service, Token } from "../generated/schema"
import { initializePositionIncome } from "../src/roiCalculation"
import { USDC_USD_FEED } from "../src/constants"
import { ETH_USD_FEED, ETH_PRICE_RAW, BLOCK_NUMBER, BLOCK_TIMESTAMP, TX_HASH, SERVICE_ID } from "./test-helpers"

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

export function word(value: string): Bytes {
  return Bytes.fromHexString(value)
}

export function newLog(address: string, topics: string[], data: string, logIndex: i32): ethereum.Log {
  let topicBytes: Bytes[] = []
  for (let i = 0; i < topics.length; i++) {
    topicBytes.push(word(topics[i]))
  }
  return new ethereum.Log(
    Address.fromString(address), topicBytes, word(data), TX_HASH, Bytes.fromI32(1), TX_HASH,
    BigInt.zero(), BigInt.fromI32(logIndex), BigInt.fromI32(logIndex), "", null
  )
}

export function newReceipt(logs: ethereum.Log[]): ethereum.TransactionReceipt {
  return new ethereum.TransactionReceipt(
    TX_HASH, BigInt.zero(), TX_HASH, BLOCK_NUMBER, BigInt.zero(), BigInt.zero(),
    Address.zero(), logs, BigInt.fromI32(1), Bytes.empty(), Bytes.empty()
  )
}

export function newTransfer(
  token: Address,
  from: Address,
  to: Address,
  value: BigInt,
  logIndex: i32,
  receipt: ethereum.TransactionReceipt | null
): Transfer {
  let mock = newMockEvent()
  let event = new Transfer(
    token, BigInt.fromI32(logIndex), BigInt.fromI32(logIndex), mock.logType,
    mock.block, mock.transaction, [], receipt
  )
  event.parameters.push(new ethereum.EventParam("from", ethereum.Value.fromAddress(from)))
  event.parameters.push(new ethereum.EventParam("to", ethereum.Value.fromAddress(to)))
  event.parameters.push(new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(value)))
  event.block.number = BLOCK_NUMBER
  event.block.timestamp = BLOCK_TIMESTAMP
  event.transaction.hash = TX_HASH
  return event
}

export function mockEthUsd(): void {
  createMockedFunction(ETH_USD_FEED, "latestRoundData", "latestRoundData():(uint80,int256,uint256,uint256,uint80)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
      ethereum.Value.fromSignedBigInt(ETH_PRICE_RAW),
      ethereum.Value.fromUnsignedBigInt(BLOCK_TIMESTAMP),
      ethereum.Value.fromUnsignedBigInt(BLOCK_TIMESTAMP),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))
    ])
}

// The USDC/USD feed at $1: a USDC-paired pool's price is read against it
export function mockUsdcUsd(): void {
  createMockedFunction(USDC_USD_FEED, "latestRoundData", "latestRoundData():(uint80,int256,uint256,uint256,uint80)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
      ethereum.Value.fromSignedBigInt(BigInt.fromI32(100000000)),
      ethereum.Value.fromUnsignedBigInt(BLOCK_TIMESTAMP),
      ethereum.Value.fromUnsignedBigInt(BLOCK_TIMESTAMP),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))
    ])
}

export function seedService(safe: Address, operator: Address, agentInstance: Address): void {
  let s = new Service(safe)
  s.serviceId = SERVICE_ID
  s.operatorSafe = operator
  s.serviceSafe = safe
  s.latestRegistrationBlock = BLOCK_NUMBER
  s.latestRegistrationTimestamp = BLOCK_TIMESTAMP
  s.latestRegistrationTxHash = TX_HASH
  s.latestMultisigBlock = BLOCK_NUMBER
  s.latestMultisigTimestamp = BLOCK_TIMESTAMP
  s.latestMultisigTxHash = TX_HASH
  s.isActive = true
  s.createdAt = BLOCK_TIMESTAMP
  s.updatedAt = BLOCK_TIMESTAMP
  s.positionIds = []
  s.agentInstances = [agentInstance]
  s.save()
}

// A cached AddressType means no hasCode / getThreshold call is made
export function seedAddressType(addr: Address, isContract: boolean, isSafe: boolean): void {
  let t = new AddressType(addr)
  t.isContract = isContract
  t.isSafe = isSafe
  t.checkedAt = BLOCK_NUMBER
  t.save()
}

// A fresh cached price: getTokenPriceUSD returns it without calling any source
export function seedTokenPrice(token: Address, symbol: string, decimals: i32, price: string, lastUpdate: BigInt = BLOCK_TIMESTAMP): void {
  let t = new Token(token)
  t.symbol = symbol
  t.name = symbol
  t.decimals = BigInt.fromI32(decimals)
  t.derivedUSD = BigDecimal.fromString(price)
  t.priceSources = []
  t.lastPriceUpdate = lastUpdate
  t.priceConfidence = BigDecimal.fromString("0.99")
  t.priceStale = false
  t.depegged = false
  t.save()
}

export function seedPosition(
  safe: Address,
  protocol: string,
  tokenId: BigInt,
  token0: Address,
  token1: Address,
  gauge: Address | null,
  liquidity: BigInt,
  claimableReward: string
): ProtocolPosition {
  let id = Bytes.fromUTF8(safe.toHexString() + "-" + protocol + "-" + tokenId.toString())
  let p = new ProtocolPosition(id)
  p.agent = safe
  p.service = safe
  p.protocol = protocol
  p.pool = Address.zero()
  p.isActive = true
  p.usdCurrent = BigDecimal.zero()
  p.usdCurrentWithRewards = BigDecimal.zero()
  p.token0 = token0
  p.token1 = token1
  p.amount0USD = BigDecimal.zero()
  p.amount1USD = BigDecimal.zero()
  p.liquidity = liquidity
  p.claimableReward = BigDecimal.fromString(claimableReward)
  p.claimableRewardUSD = BigDecimal.zero()
  p.tokenId = tokenId
  if (gauge !== null) {
    p.rewardsContract = gauge
  }
  p.tickLower = 0
  p.tickUpper = 0
  p.entryTxHash = TX_HASH
  p.entryTimestamp = BLOCK_TIMESTAMP
  p.entryAmount0 = BigDecimal.zero()
  p.entryAmount0USD = BigDecimal.zero()
  p.entryAmount1 = BigDecimal.zero()
  p.entryAmount1USD = BigDecimal.zero()
  p.entryAmountUSD = BigDecimal.fromString("100")
  p.totalCostsUSD = BigDecimal.zero()
  p.swapSlippageUSD = BigDecimal.zero()
  p.investmentUSD = BigDecimal.fromString("100")
  p.grossGainUSD = BigDecimal.zero()
  p.netGainUSD = BigDecimal.zero()
  p.positionROI = BigDecimal.zero()
  initializePositionIncome(p)
  p.save()

  let mapping = new NFTPositionMapping(Bytes.fromUTF8(protocol + "-" + tokenId.toString()))
  mapping.protocol = protocol
  mapping.positionId = id
  mapping.save()

  let service = Service.load(safe)!
  let ids = service.positionIds
  ids.push(id)
  service.positionIds = ids
  service.save()
  return p
}

// Stands in for getAddressType: every counterparty a test touches must be seeded
export function seededAddressType(addr: Address, block: ethereum.Block): AddressType {
  return AddressType.load(addr)!
}
