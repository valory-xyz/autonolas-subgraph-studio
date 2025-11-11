import { 
  BigInt, 
  BigDecimal, 
  Address, 
  Bytes,
  ethereum,
  log
} from "@graphprotocol/graph-ts"

import { ProtocolPosition, Service, AgentSwapBuffer } from "../generated/schema"
import { VelodromeV2Pool } from "../generated/templates/VeloV2Pool/VelodromeV2Pool"
import { VeloV2Pool as VeloV2PoolTemplate } from "../generated/templates"
import { getTokenPriceUSD } from "./priceDiscovery"
import { getServiceByAgent } from "./config"
import { parseTotalSlippageFromBucket, associateSwapsWithPosition, calculatePortfolioMetrics } from "./helpers"
import { getTokenDecimals, getTokenSymbol } from "./tokenUtils"
import { calculatePositionROI } from "./roiCalculation"

// VelodromeV2 Router address on Optimism
const VELODROME_V2_ROUTER = Address.fromString("0xa062ae8a9c5e11aaa026fc2670b0d65ccc8b2858")

// Cache for VelodromeV2 pools to avoid repeated RPC calls
let poolCache = new Map<string, boolean>()

// Helper function to convert token amount to human readable format
function toHumanAmount(amount: BigInt, decimals: i32): BigDecimal {
  if (amount.equals(BigInt.zero())) {
    return BigDecimal.zero()
  }
  
  let divisor = BigInt.fromI32(10).pow(decimals as u8)
  return amount.toBigDecimal().div(divisor.toBigDecimal())
}

// Ensure pool template is created for tracking events
export function ensureVeloV2PoolTemplate(poolAddress: Address): void {
  const poolKey = poolAddress.toHexString()
  
  if (!poolCache.has(poolKey)) {
    VeloV2PoolTemplate.create(poolAddress)
    poolCache.set(poolKey, true)
  }
}

// Create or get VelodromeV2 position ID
export function getVeloV2PositionId(userAddress: Address, poolAddress: Address): Bytes {
  // For VelodromeV2, we use user-pool combination as position ID since there are no NFTs
  const positionId = userAddress.toHex() + "-velodromev2-" + poolAddress.toHex()
  return Bytes.fromUTF8(positionId)
}

