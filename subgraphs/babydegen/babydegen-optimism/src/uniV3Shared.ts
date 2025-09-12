import { Address, BigDecimal, BigInt, ethereum, Bytes, log } from "@graphprotocol/graph-ts"
// NOTE: These imports will work once Uniswap V3 is added to subgraph.yaml and types are generated
import { NonfungiblePositionManager } from "../../../../generated/UniV3NFTManager/NonfungiblePositionManager"
import { UniswapV3Pool } from "../../../../generated/UniV3NFTManager/UniswapV3Pool"
import { UniswapV3Factory } from "../../../../generated/UniV3NFTManager/UniswapV3Factory"
// import { UniV3Pool } from "../../../../generated/templates" // Removed - using snapshot approach instead of real-time tracking
import { LiquidityAmounts } from "./libraries/LiquidityAmounts"
import { TickMath } from "./libraries/TickMath"
import { ProtocolPosition, Service, AgentSwapBuffer } from "../generated/schema"
import { refreshPortfolio } from "./common"
import { addAgentNFTToPool, removeAgentNFTFromPool, getCachedPoolAddress, cachePoolAddress } from "./poolIndexCache"
import { getTokenPriceUSD } from "./priceDiscovery"
import { UNI_V3_MANAGER, UNI_V3_FACTORY } from "./constants"
import { isServiceAgent, getServiceByAgent } from "./config"
import { getTokenDecimals, getTokenSymbol } from "./tokenUtils"
import { updateFirstTradingTimestamp } from "./helpers"
import { initializePositionCosts } from "./roiCalculation"
import { searchAndAssociateRecentSwaps } from "./swapTracking"

// Helper function to convert token amount from wei to human readable
function convertTokenAmount(amount: BigInt, tokenAddress: Address): BigDecimal {
  const decimals = getTokenDecimals(tokenAddress)
  const divisor = BigDecimal.fromString("1e" + decimals.toString())
  return amount.toBigDecimal().div(divisor)
}

// Create or get Uniswap V3 position ID (consistent with Velodrome V2 pattern)
export function getUniV3PositionId(userAddress: Address, tokenId: BigInt): Bytes {
  // For Uniswap V3, we use user-tokenId combination as position ID
  const positionId = userAddress.toHex() + "-" + tokenId.toString()
  return Bytes.fromUTF8(positionId)
}

// Helper function to derive pool address from position data with caching
function getUniV3PoolAddress(token0: Address, token1: Address, fee: i32, tokenId: BigInt | null = null): Address {
  // Try cache first if we have a tokenId
  if (tokenId !== null) {
    const cached = getCachedPoolAddress("uniswap-v3", tokenId)
    if (cached !== null) {
      return cached
    }
  }
  
  // Factory call
  const factory = UniswapV3Factory.bind(UNI_V3_FACTORY)
  const poolResult = factory.try_getPool(token0, token1, fee as i32)
  
  if (poolResult.reverted) {
    log.error("UNISWAP V3: Failed to get pool from factory for tokens: {} / {}", [
      token0.toHexString(),
      token1.toHexString()
    ])
    return Address.zero()
  }
  
  const poolAddress = poolResult.value
  
  // Cache the result if we have a tokenId
  if (tokenId !== null) {
    cachePoolAddress("uniswap-v3", tokenId, poolAddress)
  }
  
  return poolAddress
}

// 1. Register NFT to pool mapping (no template creation - using snapshot approach)
export function ensureUniV3PoolTemplate(tokenId: BigInt): void {
  const mgr = NonfungiblePositionManager.bind(UNI_V3_MANAGER)
  const posResult = mgr.try_positions(tokenId)
  
  if (posResult.reverted) {
    log.error("UNISWAP V3: Failed to get position data for tokenId: {}", [tokenId.toString()])
    return
  }
  
  const pos = posResult.value
  
  // Derive pool address from position data with caching
  const poolAddress = getUniV3PoolAddress(pos.value2, pos.value3, pos.value4, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    log.error("UNISWAP V3: Failed to derive pool address for tokenId: {}", [tokenId.toString()])
    return
  }
  
  // NOTE: Pool template creation removed - using portfolio snapshot approach instead of real-time tracking
  // UniV3Pool.create(poolAddress) // REMOVED
  
  // Still maintain the NFT-to-pool mapping for cache purposes
  addAgentNFTToPool("uniswap-v3", poolAddress, tokenId)
}

