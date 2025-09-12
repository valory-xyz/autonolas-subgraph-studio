import { 
  Address, 
  BigInt, 
  BigDecimal, 
  Bytes, 
  ethereum,
  log
} from "@graphprotocol/graph-ts"

import { 
  SwapTransaction, 
  SwapToEntryAssociation, 
  ProtocolPosition,
  Service,
  AgentSwapBuffer
} from "../generated/schema"

import { getTokenPriceUSD } from "./priceDiscovery"
import { getTokenDecimals } from "./tokenUtils"
import { WETH } from "./constants"

// Constants
const ASSOCIATION_WINDOW = BigInt.fromI32(1200) // 20 minutes in seconds

// Helper function to convert token amount to human readable format
function toHumanAmount(amount: BigInt, decimals: i32): BigDecimal {
  if (amount.equals(BigInt.zero())) {
    return BigDecimal.zero()
  }
  
  let divisor = BigInt.fromI32(10).pow(decimals as u8)
  return amount.toBigDecimal().div(divisor.toBigDecimal())
}

// Get token decimals with fallback - use the proper tokenUtils function
function getTokenDecimalsWithFallback(tokenAddress: Address): i32 {
  // For ETH (zero address), use 18 decimals
  if (tokenAddress.equals(Address.zero())) {
    return 18
  }
  
  // Use the proper getTokenDecimals function from tokenUtils
  return getTokenDecimals(tokenAddress)
}

// Calculate expected output amount for slippage calculation
function calculateExpectedOutput(
  fromAmount: BigInt,
  fromToken: Address,
  toToken: Address,
  timestamp: BigInt
): BigDecimal {
  // Handle ETH (zero address) by mapping to WETH for price lookup
  let fromTokenForPrice = fromToken.equals(Address.zero()) ? WETH : fromToken
  let toTokenForPrice = toToken.equals(Address.zero()) ? WETH : toToken
  
  // Get token prices
  let fromPrice = getTokenPriceUSD(fromTokenForPrice, timestamp, false)
  let toPrice = getTokenPriceUSD(toTokenForPrice, timestamp, false)
  
  if (fromPrice.equals(BigDecimal.zero()) || toPrice.equals(BigDecimal.zero())) {
    return BigDecimal.zero()
  }
  
  // Convert from amount to human readable
  let fromDecimals = getTokenDecimalsWithFallback(fromToken)
  let fromAmountHuman = toHumanAmount(fromAmount, fromDecimals)
  
  // Calculate expected output in USD
  let fromAmountUSD = fromAmountHuman.times(fromPrice)
  
  // Convert to expected output amount (assuming no slippage)
  let expectedOutputUSD = fromAmountUSD
  
  return expectedOutputUSD
}

// Helper function to get bucket index for time-based grouping
function getBucketIndex(timestamp: BigInt): BigInt {
  // 5-minute buckets (300 seconds)
  return timestamp.div(BigInt.fromI32(300))
}

// Helper function to create swap data string for storage
function createSwapDataString(swapId: Bytes, slippageUSD: BigDecimal, timestamp: BigInt, expiresAt: BigInt): string {
  // Mode format: "timestamp,swapId,slippage,expiresAt"
  return timestamp.toString() + "," + swapId.toHexString() + "," + slippageUSD.toString() + "," + expiresAt.toString()
}

// Helper function to parse total slippage from bucket string
function parseTotalSlippageFromBucket(bucketSwaps: string): BigDecimal {
  if (bucketSwaps == "[]" || bucketSwaps == "") {
    return BigDecimal.zero()
  }
  
  let totalSlippage = BigDecimal.zero()
  
  // Mode format parsing: split by pipe, then by comma
  let swapEntries = bucketSwaps.split("|")
  for (let i = 0; i < swapEntries.length; i++) {
    let entry = swapEntries[i]
    if (entry == "") continue
    
    let parts = entry.split(",")
    if (parts.length >= 3) {
      // parts[2] is the slippage value in format: timestamp,swapId,slippage,expiresAt
      let slippage = BigDecimal.fromString(parts[2])
      totalSlippage = totalSlippage.plus(slippage)
    }
  }
  
  return totalSlippage
}