// Refresh VelodromeV2 position with event amounts (for Mint events)
export function refreshVeloV2PositionWithEventAmounts(
  userAddress: Address,
  poolAddress: Address, 
  block: ethereum.Block,
  eventAmount0: BigInt,
  eventAmount1: BigInt,
  txHash: Bytes
): void {
  const positionId = getVeloV2PositionId(userAddress, poolAddress)
  
  // Service validation - early return if not a service
  const service = getServiceByAgent(userAddress)
  if (service == null) {
    return
  }
  
  let pp = ProtocolPosition.load(positionId)
  if (!pp) {
    pp = new ProtocolPosition(positionId)
    pp.agent = userAddress
    pp.service = userAddress // Link to service
    pp.protocol = "velodrome-v2"
    pp.pool = poolAddress
    pp.isActive = true
    pp.tokenId = BigInt.zero() // VelodromeV2 doesn't use tokenIds
    
    // Update service positionIds array
    let serviceEntity = Service.load(userAddress)
    if (serviceEntity != null) {
      if (serviceEntity.positionIds == null) {
        serviceEntity.positionIds = []
      }
      let positionIds = serviceEntity.positionIds
      let positionIdString = positionId.toString()
      if (positionIds.indexOf(positionIdString) == -1) {
        positionIds.push(positionIdString)
        serviceEntity.positionIds = positionIds
        serviceEntity.save()
      }
      
      // NOTE: firstTradingTimestamp now represents funding time, not position creation
    }
    
    // Get pool metadata FIRST
    const poolContract = VelodromeV2Pool.bind(poolAddress)
    
    const token0Result = poolContract.try_token0()
    const token1Result = poolContract.try_token1()
    const stableResult = poolContract.try_stable()
    
    if (!token0Result.reverted && !token1Result.reverted) {
      pp.token0 = token0Result.value
      pp.token1 = token1Result.value
      pp.token0Symbol = getTokenSymbol(token0Result.value)
      pp.token1Symbol = getTokenSymbol(token1Result.value)
      
      // Set fee based on pool type (stable vs volatile)
      if (!stableResult.reverted) {
        pp.fee = stableResult.value ? 5 : 30 // 0.05% for stable, 0.30% for volatile
      }
    }
    
    // Initialize ALL required fields BEFORE calling initializePositionCosts
    pp.usdCurrent = BigDecimal.zero()
    pp.usdCurrentWithRewards = BigDecimal.zero()  // TODO: Calculate V2 fees later
    pp.amount0 = BigDecimal.zero()
    pp.amount0USD = BigDecimal.zero()
    pp.amount1 = BigDecimal.zero()
    pp.amount1USD = BigDecimal.zero()
    pp.liquidity = BigInt.zero()
    
    // Initialize entry tracking fields - capture initial transaction data
    pp.entryTxHash = txHash
    pp.entryTimestamp = block.timestamp
    pp.entryAmount0 = BigDecimal.zero()
    pp.entryAmount0USD = BigDecimal.zero()
    pp.entryAmount1 = BigDecimal.zero()
    pp.entryAmount1USD = BigDecimal.zero()
    pp.entryAmountUSD = BigDecimal.zero()
    
    // Initialize static metadata fields
    pp.tickLower = 0
    pp.tickUpper = 0
    pp.tickSpacing = 0 // Not applicable for VelodromeV2
    
    // Initialize cost tracking for new position
    pp.totalCostsUSD = BigDecimal.zero()
    pp.swapSlippageUSD = BigDecimal.zero()
    pp.investmentUSD = BigDecimal.zero()
    pp.grossGainUSD = BigDecimal.zero()
    pp.netGainUSD = BigDecimal.zero()
    pp.positionROI = BigDecimal.zero()
  }
  
  // Get pool metadata if not already set
  if (!pp.token0) {
    const poolContract = VelodromeV2Pool.bind(poolAddress)
    
    const token0Result = poolContract.try_token0()
    const token1Result = poolContract.try_token1()
    const stableResult = poolContract.try_stable()
    
    if (!token0Result.reverted && !token1Result.reverted) {
      pp.token0 = token0Result.value
      pp.token1 = token1Result.value
      pp.token0Symbol = getTokenSymbol(token0Result.value)
      pp.token1Symbol = getTokenSymbol(token1Result.value)
      
      // Set fee based on pool type (stable vs volatile)
      if (!stableResult.reverted) {
        pp.fee = stableResult.value ? 5 : 30 // 0.05% for stable, 0.30% for volatile
      }
    }
  }
  
  // Convert event amounts to human readable format
  const token0Decimals = getTokenDecimals(Address.fromBytes(pp.token0!))
  const token1Decimals = getTokenDecimals(Address.fromBytes(pp.token1!))
  
  const eventAmount0Human = toHumanAmount(eventAmount0, token0Decimals)
  const eventAmount1Human = toHumanAmount(eventAmount1, token1Decimals)
  
  // Get USD values
  let token0Price = getTokenPriceUSD(Address.fromBytes(pp.token0!), block.timestamp, false)
  let token1Price = getTokenPriceUSD(Address.fromBytes(pp.token1!), block.timestamp, false)
  
  const eventUsd0 = token0Price.times(eventAmount0Human)
  const eventUsd1 = token1Price.times(eventAmount1Human)
  const eventUsd = eventUsd0.plus(eventUsd1)
  
  // Check if this is the first time adding liquidity (new position)
  const isFirstMint = pp.entryAmountUSD.equals(BigDecimal.zero()) && pp.entryTimestamp.equals(BigInt.zero())
  
  if (isFirstMint) {
    // This is the FIRST Mint event for a new position - set initial entry amounts
    pp.entryTxHash = txHash
    pp.entryTimestamp = block.timestamp
    pp.entryAmount0 = eventAmount0Human
    pp.entryAmount0USD = eventUsd0
    pp.entryAmount1 = eventAmount1Human
    pp.entryAmount1USD = eventUsd1
    pp.entryAmountUSD = eventUsd
    
    // Use centralized swap association logic
    let totalSlippageUSD = associateSwapsWithPosition(userAddress, block)
    
    // Handle negative slippage by setting to 0 (no cost reduction)
    if (totalSlippageUSD.lt(BigDecimal.zero())) {
      totalSlippageUSD = BigDecimal.zero()
    }
    
    // Always update costs (even if zero after negative adjustment)
    pp.swapSlippageUSD = totalSlippageUSD
    pp.totalCostsUSD = totalSlippageUSD
    pp.investmentUSD = eventUsd.plus(totalSlippageUSD)
    
    // Save the entry amounts first
    pp.save()
  } else {
    // This is a subsequent Mint event - add to existing entry amounts
    pp.entryAmount0 = pp.entryAmount0.plus(eventAmount0Human)
    pp.entryAmount0USD = pp.entryAmount0USD.plus(eventUsd0)
    pp.entryAmount1 = pp.entryAmount1.plus(eventAmount1Human)
    pp.entryAmount1USD = pp.entryAmount1USD.plus(eventUsd1)
    pp.entryAmountUSD = pp.entryAmountUSD.plus(eventUsd)
    
    // Save the updated entry amounts
    pp.save()
  }
  
  // Update current amounts by calling the regular refresh function
  refreshVeloV2Position(userAddress, poolAddress, block, txHash)
}

