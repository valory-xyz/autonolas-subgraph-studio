import { Address, BigDecimal, BigInt, ethereum, Bytes, log } from "@graphprotocol/graph-ts"
import { VelodromePositionNFTManager } from "../generated/VeloNFTManager/VelodromePositionNFTManager"
import { VelodromeCLPool } from "../generated/VeloNFTManager/VelodromeCLPool"
import { VelodromeCLFactory } from "../generated/VeloNFTManager/VelodromeCLFactory"
import { VeloCLGauge } from "../generated/VeloNFTManager/VeloCLGauge"
import { AeroCLGauge } from "../generated/VeloNFTManager/AeroCLGauge"
import { LiquidityAmounts } from "./libraries/LiquidityAmounts"
import { TickMath } from "./libraries/TickMath"
import { ProtocolPosition, Service, AgentSwapBuffer } from "../generated/schema"
import { getUsd, refreshPortfolio } from "./common"
import { addAgentNFTToPool, removeAgentNFTFromPool, getCachedPoolAddress, cachePoolAddress } from "./poolIndexCache"
import { getTokenPriceUSD } from "./priceDiscovery"
import {
  VELO_MANAGER,
  VELO_FACTORY,
  PROTOCOL_VELODROME_V3,
  AERO_NFT_MANAGER,
  AERO_CL_FACTORY,
  PROTOCOL_AERO_CL,
  rewardTokenFor
} from "./constants"
import { isServiceAgent, getServiceByAgent } from "./config"
import { parseTotalSlippageFromBucket, associateSwapsWithPosition } from "./helpers"
import { getTokenDecimals, getTokenSymbol, convertTokenAmount } from "./tokenUtils"
import { initializePositionCosts, calculatePositionROI, initializePositionIncome } from "./roiCalculation"
import { recordClaimableRewardBeforeBlock, nftPositionMappingId } from "./positionIncome"


// A CL position manager and what goes with it. The legacy Slipstream NFPM and Aero's share
// the positions()/pool/factory interfaces, so one refresh path serves both; the venue picks
// the contracts, the gauge reward token and the protocol label.
export class CLVenue {
  manager: Address
  factory: Address
  rewardToken: Address
  protocol: string

  constructor(manager: Address, factory: Address, rewardToken: Address, protocol: string) {
    this.manager = manager
    this.factory = factory
    this.rewardToken = rewardToken
    this.protocol = protocol
  }
}

export function clVenueFor(protocol: string): CLVenue {
  if (protocol == PROTOCOL_AERO_CL) {
    return new CLVenue(AERO_NFT_MANAGER, AERO_CL_FACTORY, rewardTokenFor(protocol), protocol)
  }
  if (protocol != PROTOCOL_VELODROME_V3) {
    log.critical("clVenueFor: '{}' is not a CL venue", [protocol])
  }
  return new CLVenue(VELO_MANAGER, VELO_FACTORY, rewardTokenFor(PROTOCOL_VELODROME_V3), PROTOCOL_VELODROME_V3)
}

export function clVenueForManager(manager: Address): CLVenue {
  if (manager.equals(AERO_NFT_MANAGER)) {
    return clVenueFor(PROTOCOL_AERO_CL)
  }
  if (!manager.equals(VELO_MANAGER)) {
    log.critical("clVenueForManager: {} is not a known CL position manager", [manager.toHexString()])
  }
  return clVenueFor(PROTOCOL_VELODROME_V3)
}

// What createVeloCLPosition needs to create a position: the NFT's owner and the venue of the
// NFPM that minted it.
export class CLPositionCreate {
  owner: Address
  venue: CLVenue

  constructor(owner: Address, venue: CLVenue) {
    this.owner = owner
    this.venue = venue
  }

  positionId(tokenId: BigInt): Bytes {
    return getVeloCLPositionId(this.owner, tokenId, this.venue.protocol)
  }
}

// NFTPositionMapping key of a CL NFT
export function getCLMappingId(protocol: string, tokenId: BigInt): Bytes {
  return nftPositionMappingId(protocol, tokenId)
}

export function getVeloCLPositionId(userAddress: Address, tokenId: BigInt, protocol: string): Bytes {
  const positionId = userAddress.toHex() + "-" + protocol + "-" + tokenId.toString()
  return Bytes.fromUTF8(positionId)
}

