import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts"
import {
  ProtocolPosition,
  NFTPositionMapping,
  UncollectedPrincipal,
  ClaimableRewardBeforeBlock,
  CreditedRewardClaim,
  Service
} from "../generated/schema"
import { PROTOCOL_VELODROME_V3, PROTOCOL_AERO_CL, AERO_CL_EMISSION_TOKEN } from "./constants"
import { getTokenPriceUSD } from "./priceDiscovery"
import { getTokenDecimals } from "./tokenUtils"
import { calculatePositionROI } from "./roiCalculation"

// Withdraw(address indexed user, uint256 indexed tokenId, uint128 indexed liquidityToStake) — Velodrome CL gauge
const CL_GAUGE_WITHDRAW_TOPIC = Bytes.fromHexString("0x8903a5b5d08a841e7f68438387f1da20c84dea756379ed37e633ff3854b99b84")
// EmissionsClaimed(address indexed _account, uint256 indexed _tokenId, address indexed _recipient, uint256 _rewardAmount) — Aero CL gauge
const EMISSIONS_CLAIMED_TOPIC = Bytes.fromHexString("0x7b6bd720815adbeaaaed4fc759e1a535705901f33709fbb33e62ee9a89427bb1")

export function nftPositionMappingId(protocol: string, tokenId: BigInt): Bytes {
  return Bytes.fromUTF8(protocol + "-" + tokenId.toString())
}

export function mapNFTPosition(protocol: string, tokenId: BigInt, positionId: Bytes): void {
  let id = nftPositionMappingId(protocol, tokenId)
  if (NFTPositionMapping.load(id) == null) {
    let mapping = new NFTPositionMapping(id)
    mapping.protocol = protocol
    mapping.positionId = positionId
    mapping.save()
  }
}

// The tracked position an NFT event refers to, or null when no service owns it
export function loadMappedPosition(protocol: string, tokenId: BigInt): ProtocolPosition | null {
  let mapping = NFTPositionMapping.load(nftPositionMappingId(protocol, tokenId))
  return mapping != null ? ProtocolPosition.load(mapping.positionId) : null
}

function toHuman(amount: BigInt, token: Address): BigDecimal {
  return amount.toBigDecimal().div(BigDecimal.fromString("1e" + getTokenDecimals(token).toString()))
}

function wordToBigInt(word: Bytes): BigInt {
  return BigInt.fromUnsignedBytes(changetype<Bytes>(word.slice(0, 32).reverse()))
}

function wordToAddress(word: Bytes): Address {
  return Address.fromBytes(changetype<Bytes>(word.subarray(12, 32)))
}

function minBigInt(a: BigInt, b: BigInt): BigInt {
  return a.lt(b) ? a : b
}

function saveWithROI(position: ProtocolPosition): void {
  if (!position.isActive && position.exitAmountUSD) {
    calculatePositionROI(position)
  }
  position.save()
}

// ---------------------------------------------------------------------------
// Collected fees
// ---------------------------------------------------------------------------

// DecreaseLiquidity only credits principal to tokensOwed; the next Collect pays it out with the fees
export function recordReleasedPrincipal(protocol: string, tokenId: BigInt, amount0: BigInt, amount1: BigInt): void {
  let id = nftPositionMappingId(protocol, tokenId)
  let owed = UncollectedPrincipal.load(id)
  if (owed == null) {
    owed = new UncollectedPrincipal(id)
    owed.amount0 = BigInt.zero()
    owed.amount1 = BigInt.zero()
  }
  owed.amount0 = owed.amount0.plus(amount0)
  owed.amount1 = owed.amount1.plus(amount1)
  owed.save()
}