// Create a new SwapTransaction entity and add to time bucket
export function createSwapTransaction(
  agent: Address,
  transactionId: Bytes,
  txHash: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt,
  fromAssetId: Address,
  toAssetId: Address,
  fromAmount: BigInt,
  toAmount: BigInt,
  logIndex: BigInt
): void {
  // Create unique ID using txHash and logIndex
  let swapId = txHash.concat(Bytes.fromUTF8("-")).concat(Bytes.fromUTF8(logIndex.toString()))
  
  let swap = new SwapTransaction(swapId)
  
  // Basic swap data
  swap.agent = agent
  swap.transactionId = transactionId
  swap.txHash = txHash
  swap.timestamp = timestamp
  swap.block = blockNumber
  
  // Token details
  swap.fromAssetId = fromAssetId
  swap.toAssetId = toAssetId
  swap.fromAmount = fromAmount
  swap.toAmount = toAmount
  
  // Calculate USD amounts
  let fromDecimals = getTokenDecimalsWithFallback(fromAssetId)
  let toDecimals = getTokenDecimalsWithFallback(toAssetId)
  
  let fromAmountHuman = toHumanAmount(fromAmount, fromDecimals)
  let toAmountHuman = toHumanAmount(toAmount, toDecimals)
  
  // Handle ETH (zero address) by mapping to WETH for price lookup
  let fromTokenForPrice = fromAssetId.equals(Address.zero()) ? WETH : fromAssetId
  let toTokenForPrice = toAssetId.equals(Address.zero()) ? WETH : toAssetId
  
  let fromPrice = getTokenPriceUSD(fromTokenForPrice, timestamp, false)
  let toPrice = getTokenPriceUSD(toTokenForPrice, timestamp, false)
  
  swap.fromAmountUSD = fromPrice.times(fromAmountHuman)
  swap.toAmountUSD = toPrice.times(toAmountHuman)
  
  // Calculate expected output and slippage
  let expectedToAmountUSD = calculateExpectedOutput(fromAmount, fromAssetId, toAssetId, timestamp)
  swap.expectedToAmountUSD = expectedToAmountUSD
  
  // Calculate slippage
  if (expectedToAmountUSD.gt(BigDecimal.zero())) {
    swap.slippageUSD = expectedToAmountUSD.minus(swap.toAmountUSD)
    swap.slippagePercentage = swap.slippageUSD.div(expectedToAmountUSD).times(BigDecimal.fromString("100"))
  } else {
    swap.slippageUSD = BigDecimal.zero()
    swap.slippagePercentage = BigDecimal.zero()
  }
  
  // Initialize association status
  swap.isAssociated = false
  swap.associatedPosition = null
  swap.expiresAt = timestamp.plus(ASSOCIATION_WINDOW)
  
  swap.save()
  
  // Add swap to flattened buffer for deterministic association
  addSwapToBuffer(agent, timestamp, swapId, swap.slippageUSD, swap.expiresAt)
}

// Add swap to flattened buffer for later association (Mode format)
function addSwapToBuffer(agent: Address, timestamp: BigInt, swapId: Bytes, slippageUSD: BigDecimal, expiresAt: BigInt): void {
  const bufferId = agent
  
  let buffer = AgentSwapBuffer.load(bufferId)
  if (!buffer) {
    buffer = new AgentSwapBuffer(bufferId)
    buffer.agent = agent
    buffer.bucket0Swaps = ""
    buffer.bucket1Swaps = ""
    buffer.bucket2Swaps = ""
    buffer.bucket3Swaps = ""
    buffer.totalSlippageUSD = BigDecimal.zero()
    buffer.lastUpdated = timestamp
    buffer.currentBucketIndex = getBucketIndex(timestamp)
  }
  
  // Check if we need to rotate buckets
  const newBucketIndex = getBucketIndex(timestamp)
  if (newBucketIndex > buffer.currentBucketIndex) {
    // Rotate buckets: 0→1, 1→2, 2→3, 3→discard
    buffer.bucket3Swaps = buffer.bucket2Swaps
    buffer.bucket2Swaps = buffer.bucket1Swaps
    buffer.bucket1Swaps = buffer.bucket0Swaps
    buffer.bucket0Swaps = ""
    buffer.currentBucketIndex = newBucketIndex
  }
  
  // Add swap to current bucket (bucket0) - use Mode format with pipe separator
  const swapData = createSwapDataString(swapId, slippageUSD, timestamp, expiresAt)
  if (buffer.bucket0Swaps == "") {
    buffer.bucket0Swaps = swapData
  } else {
    buffer.bucket0Swaps = buffer.bucket0Swaps + "|" + swapData
  }
  
  buffer.totalSlippageUSD = buffer.totalSlippageUSD.plus(slippageUSD)
  buffer.lastUpdated = timestamp
  buffer.save()
}