// Helper function to derive pool address from position data with caching
function getPoolAddress(venue: CLVenue, token0: Address, token1: Address, tickSpacing: i32, tokenId: BigInt | null = null): Address {
  if (tokenId !== null) {
    const cached = getCachedPoolAddress(venue.protocol, tokenId)
    if (cached !== null) {
      return cached
    }
  }
  
  const factory = VelodromeCLFactory.bind(venue.factory)
  const poolResult = factory.try_getPool(token0, token1, tickSpacing)
  
  if (poolResult.reverted) {
    const reversedResult = factory.try_getPool(token1, token0, tickSpacing)
    
    if (reversedResult.reverted) {
      return Address.zero()
    }
    
    const poolAddress = reversedResult.value
    
    if (tokenId !== null) {
      cachePoolAddress(venue.protocol, tokenId, poolAddress)
    }
    
    return poolAddress
  }
  
  const poolAddress = poolResult.value
  
  if (tokenId !== null) {
    cachePoolAddress(venue.protocol, tokenId, poolAddress)
  }
  
  return poolAddress
}

function isPositionClosed(liquidity: BigInt, amount0: BigDecimal, amount1: BigDecimal): boolean {
  const isLiquidityZero = liquidity.equals(BigInt.zero())
  const areAmountsZero = amount0.equals(BigDecimal.zero()) && amount1.equals(BigDecimal.zero())
    
  return isLiquidityZero || areAmountsZero
}

export function refreshVeloCLPositionWithEventAmounts(
  positionId: Bytes,
  tokenId: BigInt, 
  block: ethereum.Block, 
  eventAmount0: BigInt,
  eventAmount1: BigInt,
  txHash: Bytes = Bytes.empty()
): void {
  let pp = ProtocolPosition.load(positionId)
  if (pp == null) {
    return 
  }
  
  const nftOwner = Address.fromBytes(pp.agent)
  const mgr = VelodromePositionNFTManager.bind(clVenueFor(pp.protocol).manager)
  
  const dataResult = mgr.try_positions(tokenId)
  if (dataResult.reverted) {
    return
  }
  
  const data = dataResult.value

  // USD pricing for event amounts
  const token0Price = getTokenPriceUSD(data.value2, block.timestamp, false)
  const token1Price = getTokenPriceUSD(data.value3, block.timestamp, false)

  // Convert event amounts from wei to human readable using proper decimals
  const eventAmount0Human = convertTokenAmount(eventAmount0, data.value2) // token0
  const eventAmount1Human = convertTokenAmount(eventAmount1, data.value3) // token1
  
  const eventUsd0 = eventAmount0Human.times(token0Price)
  const eventUsd1 = eventAmount1Human.times(token1Price)
  const eventUsd = eventUsd0.plus(eventUsd1)

  // Update entry amounts for existing position
  if (pp.entryAmountUSD.equals(BigDecimal.zero()) && pp.entryTimestamp.equals(BigInt.zero())) {
    pp.entryTxHash = txHash
    pp.entryTimestamp = block.timestamp
    pp.entryAmount0 = eventAmount0Human
    pp.entryAmount0USD = eventUsd0
    pp.entryAmount1 = eventAmount1Human
    pp.entryAmount1USD = eventUsd1
    pp.entryAmountUSD = eventUsd
    
    // Associate swaps for new position
    let totalSlippageUSD = associateSwapsWithPosition(nftOwner, block)
    
    if (totalSlippageUSD.lt(BigDecimal.zero())) {
      totalSlippageUSD = BigDecimal.zero()
    }
    
    pp.swapSlippageUSD = totalSlippageUSD
    pp.totalCostsUSD = totalSlippageUSD
    pp.investmentUSD = eventUsd.plus(totalSlippageUSD)
  } else {
    pp.entryAmount0 = pp.entryAmount0.plus(eventAmount0Human)
    pp.entryAmount0USD = pp.entryAmount0USD.plus(eventUsd0)
    pp.entryAmount1 = pp.entryAmount1.plus(eventAmount1Human)
    pp.entryAmount1USD = pp.entryAmount1USD.plus(eventUsd1)
    pp.entryAmountUSD = pp.entryAmountUSD.plus(eventUsd)
    pp.investmentUSD = pp.entryAmountUSD.plus(pp.totalCostsUSD)
  }
  
  pp.save()
  
  // Refresh current position state
  refreshVeloCLPosition(positionId, tokenId, block, txHash)
}