export function recordCollectedFees(
  position: ProtocolPosition,
  protocol: string,
  recipient: Address,
  amount0: BigInt,
  amount1: BigInt,
  timestamp: BigInt
): void {
  // Every Collect pays out owed principal first, wherever it is sent, so a later Collect to the Safe is not read as principal
  let fee0 = amount0
  let fee1 = amount1
  let owed = UncollectedPrincipal.load(nftPositionMappingId(protocol, position.tokenId))
  if (owed != null) {
    let principal0 = minBigInt(amount0, owed.amount0)
    let principal1 = minBigInt(amount1, owed.amount1)
    fee0 = amount0.minus(principal0)
    fee1 = amount1.minus(principal1)
    owed.amount0 = owed.amount0.minus(principal0)
    owed.amount1 = owed.amount1.minus(principal1)
    owed.save()
  }

  let token0Bytes = position.token0
  let token1Bytes = position.token1
  if (!recipient.equals(Address.fromBytes(position.agent)) || !token0Bytes || !token1Bytes) {
    return
  }

  let token0 = Address.fromBytes(token0Bytes!)
  let token1 = Address.fromBytes(token1Bytes!)
  let fee0Human = toHuman(fee0, token0)
  let fee1Human = toHuman(fee1, token1)
  let feeUSD = fee0Human.times(getTokenPriceUSD(token0, timestamp, false))
    .plus(fee1Human.times(getTokenPriceUSD(token1, timestamp, false)))

  position.collectedFees0 = position.collectedFees0.plus(fee0Human)
  position.collectedFees1 = position.collectedFees1.plus(fee1Human)
  position.collectedFeesUSD = position.collectedFeesUSD.plus(feeUSD)
  saveWithROI(position)
}

// ---------------------------------------------------------------------------
// Claimed rewards
// ---------------------------------------------------------------------------

// A claim's own block refreshes earned() to 0, so keep the value the block started with
export function recordClaimableRewardBeforeBlock(position: ProtocolPosition, block: ethereum.Block): void {
  let before = ClaimableRewardBeforeBlock.load(position.id)
  if (before != null && before.block.equals(block.number)) {
    return
  }
  if (before == null) {
    before = new ClaimableRewardBeforeBlock(position.id)
  }
  before.block = block.number
  let claimable = position.claimableReward
  before.claimableReward = claimable ? claimable : BigDecimal.zero()
  before.save()
}

function claimableRewardBeforeBlock(position: ProtocolPosition, block: ethereum.Block): BigDecimal {
  let before = ClaimableRewardBeforeBlock.load(position.id)
  if (before != null && before.block.equals(block.number)) {
    return before.claimableReward
  }
  let claimable = position.claimableReward
  return claimable ? claimable : BigDecimal.zero()
}

function creditReward(position: ProtocolPosition, amount: BigDecimal, priceUSD: BigDecimal): void {
  position.claimedRewards = position.claimedRewards.plus(amount)
  position.claimedRewardsUSD = position.claimedRewardsUSD.plus(amount.times(priceUSD))
  saveWithROI(position)
}

function splitReward(positions: ProtocolPosition[], weights: BigDecimal[], amount: BigDecimal, priceUSD: BigDecimal): void {
  let total = BigDecimal.zero()
  for (let i = 0; i < weights.length; i++) {
    total = total.plus(weights[i])
  }
  for (let i = 0; i < positions.length; i++) {
    creditReward(positions[i], amount.times(weights[i]).div(total), priceUSD)
  }
}

function liquidityWeights(positions: ProtocolPosition[]): BigDecimal[] {
  let weights: BigDecimal[] = []
  for (let i = 0; i < positions.length; i++) {
    let liquidity = positions[i].liquidity
    weights.push(liquidity ? liquidity.toBigDecimal() : BigDecimal.zero())
  }
  return weights
}

function sum(values: BigDecimal[]): BigDecimal {
  let total = BigDecimal.zero()
  for (let i = 0; i < values.length; i++) {
    total = total.plus(values[i])
  }
  return total
}

// Aero CL: each EmissionsClaimed to the Safe names its tokenId and amount. One claimEmissions over
// several tokenIds pays them all with a single Transfer, sent by whoever (xAERO comes from
// LeafEmissionsHandler, Base AERO is minted), so a Transfer pays the claims its amount covers
function attributeEmissionsClaims(
  event: ethereum.Event,
  safe: Address,
  amount: BigInt,
  receipt: ethereum.TransactionReceipt
): boolean {
  if (!event.address.equals(AERO_CL_EMISSION_TOKEN)) {
    return false
  }
  let paid = BigInt.zero()
  let credited = false
  let logs = receipt.logs
  for (let i = 0; i < logs.length; i++) {
    let topics = logs[i].topics
    if (topics.length < 4 || !topics[0].equals(EMISSIONS_CLAIMED_TOPIC) || !wordToAddress(topics[3]).equals(safe)) {
      continue
    }
    let claimAmount = wordToBigInt(logs[i].data)
    let claimId = event.transaction.hash.concatI32(logs[i].logIndex.toI32())
    if (paid.plus(claimAmount).gt(amount) || CreditedRewardClaim.load(claimId) != null) {
      continue
    }
    let position = loadMappedPosition(PROTOCOL_AERO_CL, wordToBigInt(topics[2]))
    if (position == null || !Address.fromBytes(position.agent).equals(safe)) {
      continue
    }
    new CreditedRewardClaim(claimId).save()
    creditReward(position, toHuman(claimAmount, event.address), getTokenPriceUSD(event.address, event.block.timestamp, false))
    paid = paid.plus(claimAmount)
    credited = true
  }
  if (credited && paid.lt(amount)) {
    log.warning("REWARDS: tx {} — {} of {} paid to safe {} not attributed to a tokenId", [
      event.transaction.hash.toHexString(),
      amount.minus(paid).toString(),
      amount.toString(),
      safe.toHexString()
    ])
  }
  return credited
}

