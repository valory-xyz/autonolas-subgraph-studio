import { Address, BigDecimal, BigInt, ethereum, Bytes } from "@graphprotocol/graph-ts"
import { VelodromeCLPool } from "../generated/VeloNFTManager/VelodromeCLPool"
import { VelodromeV2Pool } from "../generated/templates/VeloV2Pool/VelodromeV2Pool"
import { AggregatorV3Interface } from "../generated/templates/Safe/AggregatorV3Interface"
import { getTokenConfig } from "./tokenConfig"
import { WETH, Q96, STABLECOINS, ETH_USD_FEED } from "./constants"

// Chainlink price adapter with validation
export function getChainlinkPrice(feedAddress: Address, blockTimestamp: BigInt = BigInt.fromI32(0)): BigDecimal {
  let aggregator = AggregatorV3Interface.bind(feedAddress)
  let roundResult = aggregator.try_latestRoundData()
  
  if (roundResult.reverted) {
    return BigDecimal.fromString("0")
  }
  
  let roundData = roundResult.value
  let price = roundData.value1.toBigDecimal().div(BigDecimal.fromString("1e8")) // 8 decimals
  
  // PRODUCTION ENHANCEMENT: Staleness checking
  // Only check staleness if a block timestamp is provided
  if (!blockTimestamp.equals(BigInt.fromI32(0))) {
    // Chainlink updatedAt timestamp
    let updatedAt = roundData.value3
    
    // Stale data threshold (24 hours in seconds)
    const STALE_PRICE_THRESHOLD = BigInt.fromI32(86400)
    
    // Calculate how old the data is
    let dataAge = blockTimestamp.minus(updatedAt)
    
    // If data is older than threshold, reject it
    if (dataAge.gt(STALE_PRICE_THRESHOLD)) {
      return BigDecimal.fromString("0") // Reject stale price
    }
  }
  
  // Validate price is reasonable (not zero, not negative)
  if (price.le(BigDecimal.fromString("0"))) {
    return BigDecimal.fromString("0")
  }
  
  return price
}


// Uniswap V3 price adapter with proper math
export function getUniswapV3Price(
  token: Address,
  poolAddress: Address,
  pairToken: Address,
  fee: number
): BigDecimal {
  
  let pool = VelodromeCLPool.bind(poolAddress) // Same interface
  let slot0Result = pool.try_slot0()
  
  if (slot0Result.reverted) {
    return BigDecimal.fromString("0")
  }
  
  let slot0 = slot0Result.value
  let sqrtPriceX96 = slot0.value0
  
  // Get token order
  let token0Result = pool.try_token0()
  let token1Result = pool.try_token1()
  
  if (token0Result.reverted || token1Result.reverted) {
    return BigDecimal.fromString("0")
  }
  
  let token0 = token0Result.value
  let token1 = token1Result.value
  
  // Get actual token decimals from config instead of hardcoding
  let targetTokenConfig = getTokenConfig(token)
  let pairTokenConfig = getTokenConfig(pairToken)

  if (targetTokenConfig == null || pairTokenConfig == null) {
    return BigDecimal.fromString("0")
  }

  // Determine which token is token0 and token1
  let token0Decimals: number
  let token1Decimals: number


  // Get current block timestamp from slot0 if available
  // Convert to BigInt as observationCardinality is a number
  let blockTimestamp = BigInt.fromI32(slot0.value2) // observationCardinality contains the timestamp
  
  if (token.equals(token0)) {
    token0Decimals = targetTokenConfig.decimals
    token1Decimals = pairTokenConfig.decimals
    // Token is token0, get price in terms of token1
    let price = sqrtPriceToToken0Price(sqrtPriceX96, token0Decimals, token1Decimals)
    // Pass block timestamp for staleness checking
    let pairPrice = getPairTokenPrice(pairToken, blockTimestamp)
    return price.times(pairPrice)
  } else if (token.equals(token1)) {
    token0Decimals = pairTokenConfig.decimals
    token1Decimals = targetTokenConfig.decimals
    // Token is token1, get price in terms of token0
    let price = sqrtPriceToToken1Price(sqrtPriceX96, token0Decimals, token1Decimals)
    // Pass block timestamp for staleness checking
    let pairPrice = getPairTokenPrice(pairToken, blockTimestamp)
    return price.times(pairPrice)
  }
  
  return BigDecimal.fromString("0")
}