// Helper function to check if position is closed
function isPositionClosed(liquidity: BigInt, amount0: BigDecimal, amount1: BigDecimal): boolean {
  const isLiquidityZero = liquidity.equals(BigInt.zero())
  const areAmountsZero = amount0.equals(BigDecimal.zero()) && amount1.equals(BigDecimal.zero())
    
  return isLiquidityZero || areAmountsZero
}

// 2a. Re-price NFT into USD + persist using actual event amounts for entry data
export function refreshUniV3PositionWithEventAmounts(
  tokenId: BigInt, 
  block: ethereum.Block, 
  eventAmount0: BigInt,
  eventAmount1: BigInt,
  txHash: Bytes = Bytes.empty()
): void {
  const mgr = NonfungiblePositionManager.bind(UNI_V3_MANAGER)
  
  // First, get the actual NFT owner
  const ownerResult = mgr.try_ownerOf(tokenId)
  if (ownerResult.reverted) {
    log.error("UNISWAP V3: Failed to get owner for tokenId: {}", [tokenId.toString()])
    return
  }
  
  const nftOwner = ownerResult.value

  // AGENT FILTERING: Only process positions owned by a service
  if (!isServiceAgent(nftOwner)) {
    return
  }

  const dataResult = mgr.try_positions(tokenId)
  
  if (dataResult.reverted) {
    log.error("UNISWAP V3: positions() call failed for tokenId: {}", [tokenId.toString()])
    return
  }
  
  const data = dataResult.value

  // Derive pool address from position data with caching  
  const poolAddress = getUniV3PoolAddress(data.value2, data.value3, data.value4, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    log.error("UNISWAP V3: Failed to derive pool address for tokenId: {}", [tokenId.toString()])
    return
  }

  // USD pricing for event amounts
  const token0Price = getTokenPriceUSD(data.value2, block.timestamp, false)
  const token1Price = getTokenPriceUSD(data.value3, block.timestamp, false)

  // Convert event amounts from wei to human readable using proper decimals
  const eventAmount0Human = convertTokenAmount(eventAmount0, data.value2) // token0
  const eventAmount1Human = convertTokenAmount(eventAmount1, data.value3) // token1
  
  
  const eventUsd0 = eventAmount0Human.times(token0Price)
  const eventUsd1 = eventAmount1Human.times(token1Price)
  const eventUsd = eventUsd0.plus(eventUsd1)

  // write ProtocolPosition - use consistent ID pattern like Velodrome V2
  const positionId = getUniV3PositionId(nftOwner, tokenId)
  let pp = ProtocolPosition.load(positionId)
  const isNewPosition = pp == null
  
  if (pp == null) {
    pp = new ProtocolPosition(positionId)
    pp.agent = nftOwner
    pp.protocol = "uniswap-v3"
    pp.pool = poolAddress
    pp.tokenId = tokenId
    pp.isActive = true
    
    // Add service tracking (same as Velodrome)
    pp.service = nftOwner // Link to service
    
    // Update service positionIds array
    let service = Service.load(nftOwner)
    if (service != null) {
      if (service.positionIds == null) {
        service.positionIds = []
      }
      let positionIds = service.positionIds
      let positionIdString = positionId.toString()  // Get original string before hex encoding
      if (positionIds.indexOf(positionIdString) == -1) {
        positionIds.push(positionIdString)
        service.positionIds = positionIds
        service.save()
      }
      
      // Update first trading timestamp
      updateFirstTradingTimestamp(nftOwner, block.timestamp)
    }
    
    // Set static position metadata
    pp.tickLower = data.value5 as i32
    pp.tickUpper = data.value6 as i32
    pp.fee = data.value4
    
    // Set entry data using ACTUAL EVENT AMOUNTS (not calculated)
    pp.entryTxHash = txHash
    pp.entryTimestamp = block.timestamp
    pp.entryAmount0 = eventAmount0Human  // Use actual event amount
    pp.entryAmount0USD = eventUsd0       // Use actual event amount
    pp.entryAmount1 = eventAmount1Human  // Use actual event amount
    pp.entryAmount1USD = eventUsd1       // Use actual event amount
    pp.entryAmountUSD = eventUsd
    
    // Set additional required fields to ensure they are not null
    pp.usdCurrent = eventUsd
    pp.amount0 = eventAmount0Human
    pp.amount1 = eventAmount1Human
    pp.amount0USD = eventUsd0
    pp.amount1USD = eventUsd1
    pp.token0 = data.value2
    pp.token1 = data.value3
    pp.token0Symbol = getTokenSymbol(data.value2)
    pp.token1Symbol = getTokenSymbol(data.value3)
    pp.liquidity = data.value7
    
    // Initialize cost tracking for new position (AFTER all required fields are set)
    initializePositionCosts(pp)
    
    // Save entry data first
    pp.save()
    
    // INLINE SWAP ASSOCIATION: All entity operations must be inline to avoid compiler crash
    const bufferId = nftOwner
    let buffer = AgentSwapBuffer.load(bufferId)
    
    if (buffer) {
      // Check buckets sequentially (most recent first) - all inline
      let consumedSwaps = ""
      let totalSlippage = BigDecimal.zero()
      
      if (buffer.bucket0Swaps != "") {
        consumedSwaps = buffer.bucket0Swaps
        // Simple slippage parsing inline
        let swaps = buffer.bucket0Swaps.split(",")
        for (let i = 0; i < swaps.length; i++) {
          let parts = swaps[i].split(":")
          if (parts.length == 2) {
            totalSlippage = totalSlippage.plus(BigDecimal.fromString(parts[1]))
          }
        }
        buffer.bucket0Swaps = ""
      } else if (buffer.bucket1Swaps != "") {
        consumedSwaps = buffer.bucket1Swaps
        let swaps = buffer.bucket1Swaps.split(",")
        for (let i = 0; i < swaps.length; i++) {
          let parts = swaps[i].split(":")
          if (parts.length == 2) {
            totalSlippage = totalSlippage.plus(BigDecimal.fromString(parts[1]))
          }
        }
        buffer.bucket1Swaps = ""
      } else if (buffer.bucket2Swaps != "") {
        consumedSwaps = buffer.bucket2Swaps
        let swaps = buffer.bucket2Swaps.split(",")
        for (let i = 0; i < swaps.length; i++) {
          let parts = swaps[i].split(":")
          if (parts.length == 2) {
            totalSlippage = totalSlippage.plus(BigDecimal.fromString(parts[1]))
          }
        }
        buffer.bucket2Swaps = ""
      } else if (buffer.bucket3Swaps != "") {
        consumedSwaps = buffer.bucket3Swaps
        let swaps = buffer.bucket3Swaps.split(",")
        for (let i = 0; i < swaps.length; i++) {
          let parts = swaps[i].split(":")
          if (parts.length == 2) {
            totalSlippage = totalSlippage.plus(BigDecimal.fromString(parts[1]))
          }
        }
        buffer.bucket3Swaps = ""
      }
      
      if (consumedSwaps != "") {
        // Found and consumed swaps - update costs inline
        buffer.totalSlippageUSD = buffer.totalSlippageUSD.minus(totalSlippage)
        buffer.save()
        
        // Update position costs inline
        pp.swapSlippageUSD = totalSlippage
        pp.totalCostsUSD = pp.swapSlippageUSD
        pp.investmentUSD = pp.entryAmountUSD.plus(pp.totalCostsUSD)
      }
    }
    
    // For new positions, calculate current amounts using liquidity math (not event amounts)
    // Call refreshUniV3Position to get current calculated amounts
    refreshUniV3Position(tokenId, block, txHash) // This will update current amounts
    return // Exit early since refreshUniV3Position will save the entity
  } else {
    
    // For existing positions, update entry amounts if this is an IncreaseLiquidity event
    // Add to existing entry amounts
    pp.entryAmount0 = pp.entryAmount0.plus(eventAmount0Human)
    pp.entryAmount0USD = pp.entryAmount0USD.plus(eventUsd0)
    pp.entryAmount1 = pp.entryAmount1.plus(eventAmount1Human)
    pp.entryAmount1USD = pp.entryAmount1USD.plus(eventUsd1)
    pp.entryAmountUSD = pp.entryAmountUSD.plus(eventUsd)
    
    
    // Save the updated entry amounts first
    pp.save()
    
    // Update current amounts by calling the regular refresh function
    refreshUniV3Position(tokenId, block, txHash)
    return // Exit early since refreshUniV3Position will save the entity
  }
}

