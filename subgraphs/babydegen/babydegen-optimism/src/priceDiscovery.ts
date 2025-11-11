import { Address, BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { Token, PriceSource, PriceUpdate } from "../generated/schema"
import { getTokenConfig, TokenConfig, PriceSourceConfig } from "./tokenConfig"
import { CRITICAL_STABLECOINS, DOLA } from "./constants"

// Cache duration: 5 minutes
const PRICE_CACHE_DURATION = BigInt.fromI32(300)
const MIN_CONFIDENCE_THRESHOLD = BigDecimal.fromString("0.5") // 50% minimum confidence

// Stablecoin fallback constants
const STABLECOIN_FALLBACK_PRICE = BigDecimal.fromString("1.0") // Default fallback for stablecoins
const STABLECOIN_FALLBACK_CONFIDENCE = BigDecimal.fromString("0.95") // 95% confidence for stablecoin fallbacks

// Simplified token validation without caching to avoid Map issues
function isTokenValidated(address: Address): boolean {
  // Direct validation without caching - simpler and safer
  let config = getTokenConfig(address)
  return config != null
}

export function getTokenPriceUSD(
  tokenAddress: Address,
  currentTimestamp: BigInt,
  forceRefresh: boolean = false
): BigDecimal {
  
  if (tokenAddress.equals(DOLA)) {
    // Load or initialize DOLA token
    let token = Token.load(tokenAddress)
    if (token == null) {
      token = initializeToken(tokenAddress)
      if (token == null) {
        return BigDecimal.fromString("1.0") // Fallback even if initialization fails
      }
    }
    
    // Set hardcoded price with high confidence
    let hardcodedPrice = BigDecimal.fromString("1.0")
    let hardcodedConfidence = BigDecimal.fromString("0.99") // 99% confidence
    
    // Update token with hardcoded values
    token.derivedUSD = hardcodedPrice
    token.priceConfidence = hardcodedConfidence
    token.lastPriceUpdate = currentTimestamp
    token.save()
    
    // Create price update record for tracking
    let hardcodedResult = new PriceResult(hardcodedPrice, hardcodedConfidence, "hardcoded")
    createPriceUpdate(token, hardcodedResult, currentTimestamp)
    
    return hardcodedPrice
  }

  // Quick validation check first
  if (!isTokenValidated(tokenAddress)) {
    return BigDecimal.fromString("0")
  }

  let token = Token.load(tokenAddress)
  if (token == null) {
    token = initializeToken(tokenAddress)
    if (token == null) {
      return BigDecimal.fromString("0")
    }
  }
  
  // Check cache
  if (!forceRefresh && 
      currentTimestamp.minus(token.lastPriceUpdate).lt(PRICE_CACHE_DURATION) &&
      token.priceConfidence.gt(MIN_CONFIDENCE_THRESHOLD)) {
    // Using cached price
    return token.derivedUSD
  }
  
  // Get fresh price from sources
  let priceResult = getPriceFromSources(token, currentTimestamp)
  
  if (priceResult.price.gt(BigDecimal.fromString("0")) && 
      priceResult.confidence.gt(MIN_CONFIDENCE_THRESHOLD)) {
    
    // Update token with new price
    token.derivedUSD = priceResult.price
    token.priceConfidence = priceResult.confidence
    token.lastPriceUpdate = currentTimestamp
    token.save()
    
    // Create price update record
    createPriceUpdate(token, priceResult, currentTimestamp)
    
    return priceResult.price
  }
  
  // No reliable price found for token

  // Fallback strategy based on token type
  let tokenHex = token.id.toHexString().toLowerCase()
  
  // For critical stablecoins (USDC, USDT, DAI, LUSD), use $1.00 with high confidence
  for (let i = 0; i < CRITICAL_STABLECOINS.length; i++) {
    if (tokenHex == CRITICAL_STABLECOINS[i]) {
      // Using $1.00 fallback for critical stablecoin
      
      // Update token with fallback price
      token.derivedUSD = STABLECOIN_FALLBACK_PRICE
      token.priceConfidence = STABLECOIN_FALLBACK_CONFIDENCE
      token.lastPriceUpdate = currentTimestamp
      token.save()
      
      // Create fallback price update record
      let fallbackResult = new PriceResult(
        STABLECOIN_FALLBACK_PRICE,
        STABLECOIN_FALLBACK_CONFIDENCE,
        "fallback"
      )
      createPriceUpdate(token, fallbackResult, currentTimestamp)
      
      return STABLECOIN_FALLBACK_PRICE
    }
  }

  // For all other tokens, no reliable fallback
  return BigDecimal.fromString("0") // Fail gracefully for non-critical tokens
}

class PriceResult {
  price: BigDecimal
  confidence: BigDecimal
  source: string
  
  constructor(price: BigDecimal, confidence: BigDecimal, source: string) {
    this.price = price
    this.confidence = confidence
    this.source = source
  }
}

function initializeToken(address: Address): Token | null {
  let config = getTokenConfig(address)
  if (config == null) {
    return null
  }
  
  let token = new Token(address)
  token.symbol = config.symbol
  token.name = config.symbol
  token.decimals = BigInt.fromI32(config.decimals)
  token.derivedUSD = BigDecimal.fromString("0") // Start with 0, not $1
  token.priceConfidence = BigDecimal.fromString("0")
  token.priceSources = []
  token.lastPriceUpdate = BigInt.fromI32(0)
  
  // Initialize price sources
  for (let i = 0; i < config.priceSources.length; i++) {
    let sourceConfig = config.priceSources[i]
    let source = new PriceSource(sourceConfig.address)
    source.token = token.id
    source.sourceType = sourceConfig.sourceType
    source.priority = sourceConfig.priority
    source.isActive = true
    source.lastUpdate = BigInt.fromI32(0)
    source.lastPrice = BigDecimal.fromString("0")
    source.confidence = BigDecimal.fromString(sourceConfig.confidence.toString()).div(BigDecimal.fromString("100"))
    source.save()
    
    let sources = token.priceSources
    sources.push(source.id)
    token.priceSources = sources
  }
  
  token.save()
  return token
}

function getPriceFromSources(
  token: Token,
  timestamp: BigInt
): PriceResult {
  
  let config = getTokenConfig(Address.fromBytes(token.id))
  if (config == null) {
    return new PriceResult(BigDecimal.fromString("0"), BigDecimal.fromString("0"), "none")
  }
  
  // Track valid prices and their confidence
  let validPrices: BigDecimal[] = []
  let confidences: BigDecimal[] = []
  let sourceTypes: string[] = []
  
  // Try all sources and collect valid prices
  for (let i = 0; i < config.priceSources.length; i++) {
    let sourceConfig = config.priceSources[i]
    let result = getPriceFromSource(token, sourceConfig, timestamp)
    
    if (result.price.gt(BigDecimal.fromString("0"))) {
      validPrices.push(result.price)
      confidences.push(result.confidence)
      sourceTypes.push(result.source)
    }
  }
  
  // If no valid prices, return failed result
  if (validPrices.length == 0) {
    return new PriceResult(BigDecimal.fromString("0"), BigDecimal.fromString("0"), "failed")
  }
  
  // If only one valid price, return it directly
  if (validPrices.length == 1) {
    return new PriceResult(validPrices[0], confidences[0], sourceTypes[0])
  }
  
  // Calculate weighted average based on confidence
  let weightedSum = BigDecimal.fromString("0")
  let totalConfidence = BigDecimal.fromString("0")
  
  for (let i = 0; i < validPrices.length; i++) {
    weightedSum = weightedSum.plus(validPrices[i].times(confidences[i]))
    totalConfidence = totalConfidence.plus(confidences[i])
  }
  
  // Avoid division by zero
  if (totalConfidence.equals(BigDecimal.fromString("0"))) {
    // Simple average if all confidences are zero
    let sum = BigDecimal.fromString("0")
    for (let i = 0; i < validPrices.length; i++) {
      sum = sum.plus(validPrices[i])
    }
    let avgPrice = sum.div(BigDecimal.fromString(validPrices.length.toString()))
    let avgConfidence = BigDecimal.fromString("0.5") // Default to 50% confidence
    
    return new PriceResult(avgPrice, avgConfidence, "average_unweighted")
  }
  
  let weightedAvgPrice = weightedSum.div(totalConfidence)
  let avgConfidence = totalConfidence.div(BigDecimal.fromString(validPrices.length.toString()))
  
  return new PriceResult(weightedAvgPrice, avgConfidence, "average_weighted")
}

function getPriceFromSource(
  token: Token,
  sourceConfig: PriceSourceConfig,
  timestamp: BigInt
): PriceResult {
  
  let sourceType = sourceConfig.sourceType
  let baseConfidence = BigDecimal.fromString(sourceConfig.confidence.toString()).div(BigDecimal.fromString("100"))
  
  if (sourceType == "chainlink") {
    // Pass block timestamp for staleness checking
    let price = getChainlinkPrice(sourceConfig.address, timestamp)
    if (price.gt(BigDecimal.fromString("0")) && isValidPriceResult(price, token.symbol)) {
      return new PriceResult(price, baseConfidence, "chainlink")
    }
  }
  
  if (sourceType == "chainlink_reference") {
    // Used for tokens without direct feeds (USDC.e referencing USDC)
    // Pass block timestamp for staleness checking
    let price = getChainlinkPrice(sourceConfig.address, timestamp)
    if (price.gt(BigDecimal.fromString("0")) && isValidPriceResult(price, token.symbol)) {
      // Slightly lower confidence for reference prices
      return new PriceResult(price, baseConfidence.times(BigDecimal.fromString("0.9")), "chainlink_ref")
    }
  }
  
  if (sourceType == "uniswap_v3") {
    let price = getUniswapV3Price(
      Address.fromBytes(token.id),
      sourceConfig.address,
      sourceConfig.pairToken!,
      sourceConfig.fee
    )
    if (price.gt(BigDecimal.fromString("0")) && isValidPriceResult(price, token.symbol)) {
      return new PriceResult(price, baseConfidence, "uniswap_v3")
    }
  }
  
  if (sourceType == "velodrome_slipstream") {
    // For Velodrome Slipstream/CL (Concentrated Liquidity) pools
    let price = getVelodromePrice(
      Address.fromBytes(token.id),
      sourceConfig.address,
      sourceConfig.pairToken!
    )
    if (price.gt(BigDecimal.fromString("0")) && isValidPriceResult(price, token.symbol)) {
      return new PriceResult(price, baseConfidence, "velodrome_cl")
    }
  }
  
  if (sourceType == "velodrome_v2") {
    // For standard Velodrome V2 pools using getReserves
    let price = getVelodromeV2Price(
      Address.fromBytes(token.id),
      sourceConfig.address,
      sourceConfig.pairToken!
    )
    if (price.gt(BigDecimal.fromString("0")) && isValidPriceResult(price, token.symbol)) {
      return new PriceResult(price, baseConfidence, "velodrome_v2")
    }
  }
  
  if (sourceType == "balancer_v2") {
    // For Balancer V2 weighted pools
    let price = getBalancerPrice(
      Address.fromBytes(token.id),
      sourceConfig.address,
      sourceConfig.pairToken!
    )
    if (price.gt(BigDecimal.fromString("0")) && isValidPriceResult(price, token.symbol)) {
      return new PriceResult(price, baseConfidence, "balancer_v2")
    }
  }
  
  return new PriceResult(BigDecimal.fromString("0"), BigDecimal.fromString("0"), "unsupported")
}

function createPriceUpdate(
  token: Token,
  result: PriceResult,
  timestamp: BigInt
): void {
  let id = token.id.concat(Bytes.fromUTF8(timestamp.toString()))
  let update = new PriceUpdate(id)
  update.token = token.id
  update.priceUSD = result.price
  update.confidence = result.confidence
  
  // For averaged prices, we'll use the first source as a reference
  // Since we can't modify the schema to store multiple sources
  let sourceIndex = 0
  
  if (result.source != "average_weighted" && result.source != "average_unweighted") {
    // Find the source by type for non-averaged prices
    let sourceType = result.source
    
    for (let i = 0; i < token.priceSources.length; i++) {
      let source = PriceSource.load(token.priceSources[i])
      if (source != null && source.sourceType == sourceType) {
        sourceIndex = i
        break
      }
    }
  }
  
  update.source = token.priceSources[sourceIndex]
  update.timestamp = timestamp
  update.block = BigInt.fromI32(0) // Would need block context
  update.save()
}

function isValidPriceResult(price: BigDecimal, tokenSymbol: string): boolean {
  // Set price validation bounds based on token type
  let minPrice: BigDecimal
  let maxPrice: BigDecimal
  
  // Different bounds for stablecoins vs other tokens
  if (tokenSymbol == "USDC" || tokenSymbol == "USDT" || 
      tokenSymbol == "DAI" || tokenSymbol == "USDC.e") {
    // Core stablecoins should be within a very tight range around $1
    minPrice = BigDecimal.fromString("0.95")   // $0.95
    maxPrice = BigDecimal.fromString("1.05")   // $1.05
  } else if (tokenSymbol == "LUSD" || tokenSymbol == "FRAX" || 
      tokenSymbol == "DOLA") {
    // Variable stablecoins can have slightly more variation
    minPrice = BigDecimal.fromString("0.5")    // $0.50
    maxPrice = BigDecimal.fromString("1.5")    // $1.50
  } else {
    // Non-stablecoin tokens can have a wider range
    minPrice = BigDecimal.fromString("0.0001") // $0.0001
    maxPrice = BigDecimal.fromString("100000") // $100,000
  }
  
  if (price.le(minPrice) || price.ge(maxPrice)) {
    return false
  }
  
  return true
}

// Import price adapter functions 
import {
  getChainlinkPrice,
  getUniswapV3Price,
  getVelodromePrice,
  getVelodromeV2Price,
  getBalancerPrice
} from "./priceAdapters"