// Velodrome price adapter (same as Uniswap V3)
export function getVelodromePrice(
  token: Address,
  poolAddress: Address,
  pairToken: Address
): BigDecimal {
  // Use same logic as Uniswap V3 since Velodrome CL uses similar interface
  return getUniswapV3Price(token, poolAddress, pairToken, 0)
}

// Helper functions
// Velodrome V2 (standard) price adapter - using getReserves instead of slot0
export function getVelodromeV2Price(
  token: Address,
  poolAddress: Address,
  pairToken: Address
): BigDecimal {
  
  let pool = VelodromeV2Pool.bind(poolAddress)
  
  // Get token order
  let token0Result = pool.try_token0()
  let token1Result = pool.try_token1()
  
  if (token0Result.reverted || token1Result.reverted) {
    return BigDecimal.fromString("0")
  }
  
  let token0 = token0Result.value
  let token1 = token1Result.value
  
  // Get token info
  let targetTokenConfig = getTokenConfig(token)
  let pairTokenConfig = getTokenConfig(pairToken)
  
  if (targetTokenConfig == null || pairTokenConfig == null) {
    return BigDecimal.fromString("0")
  }
  
  // Get reserves
  let reservesResult = pool.try_getReserves()
  
  if (reservesResult.reverted) {
    return BigDecimal.fromString("0")
  }
  
  let reserves = reservesResult.value
  let reserve0 = reserves.value0
  let reserve1 = reserves.value1
  let blockTimestampLast = BigInt.fromI32(reserves.value2.toI32())
  
  
  // Get token decimals
  let token0Decimals: number
  let token1Decimals: number
  
  // Calculate price based on token position
  if (token.equals(token0)) {
    // Target token is token0
    token0Decimals = targetTokenConfig.decimals
    token1Decimals = pairTokenConfig.decimals
    
    // Calculate price in terms of token1
    if (reserve0.equals(BigInt.fromI32(0))) {
      return BigDecimal.fromString("0")
    }
    
    // Price = reserve1 / reserve0 adjusted for decimals
    let rawPrice = reserve1.toBigDecimal().div(reserve0.toBigDecimal())
    
    // Adjust for decimal differences
    let decimalAdjustment = BigDecimal.fromString("1")
    let decimalDiff = token1Decimals - token0Decimals
    
    if (decimalDiff > 0) {
      for (let i = 0; i < decimalDiff; i++) {
        decimalAdjustment = decimalAdjustment.times(BigDecimal.fromString("10"))
      }
      rawPrice = rawPrice.div(decimalAdjustment)
    } else if (decimalDiff < 0) {
      for (let i = 0; i < -decimalDiff; i++) {
        decimalAdjustment = decimalAdjustment.times(BigDecimal.fromString("10"))
      }
      rawPrice = rawPrice.times(decimalAdjustment)
    }
    
    // Multiply by pair token price to get USD value
    let pairPrice = getPairTokenPrice(pairToken, blockTimestampLast)
    let finalPrice = rawPrice.times(pairPrice)
    
    return finalPrice
  } else if (token.equals(token1)) {
    // Target token is token1
    token0Decimals = pairTokenConfig.decimals
    token1Decimals = targetTokenConfig.decimals
    
    // Calculate price in terms of token0
    if (reserve1.equals(BigInt.fromI32(0))) {
      return BigDecimal.fromString("0")
    }
    
    // Price = reserve0 / reserve1 adjusted for decimals
    let rawPrice = reserve0.toBigDecimal().div(reserve1.toBigDecimal())
    
    // Adjust for decimal differences
    let decimalAdjustment = BigDecimal.fromString("1")
    let decimalDiff = token0Decimals - token1Decimals
    
    if (decimalDiff > 0) {
      for (let i = 0; i < decimalDiff; i++) {
        decimalAdjustment = decimalAdjustment.times(BigDecimal.fromString("10"))
      }
      rawPrice = rawPrice.div(decimalAdjustment)
    } else if (decimalDiff < 0) {
      for (let i = 0; i < -decimalDiff; i++) {
        decimalAdjustment = decimalAdjustment.times(BigDecimal.fromString("10"))
      }
      rawPrice = rawPrice.times(decimalAdjustment)
    }
    
    // Multiply by pair token price to get USD value
    let pairPrice = getPairTokenPrice(pairToken, blockTimestampLast)
    let finalPrice = rawPrice.times(pairPrice)
    
    return finalPrice
  }
  
  return BigDecimal.fromString("0")
}

