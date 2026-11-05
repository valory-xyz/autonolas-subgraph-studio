import { Address, BigDecimal, BigInt, ethereum, Bytes, log } from "@graphprotocol/graph-ts"
import { VelodromeCLPool } from "../generated/VeloNFTManager/VelodromeCLPool"
import { VelodromeV2Pool } from "../generated/templates/VeloV2Pool/VelodromeV2Pool"
import { AggregatorV3Interface } from "../generated/templates/Safe/AggregatorV3Interface"
import { BalancerV2WeightedPool } from "../generated/BalancerVault/BalancerV2WeightedPool"
import { BalancerV2Vault } from "../generated/BalancerVault/BalancerV2Vault"
import { getTokenConfig, TokenConfig, PriceSourceConfig } from "./tokenConfig"
import { Q96, BALANCER_VAULT } from "./constants"

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
    
    // 24h-heartbeat feeds plus grace for update latency, as on Base
    const STALE_PRICE_THRESHOLD = BigInt.fromI32(90000)
    
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
  fee: number,
  blockTimestamp: BigInt
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
  pairToken: Address,
  blockTimestamp: BigInt
): BigDecimal {
  // Use same logic as Uniswap V3 since Velodrome CL uses similar interface
  return getUniswapV3Price(token, poolAddress, pairToken, 0, blockTimestamp)
}

// Balancer V2 price adapter for weighted pools
export function getBalancerPrice(
  token: Address,
  poolAddress: Address,
  pairToken: Address,
  blockTimestamp: BigInt
): BigDecimal {
  
  const poolContract = BalancerV2WeightedPool.bind(poolAddress)
  const vaultContract = BalancerV2Vault.bind(BALANCER_VAULT)
  
  // Get pool ID
  const poolIdResult = poolContract.try_getPoolId()
  if (poolIdResult.reverted) {
    return BigDecimal.fromString("0")
  }
  
  const poolId = poolIdResult.value
  
  // Get pool tokens and balances
  const poolTokensResult = vaultContract.try_getPoolTokens(poolId)
  if (poolTokensResult.reverted) {
    return BigDecimal.fromString("0")
  }
  
  const poolTokens = poolTokensResult.value.value0
  const poolBalances = poolTokensResult.value.value1
  
  // Find token indices
  let tokenIndex = -1
  let pairTokenIndex = -1
  
  for (let i = 0; i < poolTokens.length; i++) {
    if (poolTokens[i].equals(token)) {
      tokenIndex = i
    }
    if (poolTokens[i].equals(pairToken)) {
      pairTokenIndex = i
    }
  }
  
  if (tokenIndex == -1 || pairTokenIndex == -1) {
    return BigDecimal.fromString("0")
  }
  
  // Get token decimals
  let targetTokenConfig = getTokenConfig(token)
  let pairTokenConfig = getTokenConfig(pairToken)
  
  if (targetTokenConfig == null || pairTokenConfig == null) {
    return BigDecimal.fromString("0")
  }
  
  // Calculate price based on pool balances
  const tokenBalance = poolBalances[tokenIndex]
  const pairTokenBalance = poolBalances[pairTokenIndex]
  
  if (tokenBalance.equals(BigInt.zero())) {
    return BigDecimal.fromString("0")
  }
  
  // Convert to human readable amounts
  const tokenDecimals = targetTokenConfig.decimals
  const pairTokenDecimals = pairTokenConfig.decimals
  
  const tokenBalanceHuman = tokenBalance.toBigDecimal().div(
    BigDecimal.fromString("1e" + tokenDecimals.toString())
  )
  const pairTokenBalanceHuman = pairTokenBalance.toBigDecimal().div(
    BigDecimal.fromString("1e" + pairTokenDecimals.toString())
  )
  
  // Price = pairTokenBalance / tokenBalance
  const rawPrice = pairTokenBalanceHuman.div(tokenBalanceHuman)
  
  // Get pair token price
  let pairPrice = getPairTokenPrice(pairToken, blockTimestamp)
  let finalPrice = rawPrice.times(pairPrice)
  
  return finalPrice
}