// Refresh VelodromeV2 position (for current state updates)
export function refreshVeloV2Position(
  userAddress: Address,
  poolAddress: Address,
  block: ethereum.Block,
  txHash: Bytes,
  updatePortfolio: boolean = true
): void {
  const positionId = getVeloV2PositionId(userAddress, poolAddress)
  
  // Only track positions owned by a service
  const service = getServiceByAgent(userAddress)
  if (service == null) {
    return
  }
  
  let pp = ProtocolPosition.load(positionId)
  if (!pp) {
    
    // Create a new position if it doesn't exist
    pp = new ProtocolPosition(positionId)
    pp.agent = userAddress
    pp.service = userAddress // Link to service
    pp.protocol = "velodrome-v2"
    pp.pool = poolAddress
    pp.isActive = true
    pp.tokenId = BigInt.zero() // VelodromeV2 doesn't use tokenIds
    
    // Update service positionIds array
    let serviceEntity = Service.load(userAddress)
    if (serviceEntity != null) {
      if (serviceEntity.positionIds == null) {
        serviceEntity.positionIds = []
      }
      let positionIds = serviceEntity.positionIds
      let positionIdString = positionId.toString()
      if (positionIds.indexOf(positionIdString) == -1) {
        positionIds.push(positionIdString)
        serviceEntity.positionIds = positionIds
        serviceEntity.save()
      }
      
      // NOTE: firstTradingTimestamp now represents funding time, not position creation
    }
    
    // Get pool metadata for new position FIRST
    const poolContract = VelodromeV2Pool.bind(poolAddress)
    
    const token0Result = poolContract.try_token0()
    const token1Result = poolContract.try_token1()
    const stableResult = poolContract.try_stable()
    
    if (!token0Result.reverted && !token1Result.reverted) {
      pp.token0 = token0Result.value
      pp.token1 = token1Result.value
      pp.token0Symbol = getTokenSymbol(token0Result.value)
      pp.token1Symbol = getTokenSymbol(token1Result.value)
      
      // Set fee based on pool type (stable vs volatile)
      if (!stableResult.reverted) {
        pp.fee = stableResult.value ? 5 : 30 // 0.05% for stable, 0.30% for volatile
      }
    } else {
      return
    }
    
    // Initialize ALL required fields BEFORE calling initializePositionCosts
    pp.usdCurrent = BigDecimal.zero()
    pp.amount0 = BigDecimal.zero()
    pp.amount0USD = BigDecimal.zero()
    pp.amount1 = BigDecimal.zero()
    pp.amount1USD = BigDecimal.zero()
    pp.liquidity = BigInt.zero()
    
    // Initialize entry tracking fields - capture initial transaction data
    pp.entryTxHash = txHash
    pp.entryTimestamp = block.timestamp
    pp.entryAmount0 = BigDecimal.zero()
    pp.entryAmount0USD = BigDecimal.zero()
    pp.entryAmount1 = BigDecimal.zero()
    pp.entryAmount1USD = BigDecimal.zero()
    pp.entryAmountUSD = BigDecimal.zero()
    
    // Initialize static metadata fields
    pp.tickLower = 0
    pp.tickUpper = 0
    pp.tickSpacing = 0 // Not applicable for VelodromeV2
    
    // Initialize cost tracking for new position
    pp.totalCostsUSD = BigDecimal.zero()
    pp.swapSlippageUSD = BigDecimal.zero()
    pp.investmentUSD = BigDecimal.zero()
    pp.grossGainUSD = BigDecimal.zero()
    pp.netGainUSD = BigDecimal.zero()
    pp.positionROI = BigDecimal.zero()
  }
  
  const poolContract = VelodromeV2Pool.bind(poolAddress)
  
  // Get user's LP token balance
  const balanceResult = poolContract.try_balanceOf(userAddress)
  const totalSupplyResult = poolContract.try_totalSupply()
  const reservesResult = poolContract.try_getReserves()
  
  if (balanceResult.reverted || totalSupplyResult.reverted || reservesResult.reverted) {
    return
  }
  
  const userBalance = balanceResult.value
  const totalSupply = totalSupplyResult.value
  const reserves = reservesResult.value
  
  // User balance and total supply data retrieved successfully
  
  // If user has no LP tokens, mark position as inactive
  if (userBalance.equals(BigInt.zero())) {
    pp.isActive = false
    
    // FIXED: Calculate position ROI when position closes (if exit data exists)
    if (pp.exitAmountUSD && pp.exitAmountUSD!.gt(BigDecimal.zero())) {
      calculatePositionROI(pp)
    }
    
    // Zero out current amounts
    pp.usdCurrent = BigDecimal.zero()
    pp.amount0 = BigDecimal.zero()
    pp.amount0USD = BigDecimal.zero()
    pp.amount1 = BigDecimal.zero()
    pp.amount1USD = BigDecimal.zero()
    pp.liquidity = BigInt.zero()
  } else {
    // Calculate user's share of the pool
    const userShare = userBalance.toBigDecimal().div(totalSupply.toBigDecimal())
    const userSharePercent = userShare.times(BigDecimal.fromString("100"))
    
    // Calculate current token amounts based on reserves and user's share
    const token0Decimals = getTokenDecimals(Address.fromBytes(pp.token0!))
    const token1Decimals = getTokenDecimals(Address.fromBytes(pp.token1!))
    
    const reserve0Human = toHumanAmount(reserves.value0, token0Decimals)
    const reserve1Human = toHumanAmount(reserves.value1, token1Decimals)
    
    pp.amount0 = reserve0Human.times(userShare)
    pp.amount1 = reserve1Human.times(userShare)
    
    // Calculate USD values
    let token0Price = getTokenPriceUSD(Address.fromBytes(pp.token0!), block.timestamp, false)
    let token1Price = getTokenPriceUSD(Address.fromBytes(pp.token1!), block.timestamp, false)
    
    pp.amount0USD = token0Price.times(pp.amount0!)
    pp.amount1USD = token1Price.times(pp.amount1!)
    pp.usdCurrent = pp.amount0USD.plus(pp.amount1USD)
    pp.usdCurrentWithRewards = pp.usdCurrent  // TODO: Calculate V2 fees later
    pp.liquidity = userBalance // Store LP token balance as liquidity
    
    pp.isActive = true
    
    // If this is a new position (entry amounts not set), use current amounts as entry
    if (pp.entryAmountUSD.equals(BigDecimal.zero()) && pp.entryTimestamp.equals(BigInt.zero())) {
      pp.entryTxHash = txHash
      pp.entryTimestamp = block.timestamp
      pp.entryAmount0 = pp.amount0!
      pp.entryAmount0USD = pp.amount0USD
      pp.entryAmount1 = pp.amount1!
      pp.entryAmount1USD = pp.amount1USD
      pp.entryAmountUSD = pp.usdCurrent
      
      // Use centralized swap association logic for new positions
      let totalSlippageUSD = associateSwapsWithPosition(userAddress, block)
      
      // Handle negative slippage by setting to 0 (no cost reduction)
      if (totalSlippageUSD.lt(BigDecimal.zero())) {
        totalSlippageUSD = BigDecimal.zero()
      }
      
      // Always update costs (even if zero after negative adjustment)
      pp.swapSlippageUSD = totalSlippageUSD
      pp.totalCostsUSD = totalSlippageUSD
      pp.investmentUSD = pp.entryAmountUSD.plus(totalSlippageUSD)
    }
  }
  
  pp.save()
  
  // Only update portfolio if flag is true (prevents recursion)
  if (updatePortfolio) {
    calculatePortfolioMetrics(userAddress, block)
  }
}