/**
 * Search for recent swaps and associate them with a position using flattened buffer
 * Called from position creation handlers
 * 
 * Simplified approach: single entity load, check buckets sequentially
 */
export function searchAndAssociateRecentSwaps(position: ProtocolPosition): void {
  const agent = position.agent
  const bufferId = agent
  
  let buffer = AgentSwapBuffer.load(bufferId)
  
  if (!buffer) {
    // No swaps found - position has zero slippage costs
    log.info("SWAP ASSOCIATION: Position {} found no swap buffer", [
      position.id.toHexString()
    ])
    return
  }
  
  // Check buckets sequentially (most recent first)
  let consumedSwaps = ""
  let totalSlippage = BigDecimal.zero()
  
  if (buffer.bucket0Swaps != "") {
    consumedSwaps = buffer.bucket0Swaps
    totalSlippage = parseTotalSlippageFromBucket(buffer.bucket0Swaps)
    buffer.bucket0Swaps = ""
  } else if (buffer.bucket1Swaps != "") {
    consumedSwaps = buffer.bucket1Swaps
    totalSlippage = parseTotalSlippageFromBucket(buffer.bucket1Swaps)
    buffer.bucket1Swaps = ""
  } else if (buffer.bucket2Swaps != "") {
    consumedSwaps = buffer.bucket2Swaps
    totalSlippage = parseTotalSlippageFromBucket(buffer.bucket2Swaps)
    buffer.bucket2Swaps = ""
  } else if (buffer.bucket3Swaps != "") {
    consumedSwaps = buffer.bucket3Swaps
    totalSlippage = parseTotalSlippageFromBucket(buffer.bucket3Swaps)
    buffer.bucket3Swaps = ""
  }
  
  if (consumedSwaps != "") {
    // Found and consumed swaps
    buffer.totalSlippageUSD = buffer.totalSlippageUSD.minus(totalSlippage)
    buffer.save()
    
    // Update position costs
    updatePositionCosts(position, totalSlippage)
    
    log.info("SWAP ASSOCIATION: Position {} consumed swaps with total slippage: {} USD", [
      position.id.toHexString(),
      totalSlippage.toString()
    ])
  } else {
    // No swaps found - position has zero slippage costs
    log.info("SWAP ASSOCIATION: Position {} found no associated swaps", [
      position.id.toHexString()
    ])
  }
}

/**
 * Associate a specific swap with a position (public function)
 */
export function associateSwapWithPosition(swap: SwapTransaction, position: ProtocolPosition): void {
  // Update swap
  swap.isAssociated = true
  swap.associatedPosition = position.id
  swap.save()
  
  // Create or update association
  let associationId = position.id
  let association = SwapToEntryAssociation.load(associationId)
  
  if (association == null) {
    association = new SwapToEntryAssociation(associationId)
    association.position = position.id
    association.swaps = []
    association.totalSlippageUSD = BigDecimal.zero()
    association.associationTimestamp = swap.timestamp
  }
  
  // Add swap to association
  let swaps = association.swaps
  swaps.push(swap.id)
  association.swaps = swaps
  association.totalSlippageUSD = association.totalSlippageUSD.plus(swap.slippageUSD)
  
  association.save()
  
  // Update position costs
  updatePositionCosts(position, association.totalSlippageUSD)
  
  log.info("SWAP ASSOCIATION: Linked swap {} to position {} - slippage: {} USD", [
    swap.id.toHexString(),
    position.id.toHexString(),
    swap.slippageUSD.toString()
  ])
}

// Update position costs with slippage (private function)
function updatePositionCosts(position: ProtocolPosition, totalSlippageUSD: BigDecimal): void {
  position.swapSlippageUSD = totalSlippageUSD
  position.totalCostsUSD = position.swapSlippageUSD // Add other costs here if needed
  position.investmentUSD = position.entryAmountUSD.plus(position.totalCostsUSD)
  
  // If position is closed, calculate ROI
  let exitAmount = position.exitAmountUSD as BigDecimal | null
  if (!position.isActive && exitAmount != null) {
    position.grossGainUSD = exitAmount
    position.netGainUSD = position.grossGainUSD.minus(position.investmentUSD)
    
    if (position.investmentUSD.gt(BigDecimal.zero())) {
      position.positionROI = position.netGainUSD.div(position.investmentUSD).times(BigDecimal.fromString("100"))
    } else {
      position.positionROI = BigDecimal.zero()
    }
  }
  
  position.save()
}