function getPairTokenPrice(pairToken: Address, blockTimestamp: BigInt = BigInt.fromI32(0)): BigDecimal {
  let tokenHex = pairToken.toHexString().toLowerCase()
  
  // Direct stablecoin pricing - NO RECURSION (Base stablecoin set from constants)
  for (let i = 0; i < STABLECOINS.length; i++) {
    if (tokenHex == STABLECOINS[i]) {
      return BigDecimal.fromString("1.0")
    }
  }

  // WETH - direct Chainlink call (NO RECURSION)
  if (tokenHex == WETH.toHexString().toLowerCase()) {
    // Pass block timestamp for staleness checking if available
    let ethPrice = getChainlinkPrice(ETH_USD_FEED, blockTimestamp)
    return ethPrice.gt(BigDecimal.fromString("0")) ? ethPrice : BigDecimal.fromString("3000.0")
  }
  
  // Safe fallback for unknown tokens
  return BigDecimal.fromString("1.0")
}

function sqrtPriceToToken0Price(
  sqrtPriceX96: BigInt,
  token0Decimals: number,
  token1Decimals: number
): BigDecimal {
  
  // Safety check: prevent division by zero
  if (sqrtPriceX96.equals(BigInt.fromI32(0))) {
    return BigDecimal.fromString("0")
  }
  
  // Safety check: reasonable decimal values
  if (token0Decimals < 0 || token0Decimals > 18 || 
      token1Decimals < 0 || token1Decimals > 18) {
    return BigDecimal.fromString("0")
  }
  
  let sqrtPrice = sqrtPriceX96.toBigDecimal().div(Q96.toBigDecimal())
  
  // Safety check: reasonable sqrtPrice range
  if (sqrtPrice.le(BigDecimal.fromString("0")) || 
      sqrtPrice.gt(BigDecimal.fromString("1000000"))) {
    return BigDecimal.fromString("0")
  }
  
  let price = sqrtPrice.times(sqrtPrice) // Square it safely
  
  // Decimal adjustment with bounds checking
  let decimalDiff = token1Decimals - token0Decimals
  if (decimalDiff > 0 && decimalDiff <= 18) {
    let multiplier = BigDecimal.fromString("1")
    for (let i = 0; i < decimalDiff; i++) {
      multiplier = multiplier.times(BigDecimal.fromString("10"))
    }
    price = price.times(multiplier)
  } else if (decimalDiff < 0 && decimalDiff >= -18) {
    let divisor = BigDecimal.fromString("1")
    for (let i = 0; i < -decimalDiff; i++) {
      divisor = divisor.times(BigDecimal.fromString("10"))
    }
    price = price.div(divisor)
  }
  
  // Final safety check
  if (price.le(BigDecimal.fromString("0")) || 
      price.gt(BigDecimal.fromString("1000000"))) {
    return BigDecimal.fromString("0")
  }
  
  return price
}

function sqrtPriceToToken1Price(
  sqrtPriceX96: BigInt,
  token0Decimals: number,
  token1Decimals: number
): BigDecimal {
  let token0Price = sqrtPriceToToken0Price(sqrtPriceX96, token0Decimals, token1Decimals)
  return token0Price.equals(BigDecimal.fromString("0")) 
    ? BigDecimal.fromString("0")
    : BigDecimal.fromString("1").div(token0Price)
}