// Handle VelodromeV2 Burn events (liquidity removal)
export function refreshVeloV2PositionWithBurnAmounts(
  userAddress: Address,
  poolAddress: Address,
  block: ethereum.Block,
  eventAmount0: BigInt,
  eventAmount1: BigInt,
  txHash: Bytes
): void {
  const positionId = getVeloV2PositionId(userAddress, poolAddress)
  
  // Only track positions owned by a service
  const service = getServiceByAgent(userAddress)
  if (service == null) {
    return
  }
  
  let pp = ProtocolPosition.load(positionId)
  if (!pp) {
    return
  }
  
  // Convert event amounts to human readable format
  const token0Decimals = getTokenDecimals(Address.fromBytes(pp.token0!))
  const token1Decimals = getTokenDecimals(Address.fromBytes(pp.token1!))
  
  const eventAmount0Human = toHumanAmount(eventAmount0, token0Decimals)
  const eventAmount1Human = toHumanAmount(eventAmount1, token1Decimals)
  
  // Get USD values for exit tracking
  let token0Price = getTokenPriceUSD(Address.fromBytes(pp.token0!), block.timestamp, false)
  let token1Price = getTokenPriceUSD(Address.fromBytes(pp.token1!), block.timestamp, false)
  
  const eventUsd0 = token0Price.times(eventAmount0Human)
  const eventUsd1 = token1Price.times(eventAmount1Human)
  const eventUsd = eventUsd0.plus(eventUsd1)
  
  // Update exit tracking
  pp.exitTxHash = txHash
  pp.exitTimestamp = block.timestamp
  pp.exitAmount0 = eventAmount0Human
  pp.exitAmount0USD = eventUsd0
  pp.exitAmount1 = eventAmount1Human
  pp.exitAmount1USD = eventUsd1
  pp.exitAmountUSD = eventUsd
  
  //Calculate position ROI when position has exit data
  calculatePositionROI(pp)
  
  // Save and refresh current state
  pp.save()
  refreshVeloV2Position(userAddress, poolAddress, block, txHash)
}