// Helper functions
// Velodrome V2 (standard) price adapter - using getReserves instead of slot0
export function getVelodromeV2Price(
  token: Address,
  poolAddress: Address,
  pairToken: Address,
  blockTimestamp: BigInt
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
  
  // Both the quote and the reserve ratio read the pool's other token as `pairToken`
  if (!(token.equals(token0) && pairToken.equals(token1)) && !(token.equals(token1) && pairToken.equals(token0))) {
    log.warning("PRICING: pool {} does not pair {} with {}; not used", [
      poolAddress.toHexString(), token.toHexString(), pairToken.toHexString()
    ])
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
  
  // On a stable (curve) pool the reserve ratio is not the price: quote one token instead
  let stableResult = pool.try_stable()
  if (!stableResult.reverted && stableResult.value) {
    let oneToken = BigInt.fromI32(10).pow(targetTokenConfig.decimals as u8)
    let quote = pool.try_getAmountOut(oneToken, token)
    if (quote.reverted) {
      log.warning("PRICING: getAmountOut() reverted on stable pool {} pricing {}", [poolAddress.toHexString(), token.toHexString()])
      return BigDecimal.fromString("0")
    }
    let pairUnit = BigInt.fromI32(10).pow(pairTokenConfig.decimals as u8).toBigDecimal()
    return quote.value.toBigDecimal().div(pairUnit).times(getPairTokenPrice(pairToken, blockTimestamp))
  }
  
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
    let pairPrice = getPairTokenPrice(pairToken, blockTimestamp)
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
    let pairPrice = getPairTokenPrice(pairToken, blockTimestamp)
    let finalPrice = rawPrice.times(pairPrice)
    
    return finalPrice
  }
  
  return BigDecimal.fromString("0")
}

// A pool's pair leg is priced from its own token config, never assumed to be $1: its Chainlink
// feed, else its velodrome_v2 pool when that pool's pair leg has a feed (one hop, so no deeper recursion)
function getPairTokenPrice(pairToken: Address, blockTimestamp: BigInt = BigInt.fromI32(0)): BigDecimal {
  let config = getTokenConfig(pairToken)
  if (config !== null) {
    let feed = sourceOfType(config!, "chainlink")
    if (feed !== null) {
      let feedPrice = getChainlinkPrice(feed!.address, blockTimestamp)
      if (feedPrice.gt(BigDecimal.zero())) {
        return feedPrice
      }
      log.warning("PRICING: pair token {} feed {} gave no valid price at block time {} (reverted, stale or not positive)", [
        pairToken.toHexString(), feed!.address.toHexString(), blockTimestamp.toString()
      ])
    }
    let pool = sourceOfType(config!, "velodrome_v2")
    if (pool !== null && pool!.pairToken !== null) {
      let poolPairConfig = getTokenConfig(pool!.pairToken!)
      if (poolPairConfig !== null && sourceOfType(poolPairConfig!, "chainlink") !== null) {
        return getVelodromeV2Price(pairToken, pool!.address, pool!.pairToken!, blockTimestamp)
      }
    }
  }
  log.warning("PRICING: pair token {} has no valid feed price and no feed-paired pool — its pools give no price", [pairToken.toHexString()])
  return BigDecimal.zero()
}

function sourceOfType(config: TokenConfig, sourceType: string): PriceSourceConfig | null {
  for (let i = 0; i < config.priceSources.length; i++) {
    if (config.priceSources[i].sourceType == sourceType) {
      return config.priceSources[i]
    }
  }
  return null
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
  
  // sqrtPrice² is raw token1 per raw token0; scale by 10^(token0Decimals - token1Decimals)
  let decimalDiff = token0Decimals - token1Decimals
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
