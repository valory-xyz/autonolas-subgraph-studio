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

// Check if a token is a stablecoin (Optimism network stablecoins)
function isStablecoin(tokenAddress: Address): boolean {
  let tokenHex = tokenAddress.toHexString().toLowerCase()
  
  // Optimism stablecoins - direct comparison to avoid array iteration issues
  if (tokenHex == "0x0b2c639c533813f4aa9d7837caf62653d097ff85") return true // USDC Native
  if (tokenHex == "0x7f5c764cbc14f9669b88837ca1490cca17c31607") return true // USDC Bridged
  if (tokenHex == "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58") return true // USDT
  if (tokenHex == "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1") return true // DAI
  if (tokenHex == "0xc40f949f8a4e094d1b49a23ea9241d289b7b2819") return true // LUSD
  if (tokenHex == "0x8ae125e8653821e851f12a49f7765db9a9ce7384") return true // DOLA
  
  return false
}

// Get token decimals with fallback
function getTokenDecimalsWithFallback(tokenAddress: Address): i32 {
  // For stablecoins, use 6 decimals
  if (isStablecoin(tokenAddress)) {
    return 6
  }
  
  // For other tokens, use 18 decimals (most common)
  return 18
}

// Calculate expected output amount for slippage calculation
function calculateExpectedOutput(
  fromAmount: BigInt,
  fromToken: Address,
  toToken: Address,
  timestamp: BigInt
): BigDecimal {
  // Get token prices
  let fromPrice = getTokenPriceUSD(fromToken, timestamp, false)
  let toPrice = getTokenPriceUSD(toToken, timestamp, false)
  
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
function createSwapDataString(swapId: Bytes, slippageUSD: BigDecimal): string {
  // Simple format: "swapId:slippage"
  return swapId.toHexString() + ":" + slippageUSD.toString()
}

// Helper function to parse total slippage from bucket string
function parseTotalSlippageFromBucket(bucketSwaps: string): BigDecimal {
  if (bucketSwaps == "[]" || bucketSwaps == "") {
    return BigDecimal.zero()
  }
  
  let totalSlippage = BigDecimal.zero()
  
  // Simple parsing: split by comma, then by colon
  let swaps = bucketSwaps.split(",")
  for (let i = 0; i < swaps.length; i++) {
    let parts = swaps[i].split(":")
    if (parts.length == 2) {
      let slippage = BigDecimal.fromString(parts[1])
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
  
  let fromPrice = getTokenPriceUSD(fromAssetId, timestamp, false)
  let toPrice = getTokenPriceUSD(toAssetId, timestamp, false)
  
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
  addSwapToBuffer(agent, timestamp, swapId, swap.slippageUSD)
  
  log.info("SWAP: Created SwapTransaction {} for agent {} - slippage: {} USD ({}%)", [
    swapId.toHexString(),
    agent.toHexString(),
    swap.slippageUSD.toString(),
    swap.slippagePercentage.toString()
  ])
}

// Add swap to flattened buffer for later association
function addSwapToBuffer(agent: Address, timestamp: BigInt, swapId: Bytes, slippageUSD: BigDecimal): void {
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
  
  // Add swap to current bucket (bucket0)
  const swapData = createSwapDataString(swapId, slippageUSD)
  if (buffer.bucket0Swaps == "") {
    buffer.bucket0Swaps = swapData
  } else {
    buffer.bucket0Swaps = buffer.bucket0Swaps + "," + swapData
  }
  
  buffer.totalSlippageUSD = buffer.totalSlippageUSD.plus(slippageUSD)
  buffer.lastUpdated = timestamp
  buffer.save()
  
  log.info("SWAP BUFFER: Added swap {} to buffer {} - total slippage: {} USD", [
    swapId.toHexString(),
    bufferId.toHexString(),
    buffer.totalSlippageUSD.toString()
  ])
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