export function refreshVeloCLPositionWithExitAmounts(
  positionId: Bytes,
  tokenId: BigInt, 
  block: ethereum.Block, 
  eventAmount0: BigInt,
  eventAmount1: BigInt,
  liquidityRemoved: BigInt,
  txHash: Bytes = Bytes.empty()
): void {
  let pp = ProtocolPosition.load(positionId)
  if (pp == null) {
    return // Position should already exist
  }
  
  const venue = clVenueFor(pp.protocol)
  const nftOwner = Address.fromBytes(pp.agent)
  const mgr = VelodromePositionNFTManager.bind(venue.manager)
  
  const dataResult = mgr.try_positions(tokenId)
  if (dataResult.reverted) {
    return
  }
  
  const data = dataResult.value
  const remainingLiquidity = data.value7
  const isFullExit = remainingLiquidity.equals(BigInt.zero())
  
  if (isFullExit) {
    const token0Price = getTokenPriceUSD(data.value2, block.timestamp, false)
    const token1Price = getTokenPriceUSD(data.value3, block.timestamp, false)
    
    const exitAmount0Human = convertTokenAmount(eventAmount0, data.value2)
    const exitAmount1Human = convertTokenAmount(eventAmount1, data.value3)
    
    const exitUsd0 = exitAmount0Human.times(token0Price)
    const exitUsd1 = exitAmount1Human.times(token1Price)
    const exitUsd = exitUsd0.plus(exitUsd1)
    
    pp.isActive = false
    pp.exitTxHash = txHash
    pp.exitTimestamp = block.timestamp
    pp.exitAmount0 = exitAmount0Human
    pp.exitAmount0USD = exitUsd0
    pp.exitAmount1 = exitAmount1Human
    pp.exitAmount1USD = exitUsd1
    pp.exitAmountUSD = exitUsd
    
    pp.amount0 = BigDecimal.zero()
    pp.amount1 = BigDecimal.zero()
    pp.amount0USD = BigDecimal.zero()
    pp.amount1USD = BigDecimal.zero()
    pp.usdCurrent = BigDecimal.zero()
    pp.liquidity = BigInt.zero()
    
    calculatePositionROI(pp)
    
    const poolAddress = getPoolAddress(venue, data.value2, data.value3, data.value4 as i32, tokenId)
    removeAgentNFTFromPool(venue.protocol, poolAddress, tokenId)
    
    pp.save()
    refreshPortfolio(nftOwner, block)
  } else {
    refreshVeloCLPosition(positionId, tokenId, block, txHash)
  }
}

export function refreshVeloCLPosition(
  positionId: Bytes,
  tokenId: BigInt,
  block: ethereum.Block,
  txHash: Bytes = Bytes.empty(),
  updatePortfolio: boolean = true
): void {
  refreshOrCreateCLPosition(positionId, tokenId, block, txHash, updatePortfolio, null)
}

// Creates the position for a newly minted NFT; its id comes from `create`, so it always
// matches the owner and venue.
export function createVeloCLPosition(create: CLPositionCreate, tokenId: BigInt, block: ethereum.Block, txHash: Bytes): void {
  refreshOrCreateCLPosition(create.positionId(tokenId), tokenId, block, txHash, false, create)
}

