import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts"
import { Token, PriceSource, PriceUpdate } from "../generated/schema"
import { getTokenConfig, TokenConfig, PriceSourceConfig } from "./tokenConfig"
import { STABLECOINS } from "./constants"

// Cache duration: 5 minutes
const PRICE_CACHE_DURATION = BigInt.fromI32(300)
const MIN_CONFIDENCE_THRESHOLD = BigDecimal.fromString("0.5") // 50% minimum confidence

const DEPEG_THRESHOLD = BigDecimal.fromString("0.98")

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
    token.priceStale = false
    token.depegged = isStablecoin(tokenAddress) && priceResult.price.lt(DEPEG_THRESHOLD)
    token.save()
    
    // Create price update record
    createPriceUpdate(token, priceResult, currentTimestamp)
    
    return priceResult.price
  }
  
  // No valid price: keep the last valid one, marked stale; a token never priced stays unpriced
  if (token.derivedUSD.gt(BigDecimal.zero())) {
    if (!token.priceStale) {
      log.warning("PRICING: no valid price for {} ({}) — keeping its last price {}, marked stale", [
        token.symbol, tokenAddress.toHexString(), token.derivedUSD.toString()
      ])
      token.priceStale = true
      token.save()
    }
    return token.derivedUSD
  }
  return BigDecimal.zero()
}

function isStablecoin(tokenAddress: Address): boolean {
  let tokenHex = tokenAddress.toHexString().toLowerCase()
  for (let i = 0; i < STABLECOINS.length; i++) {
    if (tokenHex == STABLECOINS[i]) {
      return true
    }
  }
  return false
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
  token.priceStale = false
  token.depegged = false
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
  
  // Collect valid prices from the best priority that has any: a higher-numbered source is a
  // fallback, only read when every better one fails (e.g. a stablecoin's pool behind its
  // Chainlink feed). Sources sharing a priority are averaged by confidence below.
  let bestPriority = i32.MAX_VALUE
  for (let i = 0; i < config.priceSources.length; i++) {
    let sourceConfig = config.priceSources[i]
    if (sourceConfig.priority > bestPriority) {
      continue
    }
    let result = getPriceFromSource(token, sourceConfig, timestamp)
    
    if (result.price.gt(BigDecimal.fromString("0"))) {
      if (sourceConfig.priority < bestPriority) {
        bestPriority = sourceConfig.priority
        validPrices = []
        confidences = []
        sourceTypes = []
      }
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
      // Label with the configured sourceType so createPriceUpdate attributes it to this source
      return new PriceResult(price, baseConfidence, sourceType)
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
  // Stablecoins have no lower bound, so a depeg is recorded rather than rejected
  if (tokenSymbol == "USDC" || tokenSymbol == "USDC.e") {
    minPrice = BigDecimal.zero()
    maxPrice = BigDecimal.fromString("1.05")   // $1.05
  } else if (tokenSymbol == "LUSD" || tokenSymbol == "FRAX" || 
      tokenSymbol == "DOLA" || tokenSymbol == "USDT" || tokenSymbol == "DAI" ||
      tokenSymbol == "USDe" || tokenSymbol == "USDS") {
    minPrice = BigDecimal.zero()
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
  getVelodromeV2Price
} from "./priceAdapters"
