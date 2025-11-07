import { Address, BigDecimal, BigInt, ethereum, Bytes, log } from "@graphprotocol/graph-ts"
import { NonfungiblePositionManager } from "../../../../generated/VeloNFTManager/NonfungiblePositionManager"
import { VelodromeCLPool } from "../../../../generated/VeloNFTManager/VelodromeCLPool"
import { VelodromeCLFactory } from "../../../../generated/VeloNFTManager/VelodromeCLFactory"
import { VeloCLGauge } from "../../../../generated/VeloNFTManager/VeloCLGauge"
import { LiquidityAmounts } from "./libraries/LiquidityAmounts"
import { TickMath } from "./libraries/TickMath"
import { ProtocolPosition, Service, AgentSwapBuffer } from "../../../../generated/schema"
import { getUsd, refreshPortfolio } from "./common"
import { addAgentNFTToPool, removeAgentNFTFromPool, getCachedPoolAddress, cachePoolAddress } from "./poolIndexCache"
import { getTokenPriceUSD } from "./priceDiscovery"
import { VELO_MANAGER, VELO_FACTORY, VELO } from "./constants"
import { isServiceAgent, getServiceByAgent } from "./config"
import { parseTotalSlippageFromBucket, associateSwapsWithPosition } from "./helpers"
import { getTokenDecimals, getTokenSymbol } from "./tokenUtils"
import { initializePositionCosts, calculatePositionROI } from "./roiCalculation"

function convertTokenAmount(amount: BigInt, tokenAddress: Address): BigDecimal {
  const decimals = getTokenDecimals(tokenAddress)
  const divisor = BigDecimal.fromString("1e" + decimals.toString())
  return amount.toBigDecimal().div(divisor)
}

export function getVeloCLPositionId(userAddress: Address, tokenId: BigInt): Bytes {
  const positionId = userAddress.toHex() + "-velo-cl-" + tokenId.toString()
  return Bytes.fromUTF8(positionId)
}

// Helper function to derive pool address from position data with caching
function getPoolAddress(token0: Address, token1: Address, tickSpacing: i32, tokenId: BigInt | null = null): Address {
  if (tokenId !== null) {
    const cached = getCachedPoolAddress("velodrome-cl", tokenId)
    if (cached !== null) {
      return cached
    }
  }
  
  const factory = VelodromeCLFactory.bind(VELO_FACTORY)
  const poolResult = factory.try_getPool(token0, token1, tickSpacing)
  
  if (poolResult.reverted) {
    const reversedResult = factory.try_getPool(token1, token0, tickSpacing)
    
    if (reversedResult.reverted) {
      return Address.zero()
    }
    
    const poolAddress = reversedResult.value
    
    if (tokenId !== null) {
      cachePoolAddress("velodrome-cl", tokenId, poolAddress)
    }
    
    return poolAddress
  }
  
  const poolAddress = poolResult.value
  
  if (tokenId !== null) {
    cachePoolAddress("velodrome-cl", tokenId, poolAddress)
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
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  
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
  
  const nftOwner = Address.fromBytes(pp.agent)
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  
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
    
    const poolAddress = getPoolAddress(data.value2, data.value3, data.value4 as i32, tokenId)
    removeAgentNFTFromPool("velodrome-cl", poolAddress, tokenId)
    
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
  updatePortfolio: boolean = true,
  owner: Address | null = null
): void {
  let position = ProtocolPosition.load(positionId)
  let nftOwner: Address
  let poolAddress: Address
  
  if (!position) {
    if (owner !== null) {
      nftOwner = owner
    } else {
      return
    }
    
    // Verify this is a service agent
    if (!isServiceAgent(nftOwner)) {
      return
    }
    
    const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
    const dataResult = mgr.try_positions(tokenId)
    if (dataResult.reverted) {
      return
    }
    
    const data = dataResult.value
    poolAddress = getPoolAddress(data.value2, data.value3, data.value4 as i32, tokenId)
    
    if (poolAddress.equals(Address.zero())) {
      return
    }
    
    // Create new position
    position = new ProtocolPosition(positionId)
    position.agent = nftOwner
    position.service = nftOwner
    position.protocol = "velodrome-cl"
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
      let positionIdString = positionId.toString()
      if (positionIds.indexOf(positionIdString) == -1) {
        positionIds.push(positionIdString)
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
    
    // Initialize cost tracking
    initializePositionCosts(position)
  } else {
  // Use existing position
    nftOwner = Address.fromBytes(position.agent)
    poolAddress = Address.fromBytes(position.pool)
  }
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
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
  
  // Get gauge address
  let gaugeAddress: Address
  let rewardsContract = position.rewardsContract
  if (rewardsContract) {
    gaugeAddress = Address.fromBytes(position.rewardsContract!)
  } 
  else {
    const gaugeResult = pool.try_gauge()
    if (!gaugeResult.reverted) {
      gaugeAddress = gaugeResult.value
      position.rewardsContract = gaugeAddress
    } else {
      position.usdCurrent = usd
      position.save()
      return
    }
  }
  
  // Get claimable rewards from gauge
  const gauge = VeloCLGauge.bind(gaugeAddress)
  const earnedResult = gauge.try_earned(nftOwner, tokenId)
  
  if (!earnedResult.reverted) {
    rewardAmount = earnedResult.value.toBigDecimal().div(BigDecimal.fromString("1e18"))
    const veloPrice = getTokenPriceUSD(VELO, block.timestamp, false)
    rewardUSD = rewardAmount.times(veloPrice)
  }

  position.usdCurrent = usd.plus(rewardUSD)
  position.token0 = data.value2
  position.token0Symbol = getTokenSymbol(data.value2)
  position.amount0 = amount0Human
  position.amount0USD = usd0
  position.token1 = data.value3
  position.token1Symbol = getTokenSymbol(data.value3)
  position.amount1 = amount1Human
  position.amount1USD = usd1
  position.liquidity = data.value7
  
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
    removeAgentNFTFromPool("velodrome-cl", poolAddress, tokenId)
  }
  
  position.save()
  
  if (updatePortfolio) {
    refreshPortfolio(nftOwner, block, true)
  }
}