// 2b. Handle position exit with actual event amounts
export function refreshUniV3PositionWithExitAmounts(
  tokenId: BigInt, 
  block: ethereum.Block, 
  eventAmount0: BigInt,
  eventAmount1: BigInt,
  liquidityRemoved: BigInt,
  txHash: Bytes = Bytes.empty()
): void {
  const mgr = NonfungiblePositionManager.bind(UNI_V3_MANAGER)
  
  // First, get the actual NFT owner
  const ownerResult = mgr.try_ownerOf(tokenId)
  if (ownerResult.reverted) {
    log.error("UNISWAP V3: Failed to get owner for tokenId: {}", [tokenId.toString()])
    return
  }
  
  const nftOwner = ownerResult.value

  // AGENT FILTERING: Only process positions owned by a service
  if (!isServiceAgent(nftOwner)) {
    return
  }

  const dataResult = mgr.try_positions(tokenId)
  
  if (dataResult.reverted) {
    log.error("UNISWAP V3: positions() call failed for tokenId: {}", [tokenId.toString()])
    return
  }
  
  const data = dataResult.value
  
  // Load existing position using consistent ID pattern
  const positionId = getUniV3PositionId(nftOwner, tokenId)
  let pp = ProtocolPosition.load(positionId)
  
  if (pp == null) {
    log.error("UNISWAP V3: Position {} not found for exit processing", [tokenId.toString()])
    return
  }
  
  // Check if this is a full exit (all liquidity removed)
  const remainingLiquidity = data.value7
  const isFullExit = remainingLiquidity.equals(BigInt.zero())
  
  if (isFullExit) {
    
    // USD pricing for exit amounts
    const token0Price = getTokenPriceUSD(data.value2, block.timestamp, false)
    const token1Price = getTokenPriceUSD(data.value3, block.timestamp, false)
    
    // Convert exit amounts from wei to human readable
    const exitAmount0Human = convertTokenAmount(eventAmount0, data.value2)
    const exitAmount1Human = convertTokenAmount(eventAmount1, data.value3)
    
    const exitUsd0 = exitAmount0Human.times(token0Price)
    const exitUsd1 = exitAmount1Human.times(token1Price)
    const exitUsd = exitUsd0.plus(exitUsd1)
    
    // Set exit data using ACTUAL EVENT AMOUNTS
    pp.isActive = false
    pp.exitTxHash = txHash
    pp.exitTimestamp = block.timestamp
    pp.exitAmount0 = exitAmount0Human
    pp.exitAmount0USD = exitUsd0
    pp.exitAmount1 = exitAmount1Human
    pp.exitAmount1USD = exitUsd1
    pp.exitAmountUSD = exitUsd
    
    // Update current amounts to 0 (since position is closed)
    pp.amount0 = BigDecimal.zero()
    pp.amount1 = BigDecimal.zero()
    pp.amount0USD = BigDecimal.zero()
    pp.amount1USD = BigDecimal.zero()
    pp.usdCurrent = BigDecimal.zero()
    pp.liquidity = BigInt.zero()
    
    
    // Remove from cache
    const poolAddress = getUniV3PoolAddress(data.value2, data.value3, data.value4, tokenId)
    removeAgentNFTFromPool("uniswap-v3", poolAddress, tokenId)
    
    pp.save()
    refreshPortfolio(nftOwner, block)
  } else {
    // Partial withdrawal - just update current amounts normally
    refreshUniV3Position(tokenId, block, txHash)
  }
}