function refreshOrCreateCLPosition(
  positionId: Bytes,
  tokenId: BigInt,
  block: ethereum.Block,
  txHash: Bytes,
  updatePortfolio: boolean,
  create: CLPositionCreate | null
): void {
  let position = ProtocolPosition.load(positionId)
  let nftOwner: Address
  let poolAddress: Address
  let venue: CLVenue
  
  if (!position) {
    if (create === null) {
      return
    }
    nftOwner = create.owner
    venue = create.venue
    
    // Verify this is a service agent
    if (!isServiceAgent(nftOwner)) {
      return
    }
    
    const mgr = VelodromePositionNFTManager.bind(venue.manager)
    const dataResult = mgr.try_positions(tokenId)
    if (dataResult.reverted) {
      log.warning(
        "CL create: positions() reverted for position {} (tokenId {}, venue {}, manager {}) — not created.",
        [positionId.toString(), tokenId.toString(), venue.protocol, venue.manager.toHexString()]
      )
      return
    }
    
    const data = dataResult.value
    poolAddress = getPoolAddress(venue, data.value2, data.value3, data.value4 as i32, tokenId)
    
    if (poolAddress.equals(Address.zero())) {
      log.warning(
        "CL create: no pool for position {} (tokenId {}, venue {}, factory {}, token0 {}, token1 {}, tickSpacing {}) — not created.",
        [positionId.toString(), tokenId.toString(), venue.protocol, venue.factory.toHexString(),
         data.value2.toHexString(), data.value3.toHexString(), data.value4.toString()]
      )
      return
    }
    
    // Create new position
    position = new ProtocolPosition(positionId)
    initializePositionIncome(position)
    position.agent = nftOwner
    position.service = nftOwner
    position.protocol = venue.protocol
    position.pool = poolAddress
    position.tokenId = tokenId
    position.isActive = true
    
    // Update service positionIds array
    let service = Service.load(nftOwner)
    if (service != null) {
      if (service.positionIds == null) {
        service.positionIds = []
      }
      let positionIds = service.positionIds
      if (positionIds.indexOf(positionId) == -1) {
        positionIds.push(positionId)
        service.positionIds = positionIds
        service.save()
      }
    }
    
    // Set static metadata
    position.tickLower = data.value5 as i32
    position.tickUpper = data.value6 as i32
    position.tickSpacing = data.value4
    position.token0 = data.value2
    position.token1 = data.value3
    position.token0Symbol = getTokenSymbol(data.value2)
    position.token1Symbol = getTokenSymbol(data.value3)
    
    // Initialize entry tracking fields
    position.entryTxHash = txHash
    position.entryTimestamp = block.timestamp
    position.entryAmount0 = BigDecimal.zero()
    position.entryAmount0USD = BigDecimal.zero()
    position.entryAmount1 = BigDecimal.zero()
    position.entryAmount1USD = BigDecimal.zero()
    position.entryAmountUSD = BigDecimal.zero()
    position.usdCurrent = BigDecimal.zero()
    position.usdCurrentWithRewards = BigDecimal.zero()
    position.amount0USD = BigDecimal.zero()
    position.amount1USD = BigDecimal.zero()
    
    // Initialize cost tracking
    initializePositionCosts(position)
  } else {
  // Use existing position
    venue = clVenueFor(position.protocol)
    nftOwner = Address.fromBytes(position.agent)
    poolAddress = Address.fromBytes(position.pool)
  }
  const mgr = VelodromePositionNFTManager.bind(venue.manager)
  const dataResult = mgr.try_positions(tokenId)
  if (dataResult.reverted) {
    return
  }
  
  const data = dataResult.value
  
  const pool = VelodromeCLPool.bind(poolAddress)
  const slot0Result = pool.try_slot0()
  
  if (slot0Result.reverted) {
    return
  }
  
  const slot0 = slot0Result.value
  const tickLower = data.value5 as i32
  const tickUpper = data.value6 as i32
  
  const sqrtPa = TickMath.getSqrtRatioAtTick(tickLower)
  const sqrtPb = TickMath.getSqrtRatioAtTick(tickUpper)
  
  const amounts = LiquidityAmounts.getAmountsForLiquidity(
                    slot0.value0, sqrtPa, sqrtPb, data.value7)

  const token0Price = getTokenPriceUSD(data.value2, block.timestamp, false)
  const token1Price = getTokenPriceUSD(data.value3, block.timestamp, false)

  const amount0Human = convertTokenAmount(amounts.amount0, data.value2)
  const amount1Human = convertTokenAmount(amounts.amount1, data.value3)
  
  const usd0 = amount0Human.times(token0Price)
  const usd1 = amount1Human.times(token1Price)
  const usd = usd0.plus(usd1)

  // Fetch claimable rewards from pool's gauge
  let rewardAmount = BigDecimal.zero()
  let rewardUSD = BigDecimal.zero()
  
  const gaugeAddress = resolveCLGauge(pool, position, venue)

  if (!gaugeAddress.equals(Address.zero())) {
    const earnedResult = venue.protocol == PROTOCOL_AERO_CL
      ? getAeroCLEarned(gaugeAddress, nftOwner, tokenId)
      : VeloCLGauge.bind(gaugeAddress).try_earned(nftOwner, tokenId)
  
    if (!earnedResult.reverted) {
      rewardAmount = earnedResult.value.toBigDecimal().div(BigDecimal.fromString("1e18"))
      // Both reward tokens are 18-dec (rewardTokenFor).
      const rewardPrice = getTokenPriceUSD(venue.rewardToken, block.timestamp, false)
      rewardUSD = rewardAmount.times(rewardPrice)
    } else {
      log.warning(
        "CL rewards: gauge.earned() reverted for active CL position {} (gauge {}, account {}, tokenId {}) — recording 0 reward.",
        [positionId.toString(), gaugeAddress.toHexString(), nftOwner.toHexString(), tokenId.toString()]
      )
    }
  }

  // Separate base position value from rewards to avoid double-counting
  position.usdCurrent = usd  // Base liquidity value only
  position.usdCurrentWithRewards = usd.plus(rewardUSD)  // Total including rewards
  position.token0 = data.value2
  position.token0Symbol = getTokenSymbol(data.value2)
  position.amount0 = amount0Human
  position.amount0USD = usd0
  position.token1 = data.value3
  position.token1Symbol = getTokenSymbol(data.value3)
  position.amount1 = amount1Human
  position.amount1USD = usd1
  position.liquidity = data.value7
  recordClaimableRewardBeforeBlock(position, block)
  position.claimableReward = rewardAmount
  position.claimableRewardUSD = rewardUSD
  
  if (position.totalCostsUSD.equals(BigDecimal.zero()) && position.swapSlippageUSD.equals(BigDecimal.zero())) {
    if (position.investmentUSD.equals(BigDecimal.zero()) && position.entryAmountUSD.gt(BigDecimal.zero())) {
      position.investmentUSD = position.entryAmountUSD.plus(position.totalCostsUSD)
    }
  }
  
  if (isPositionClosed(data.value7, amount0Human, amount1Human)) {
    position.isActive = false
    position.exitTxHash = txHash
    position.exitTimestamp = block.timestamp
    position.exitAmount0 = amount0Human
    position.exitAmount0USD = usd0
    position.exitAmount1 = amount1Human
    position.exitAmount1USD = usd1
    position.exitAmountUSD = usd
    
    calculatePositionROI(position)
    removeAgentNFTFromPool(venue.protocol, poolAddress, tokenId)
  }
  
  position.save()
  
  if (updatePortfolio) {
    refreshPortfolio(nftOwner, block, true)
  }
}

