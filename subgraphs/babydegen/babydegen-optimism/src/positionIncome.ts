import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts"
import {
  ProtocolPosition,
  NFTPositionMapping,
  UncollectedPrincipal,
  ClaimableRewardBeforeBlock,
  CreditedRewardClaim,
  Service
} from "../generated/schema"
import { PROTOCOL_VELODROME_V3, PROTOCOL_AERO_CL, PROTOCOL_AERO_V2, rewardTokenFor } from "./constants"
import { getTokenPriceUSD } from "./priceDiscovery"
import { convertTokenAmount } from "./tokenUtils"
import { uintAt, addressAt } from "./common"
import { saveWithROI } from "./roiCalculation"

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

function minBigInt(a: BigInt, b: BigInt): BigInt {
  return a.lt(b) ? a : b
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
  let fee0Human = convertTokenAmount(fee0, token0)
  let fee1Human = convertTokenAmount(fee1, token1)
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
  let total = sum(weights)
  for (let i = 0; i < positions.length; i++) {
    creditReward(positions[i], amount.times(weights[i]).div(total), priceUSD)
  }
}

function lastClosedV2Position(positions: ProtocolPosition[]): ProtocolPosition | null {
  let last: ProtocolPosition | null = null
  for (let i = 0; i < positions.length; i++) {
    let position = positions[i]
    let exitTimestamp = position.exitTimestamp
    if (position.isActive || position.protocol == PROTOCOL_VELODROME_V3 || exitTimestamp === null) {
      continue
    }
    if (last === null || exitTimestamp!.gt(last!.exitTimestamp!)) {
      last = position
    }
  }
  return last
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

function isEmittedByGauge(position: ProtocolPosition, emitter: Address): boolean {
  let gauge = position.rewardsContract
  return gauge !== null && Address.fromBytes(gauge!).equals(emitter)
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
  if (!event.address.equals(rewardTokenFor(PROTOCOL_AERO_CL))) {
    return false
  }
  let paid = BigInt.zero()
  let credited = false
  let logs = receipt.logs
  for (let i = 0; i < logs.length; i++) {
    let topics = logs[i].topics
    if (topics.length < 4 || !topics[0].equals(EMISSIONS_CLAIMED_TOPIC) || !addressAt(topics[3], 0).equals(safe)) {
      continue
    }
    let claimAmount = uintAt(logs[i].data, 0)
    let claimId = event.transaction.hash.concatI32(logs[i].logIndex.toI32())
    if (CreditedRewardClaim.load(claimId) != null) {
      continue
    }
    let tokenId = uintAt(topics[2], 0)
    if (paid.plus(claimAmount).gt(amount)) {
      log.warning("REWARDS: tx {} — EmissionsClaimed for tokenId {} ({}) is not covered by the Transfer of {} to safe {}", [
        event.transaction.hash.toHexString(), tokenId.toString(), claimAmount.toString(), amount.toString(), safe.toHexString()
      ])
      continue
    }
    let position = loadMappedPosition(PROTOCOL_AERO_CL, tokenId)
    if (position == null || !Address.fromBytes(position.agent).equals(safe) || !isEmittedByGauge(position, logs[i].address)) {
      log.warning("REWARDS: tx {} — EmissionsClaimed to safe {} names tokenId {}, which is not one of its aero-cl positions on the emitting gauge", [
        event.transaction.hash.toHexString(), safe.toHexString(), tokenId.toString()
      ])
      continue
    }
    new CreditedRewardClaim(claimId).save()
    creditReward(position, convertTokenAmount(claimAmount, event.address), getTokenPriceUSD(event.address, event.block.timestamp, false))
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

// Aero v2 gauges pay through LeafEmissionsHandler (Optimism) or by mint (Base), not from the gauge,
// and their claims are not attributed to a position yet: say so rather than drop the reward silently
function warnIfAeroV2Reward(event: ethereum.Event, safe: Address, service: Service): void {
  if (!event.address.equals(rewardTokenFor(PROTOCOL_AERO_V2))) {
    return
  }
  let positionIds = service.positionIds
  for (let i = 0; i < positionIds.length; i++) {
    let position = ProtocolPosition.load(positionIds[i])
    // A closed position counts too: a v2 gauge reward is often claimed after the exit
    if (position != null && position.protocol == PROTOCOL_AERO_V2) {
      log.warning("REWARDS: tx {} — Aero reward Transfer to safe {}, which holds or held aero-v2 positions, is not attributed to a position", [
        event.transaction.hash.toHexString(),
        safe.toHexString()
      ])
      return
    }
  }
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
        topics.length < 3 || !topics[0].equals(CL_GAUGE_WITHDRAW_TOPIC) || !addressAt(topics[1], 0).equals(safe)) {
      continue
    }
    return uintAt(topics[2], 0)
  }
  return null
}

// Credits a reward token Transfer into a Safe to the position(s) that earned it. Returns false
// when the Transfer is not a reward claim, or when the event has no receipt (`receipt: true`).
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
    if (position != null && isEmittedByGauge(position, from)) {
      onGauge.push(position)
    }
  }
  if (onGauge.length == 0) {
    warnIfAeroV2Reward(event, safe, service)
    return false
  }

  let rewardAmount = convertTokenAmount(amount, event.address)
  let priceUSD = getTokenPriceUSD(event.address, event.block.timestamp, false)

  let tokenId = nextGaugeWithdrawTokenId(event, from, safe, receipt)
  if (tokenId !== null) {
    for (let i = 0; i < onGauge.length; i++) {
      if (onGauge[i].protocol == PROTOCOL_VELODROME_V3 && onGauge[i].tokenId.equals(tokenId)) {
        creditReward(onGauge[i], rewardAmount, priceUSD)
        return true
      }
    }
    // The reward belongs to that tokenId; splitting it would credit positions that did not earn it
    log.warning("REWARDS: tx {} - gauge {} Withdraw names tokenId {}, not a tracked position of safe {}; reward not attributed", [
      event.transaction.hash.toHexString(),
      from.toHexString(),
      tokenId!.toString(),
      safe.toHexString()
    ])
    return true
  }

  // No Withdraw after the reward: a CL getReward(tokenId) claim splits by what each position had
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
    // A v2 gauge holds one LP position per pool and pays its reward on a later getReward, after the exit
    let closedV2 = lastClosedV2Position(onGauge)
    if (closedV2 !== null) {
      creditReward(closedV2!, rewardAmount, priceUSD)
      return true
    }
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