// The tokenId of the first Withdraw(user = Safe, tokenId, …) the gauge emits after the reward Transfer
function nextGaugeWithdrawTokenId(
  event: ethereum.Event,
  gauge: Address,
  safe: Address,
  receipt: ethereum.TransactionReceipt
): BigInt | null {
  let logs = receipt.logs
  for (let i = 0; i < logs.length; i++) {
    let topics = logs[i].topics
    if (logs[i].logIndex.le(event.logIndex) || !logs[i].address.equals(gauge) ||
        topics.length < 3 || !topics[0].equals(CL_GAUGE_WITHDRAW_TOPIC) || !wordToAddress(topics[1]).equals(safe)) {
      continue
    }
    return wordToBigInt(topics[2])
  }
  return null
}

// Credits a reward token Transfer into a Safe to the position(s) that earned it. Returns false
// when the Transfer is not a reward claim. Needs the event's receipt (`receipt: true`).
export function attributeRewardTransfer(event: ethereum.Event, from: Address, safe: Address, amount: BigInt): boolean {
  let receipt = event.receipt
  if (receipt == null) {
    log.warning("REWARDS: no receipt for tx {} — Transfer to safe {} not checked for a reward claim", [
      event.transaction.hash.toHexString(),
      safe.toHexString()
    ])
    return false
  }
  if (attributeEmissionsClaims(event, safe, amount, receipt)) {
    return true
  }

  let service = Service.load(safe)
  if (service == null) {
    return false
  }
  let onGauge: ProtocolPosition[] = []
  let positionIds = service.positionIds
  for (let i = 0; i < positionIds.length; i++) {
    let position = ProtocolPosition.load(positionIds[i])
    if (position == null) {
      continue
    }
    let gauge = position.rewardsContract
    if (gauge && Address.fromBytes(gauge!).equals(from)) {
      onGauge.push(position)
    }
  }
  if (onGauge.length == 0) {
    return false
  }

  let rewardAmount = toHuman(amount, event.address)
  let priceUSD = getTokenPriceUSD(event.address, event.block.timestamp, false)

  let tokenId = nextGaugeWithdrawTokenId(event, from, safe, receipt)
  if (tokenId !== null) {
    for (let i = 0; i < onGauge.length; i++) {
      if (onGauge[i].protocol == PROTOCOL_VELODROME_V3 && onGauge[i].tokenId.equals(tokenId)) {
        creditReward(onGauge[i], rewardAmount, priceUSD)
        return true
      }
    }
  }

  // No tokenId in the receipt: a CL getReward(tokenId) claim splits by what each position had
  // earned before the claim, a v2 gauge (one LP position per pool) by liquidity
  let active: ProtocolPosition[] = []
  let earnedBefore: BigDecimal[] = []
  let hasCL = false
  for (let i = 0; i < onGauge.length; i++) {
    if (onGauge[i].isActive) {
      active.push(onGauge[i])
      earnedBefore.push(claimableRewardBeforeBlock(onGauge[i], event.block))
      hasCL = hasCL || onGauge[i].protocol == PROTOCOL_VELODROME_V3
    }
  }
  if (active.length == 0) {
    log.warning("REWARDS: no active position on gauge {} for safe {} — reward in tx {} not attributed", [
      from.toHexString(),
      safe.toHexString(),
      event.transaction.hash.toHexString()
    ])
    return true
  }
  let weights = hasCL && sum(earnedBefore).gt(BigDecimal.zero()) ? earnedBefore : liquidityWeights(active)
  if (sum(weights).equals(BigDecimal.zero())) {
    weights = []
    for (let i = 0; i < active.length; i++) {
      weights.push(BigDecimal.fromString("1"))
    }
  }
  splitReward(active, weights, rewardAmount, priceUSD)
  return true
}