// A CL pool's gauge; Address.zero() when the pool has none. Legacy gauges are cached on the
// position once found. Aero CL gauges are re-read on every refresh, like Aero v2 ones, since
// nothing here shows they can't be replaced. Neither a zero gauge nor a revert is cached, so a
// pool gauged later is picked up on the next refresh.
function resolveCLGauge(pool: VelodromeCLPool, position: ProtocolPosition, venue: CLVenue): Address {
  const cached = position.rewardsContract
  if (cached && venue.protocol != PROTOCOL_AERO_CL) {
    return Address.fromBytes(cached!)
  }
  const gaugeResult = pool.try_gauge()
  if (gaugeResult.reverted) {
    log.warning(
      "CL rewards: pool.gauge() reverted for position {} (pool {}, tokenId {}) — using the cached gauge, if any.",
      [position.id.toString(), pool._address.toHexString(), position.tokenId.toString()]
    )
    return cached ? Address.fromBytes(cached!) : Address.zero()
  }
  if (gaugeResult.value.equals(Address.zero())) {
    return Address.zero()
  }
  position.rewardsContract = gaugeResult.value
  return gaugeResult.value
}

// Aero's CLGauge has no earned(address,uint256); earned(account, [tokenId]) reads one
// position, but reverts unless that account has the NFT staked. An unstaked position earns
// nothing, so it reads as 0 rather than as the revert the caller logs.
function getAeroCLEarned(gaugeAddress: Address, account: Address, tokenId: BigInt): ethereum.CallResult<BigInt> {
  const gauge = AeroCLGauge.bind(gaugeAddress)
  const staked = gauge.try_stakedContains(account, tokenId)
  if (staked.reverted) {
    log.warning(
      "Aero CL rewards: gauge.stakedContains() reverted (gauge {}, account {}, tokenId {}) — recording 0 reward.",
      [gaugeAddress.toHexString(), account.toHexString(), tokenId.toString()]
    )
    return ethereum.CallResult.fromValue(BigInt.zero())
  }
  if (!staked.value) {
    return ethereum.CallResult.fromValue(BigInt.zero())
  }
  return gauge.try_earned1(account, [tokenId])
}