// 2c. Re-price NFT into USD + persist (for non-entry events)
export function refreshUniV3Position(tokenId: BigInt, block: ethereum.Block, txHash: Bytes = Bytes.empty()): void {
  const mgr = NonfungiblePositionManager.bind(UNI_V3_MANAGER)
  
  // First, get the actual NFT owner
  const ownerResult = mgr.try_ownerOf(tokenId)
  if (ownerResult.reverted) {
    log.error("UNISWAP V3: Failed to get owner for tokenId: {}", [tokenId.toString()])
    return
  }
  
  const nftOwner = ownerResult.value

  // AGENT FILTERING: Only process positions owned by a service
  if (!isServiceAgent(nftOwner)) {
    return
  }

  // Early check - don't process closed positions using consistent ID pattern
  const positionId = getUniV3PositionId(nftOwner, tokenId)
  let position = ProtocolPosition.load(positionId)
  
  if (position && !position.isActive) {
    return
  }
  
  const dataResult = mgr.try_positions(tokenId)
  
  if (dataResult.reverted) {
    log.error("UNISWAP V3: positions() call failed for tokenId: {}", [tokenId.toString()])
    return
  }
  
  const data = dataResult.value

  // Derive pool address from position data with caching  
  const poolAddress = getUniV3PoolAddress(data.value2, data.value3, data.value4, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    log.error("UNISWAP V3: Failed to derive pool address for tokenId: {}", [tokenId.toString()])
    return
  }
  
  // pool state
  const pool = UniswapV3Pool.bind(poolAddress)
  const slot0Result = pool.try_slot0()
  
  if (slot0Result.reverted) {
    log.error("UNISWAP V3: Failed to get slot0 from pool: {}", [poolAddress.toHexString()])
    return
  }
  
  const slot0 = slot0Result.value

  // convert liquidity → token amounts
  const tickLower = data.value5 as i32
  const tickUpper = data.value6 as i32
  
  const sqrtPa = TickMath.getSqrtRatioAtTick(tickLower)
  const sqrtPb = TickMath.getSqrtRatioAtTick(tickUpper)
  
  const amounts = LiquidityAmounts.getAmountsForLiquidity(
                    slot0.value0, sqrtPa, sqrtPb, data.value7)


  // USD pricing
  const token0Price = getTokenPriceUSD(data.value2, block.timestamp, false)
  const token1Price = getTokenPriceUSD(data.value3, block.timestamp, false)

  // Convert amounts from wei to human readable using proper decimals
  const amount0Human = convertTokenAmount(amounts.amount0, data.value2) // token0
  const amount1Human = convertTokenAmount(amounts.amount1, data.value3) // token1
  
  const usd0 = amount0Human.times(token0Price)
  const usd1 = amount1Human.times(token1Price)
  const usd = usd0.plus(usd1)

  // write ProtocolPosition - use consistent ID pattern
  let pp = ProtocolPosition.load(positionId)
  const isNewPosition = pp == null
  
  if (pp == null) {
    pp = new ProtocolPosition(positionId)
    pp.agent = nftOwner
    pp.protocol = "uniswap-v3"
    pp.pool = poolAddress
    pp.tokenId = tokenId
    pp.isActive = true
    
    // Add service tracking (same as Velodrome)
    pp.service = nftOwner // Link to service
    
    // Update service positionIds array
    let service = Service.load(nftOwner)
    if (service != null) {
      if (service.positionIds == null) {
        service.positionIds = []
      }
      let positionIds = service.positionIds
      let positionIdString = positionId.toString()  // Get original string before hex encoding
      if (positionIds.indexOf(positionIdString) == -1) {
        positionIds.push(positionIdString)
        service.positionIds = positionIds
        service.save()
      }
      
      // Update first trading timestamp
      updateFirstTradingTimestamp(nftOwner, block.timestamp)
    }
    
    // Set static position metadata
    pp.tickLower = tickLower
    pp.tickUpper = tickUpper
    pp.fee = data.value4 // Uniswap V3 uses fee (500, 3000, 10000)
    
    // CRITICAL FIX: Set ALL required fields BEFORE calling initializePositionCosts
    // Set current state fields first
    pp.usdCurrent = usd
    pp.token0 = data.value2
    pp.token0Symbol = getTokenSymbol(data.value2)
    pp.amount0 = amount0Human
    pp.amount0USD = usd0
    pp.token1 = data.value3
    pp.token1Symbol = getTokenSymbol(data.value3)
    pp.amount1 = amount1Human
    pp.amount1USD = usd1
    pp.liquidity = data.value7
    
    // Initialize entry data for new positions
    // Entry amounts will be set by refreshUniV3PositionWithEventAmounts
    // But we need to capture the initial transaction data
    pp.entryTxHash = txHash
    pp.entryTimestamp = block.timestamp
    pp.entryAmount0 = BigDecimal.zero()
    pp.entryAmount0USD = BigDecimal.zero()
    pp.entryAmount1 = BigDecimal.zero()
    pp.entryAmount1USD = BigDecimal.zero()
    pp.entryAmountUSD = BigDecimal.zero()
    
    // Initialize cost tracking for new position (AFTER all required fields are set)
    initializePositionCosts(pp)
    
  }
  // For existing positions, DO NOT overwrite entry data - it should be set by refreshUniV3PositionWithEventAmounts
  
  // Update current state (for both new and existing positions)
  pp.usdCurrent = usd
  pp.token0 = data.value2
  pp.token0Symbol = getTokenSymbol(data.value2)
  pp.amount0 = amount0Human
  pp.amount0USD = usd0
  pp.token1 = data.value3
  pp.token1Symbol = getTokenSymbol(data.value3)
  pp.amount1 = amount1Human
  pp.amount1USD = usd1
  pp.liquidity = data.value7
  
  // Check if position should be closed
  if (isPositionClosed(data.value7, amount0Human, amount1Human)) {
    pp.isActive = false
    pp.exitTxHash = txHash
    pp.exitTimestamp = block.timestamp
    pp.exitAmount0 = amount0Human
    pp.exitAmount0USD = usd0
    pp.exitAmount1 = amount1Human
    pp.exitAmount1USD = usd1
    pp.exitAmountUSD = usd
    
    // Remove from cache to prevent future swap updates
    removeAgentNFTFromPool("uniswap-v3", poolAddress, tokenId)
  }
  
  pp.save()

  // bubble up to AgentPortfolio
  refreshPortfolio(nftOwner, block)
}

// 3. Handle NFT transfers (add/remove from cache)
export function handleUniV3NFTTransferForCache(tokenId: BigInt, from: Address, to: Address): void {
  const mgr = NonfungiblePositionManager.bind(UNI_V3_MANAGER)
  const posResult = mgr.try_positions(tokenId)
  
  if (posResult.reverted) {
    log.error("UNISWAP V3: Failed to get position data for tokenId: {} in handleUniV3NFTTransferForCache", [tokenId.toString()])
    return
  }
  
  const pos = posResult.value
  
  // Derive pool address from position data with caching
  const poolAddress = getUniV3PoolAddress(pos.value2, pos.value3, pos.value4, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    log.error("UNISWAP V3: Failed to derive pool address for tokenId: {} in handleUniV3NFTTransferForCache", [tokenId.toString()])
    return
  }
  
  // Remove from cache if transferring out
  if (!from.equals(Address.zero())) {
    removeAgentNFTFromPool("uniswap-v3", poolAddress, tokenId)
  }
  
  // Add to cache if transferring in
  if (!to.equals(Address.zero())) {
    addAgentNFTToPool("uniswap-v3", poolAddress, tokenId)
  }
}
