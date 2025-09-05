import { Address, BigDecimal, BigInt, ethereum, Bytes, log } from "@graphprotocol/graph-ts"
import { NonfungiblePositionManager } from "../../../../generated/VeloNFTManager/NonfungiblePositionManager"
import { VelodromeCLPool }            from "../../../../generated/VeloNFTManager/VelodromeCLPool"
import { VelodromeCLFactory }         from "../../../../generated/VeloNFTManager/VelodromeCLFactory"
// import { VeloCLPool }                 from "../../../../generated/templates" // Removed - using snapshot approach instead of real-time tracking
import { LiquidityAmounts }           from "./libraries/LiquidityAmounts"
import { TickMath }                   from "./libraries/TickMath"
import { ProtocolPosition, Service }  from "../../../../generated/schema"
import { getUsd, refreshPortfolio }   from "./common"
import { addAgentNFTToPool, removeAgentNFTFromPool, getCachedPoolAddress, cachePoolAddress } from "./poolIndexCache"
import { getTokenPriceUSD } from "./priceDiscovery"
import { VELO_MANAGER, VELO_FACTORY } from "./constants"
import { isServiceAgent, getServiceByAgent } from "./config"
import { updateFirstTradingTimestamp } from "./helpers"
import { getTokenDecimals, getTokenSymbol } from "./tokenUtils"

// Helper function to convert token amount from wei to human readable
function convertTokenAmount(amount: BigInt, tokenAddress: Address): BigDecimal {
  const decimals = getTokenDecimals(tokenAddress)
  const divisor = BigDecimal.fromString("1e" + decimals.toString())
  return amount.toBigDecimal().div(divisor)
}

// Create or get Velodrome CL position ID (consistent with Velodrome V2 pattern)
export function getVeloCLPositionId(userAddress: Address, tokenId: BigInt): Bytes {
  // For Velodrome CL, we use user-tokenId combination as position ID
  const positionId = userAddress.toHex() + "-" + tokenId.toString()
  return Bytes.fromUTF8(positionId)
}

// Helper function to derive pool address from position data with caching
function getPoolAddress(token0: Address, token1: Address, tickSpacing: i32, tokenId: BigInt | null = null): Address {
  // Try cache first if we have a tokenId
  if (tokenId !== null) {
    const cached = getCachedPoolAddress("velodrome-cl", tokenId)
    if (cached !== null) {
      return cached
    }
  }
  
  // Factory call as last resort
  const factory = VelodromeCLFactory.bind(VELO_FACTORY)
  const poolResult = factory.try_getPool(token0, token1, tickSpacing)
  
  if (poolResult.reverted) {
    // Try with reversed token order
    const reversedResult = factory.try_getPool(token1, token0, tickSpacing)
    
    if (reversedResult.reverted) {
      return Address.zero()
    }
    
    const poolAddress = reversedResult.value
    
    // Cache the result if we have a tokenId
    if (tokenId !== null) {
      cachePoolAddress("velodrome-cl", tokenId, poolAddress)
    }
    
    return poolAddress
  }
  
  const poolAddress = poolResult.value
  
  // Cache the result if we have a tokenId
  if (tokenId !== null) {
    cachePoolAddress("velodrome-cl", tokenId, poolAddress)
  }
  
  return poolAddress
}

// 1. Register NFT to pool mapping (no template creation - using snapshot approach)
export function ensurePoolTemplate(tokenId: BigInt): void {
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  const posResult = mgr.try_positions(tokenId)
  
  if (posResult.reverted) {
    return
  }
  
  const pos = posResult.value
  
  // Derive pool address from position data with caching
  const poolAddress = getPoolAddress(pos.value2, pos.value3, pos.value4 as i32, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    return
  }
  
  // NOTE: Pool template creation removed - using portfolio snapshot approach instead of real-time tracking
  // VeloCLPool.create(poolAddress) // REMOVED
  
  // Still maintain the NFT-to-pool mapping for cache purposes
  addAgentNFTToPool("velodrome-cl", poolAddress, tokenId)
}

// Helper function to check if position is closed
function isPositionClosed(liquidity: BigInt, amount0: BigDecimal, amount1: BigDecimal): boolean {
  const isLiquidityZero = liquidity.equals(BigInt.zero())
  const areAmountsZero = amount0.equals(BigDecimal.zero()) && amount1.equals(BigDecimal.zero())
    
  return isLiquidityZero || areAmountsZero
}

// 2a. Re-price NFT into USD + persist using actual event amounts for entry data
export function refreshVeloCLPositionWithEventAmounts(
  tokenId: BigInt, 
  block: ethereum.Block, 
  eventAmount0: BigInt,
  eventAmount1: BigInt,
  txHash: Bytes = Bytes.empty()
): void {
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  
  // First, get the actual NFT owner
  const ownerResult = mgr.try_ownerOf(tokenId)
  if (ownerResult.reverted) {
    return
  }
  
  const nftOwner = ownerResult.value

  // AGENT FILTERING: Only process positions owned by a service
  if (!isServiceAgent(nftOwner)) {
    return
  }

  const dataResult = mgr.try_positions(tokenId)
  
  if (dataResult.reverted) {
    return
  }
  
  const data = dataResult.value

  // Derive pool address from position data with caching  
  const poolAddress = getPoolAddress(data.value2, data.value3, data.value4 as i32, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
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
  const positionId = getVeloCLPositionId(nftOwner, tokenId)
  let pp = ProtocolPosition.load(positionId)
  const isNewPosition = pp == null
  
  if (pp == null) {
    pp = new ProtocolPosition(positionId)
    pp.agent = nftOwner
    pp.service = nftOwner // Link to service
    pp.protocol = "velodrome-cl"
    pp.pool = poolAddress
    pp.tokenId = tokenId
    pp.isActive = true
    
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
    pp.tickSpacing = data.value4
    
    // Set entry data using ACTUAL EVENT AMOUNTS (not calculated)
    pp.entryTxHash = txHash
    pp.entryTimestamp = block.timestamp
    pp.entryAmount0 = eventAmount0Human  // Use actual event amount
    pp.entryAmount0USD = eventUsd0       // Use actual event amount
    pp.entryAmount1 = eventAmount1Human  // Use actual event amount
    pp.entryAmount1USD = eventUsd1       // Use actual event amount
    pp.entryAmountUSD = eventUsd
    
    // For new positions, ensure usdCurrent is explicitly set to prevent "missing non-nullable field" errors
    // Initially set it to match the entry USD value
    pp.usdCurrent = eventUsd
    
    // Set additional required fields to ensure they are not null
    pp.amount0 = eventAmount0Human
    pp.amount1 = eventAmount1Human
    pp.amount0USD = eventUsd0
    pp.amount1USD = eventUsd1
    pp.token0 = data.value2
    pp.token1 = data.value3
    pp.token0Symbol = getTokenSymbol(data.value2)
    pp.token1Symbol = getTokenSymbol(data.value3)
    
    // Save entry data first with all required fields set
    pp.save()
    
    // Then call refreshVeloCLPosition to get more accurate current amounts
    refreshVeloCLPosition(tokenId, block, txHash) // This will update current amounts and save the entity again
    return // Exit early since refreshVeloCLPosition will save the entity
  } else {
    // CRITICAL FIX: Check if this is the first IncreaseLiquidity event for this position
    // The first IncreaseLiquidity event after position creation should set entry amounts
    // Subsequent IncreaseLiquidity events should add to existing entry amounts
    if (pp.entryAmountUSD.equals(BigDecimal.zero()) && pp.entryTimestamp.equals(BigInt.zero())) {
      // This is the FIRST IncreaseLiquidity event for a new position - set initial entry amounts
      pp.entryTxHash = txHash
      pp.entryTimestamp = block.timestamp
      pp.entryAmount0 = eventAmount0Human
      pp.entryAmount0USD = eventUsd0
      pp.entryAmount1 = eventAmount1Human
      pp.entryAmount1USD = eventUsd1
      pp.entryAmountUSD = eventUsd
    } else {
      // This is a subsequent IncreaseLiquidity event - add to existing entry amounts
      pp.entryAmount0 = pp.entryAmount0.plus(eventAmount0Human)
      pp.entryAmount0USD = pp.entryAmount0USD.plus(eventUsd0)
      pp.entryAmount1 = pp.entryAmount1.plus(eventAmount1Human)
      pp.entryAmount1USD = pp.entryAmount1USD.plus(eventUsd1)
      pp.entryAmountUSD = pp.entryAmountUSD.plus(eventUsd)
    }
    
    // Save the updated entry amounts first
    pp.save()
    
    // Update current amounts by calling the regular refresh function
    refreshVeloCLPosition(tokenId, block, txHash)
    return // Exit early since refreshVeloCLPosition will save the entity
  }
}

// 2b. Handle position exit with actual event amounts
export function refreshVeloCLPositionWithExitAmounts(
  tokenId: BigInt, 
  block: ethereum.Block, 
  eventAmount0: BigInt,
  eventAmount1: BigInt,
  liquidityRemoved: BigInt,
  txHash: Bytes = Bytes.empty()
): void {
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  
  // First, get the actual NFT owner
  const ownerResult = mgr.try_ownerOf(tokenId)
  if (ownerResult.reverted) {
    return
  }
  
  const nftOwner = ownerResult.value

  // AGENT FILTERING: Only process positions owned by a service
  if (!isServiceAgent(nftOwner)) {
    return
  }

  const dataResult = mgr.try_positions(tokenId)
  
  if (dataResult.reverted) {
    return
  }
  
  const data = dataResult.value
  
  // Load existing position using consistent ID pattern
  const positionId = getVeloCLPositionId(nftOwner, tokenId)
  let pp = ProtocolPosition.load(positionId)
  
  if (pp == null) {
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
    const poolAddress = getPoolAddress(data.value2, data.value3, data.value4 as i32, tokenId)
    removeAgentNFTFromPool("velodrome-cl", poolAddress, tokenId)
    
    pp.save()
    refreshPortfolio(nftOwner, block)
  } else {
    // Partial withdrawal - just update current amounts normally
    refreshVeloCLPosition(tokenId, block, txHash)
  }
}

// 2c. Re-price NFT into USD + persist (for non-entry events)
export function refreshVeloCLPosition(tokenId: BigInt, block: ethereum.Block, txHash: Bytes = Bytes.empty()): void {
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  
  // First, get the actual NFT owner
  const ownerResult = mgr.try_ownerOf(tokenId)
  if (ownerResult.reverted) {
    return
  }
  
  const nftOwner = ownerResult.value

  // AGENT FILTERING: Only process positions owned by a service
  if (!isServiceAgent(nftOwner)) {
    return
  }

  // Early check - don't process closed positions using consistent ID pattern
  const positionId = getVeloCLPositionId(nftOwner, tokenId)
  let position = ProtocolPosition.load(positionId)
  
  if (position && !position.isActive) {
    return
  }
  
  const dataResult = mgr.try_positions(tokenId)
  
  if (dataResult.reverted) {
    return
  }
  
  const data = dataResult.value

  // Derive pool address from position data with caching
  const poolAddress = getPoolAddress(data.value2, data.value3, data.value4 as i32, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    return
  }
  
  // pool state
  const pool  = VelodromeCLPool.bind(poolAddress)
  const slot0Result = pool.try_slot0()
  
  if (slot0Result.reverted) {
    return
  }
  
  const slot0 = slot0Result.value

  // convert liquidity → token amounts
  const tickLower = data.value5 as i32
  const tickUpper = data.value6 as i32
  
  const sqrtPa  = TickMath.getSqrtRatioAtTick(tickLower)
  const sqrtPb  = TickMath.getSqrtRatioAtTick(tickUpper)
  
  const amounts = LiquidityAmounts.getAmountsForLiquidity(
                    slot0.value0, sqrtPa, sqrtPb, data.value7)

  // USD pricing - NEW HARDCODED VERSION
  const token0Price = getTokenPriceUSD(data.value2, block.timestamp, false) // token0
  const token1Price = getTokenPriceUSD(data.value3, block.timestamp, false) // token1

  // Convert amounts from wei to human readable using proper decimals
  const amount0Human = convertTokenAmount(amounts.amount0, data.value2) // token0
  const amount1Human = convertTokenAmount(amounts.amount1, data.value3) // token1
  
  // No conversion logging needed in production
  
  const usd0 = amount0Human.times(token0Price)
  const usd1 = amount1Human.times(token1Price)
  const usd  = usd0.plus(usd1)

  // write ProtocolPosition - use consistent ID pattern
  let pp = ProtocolPosition.load(positionId)
  const isNewPosition = pp == null
  
  if (pp == null) {
    pp = new ProtocolPosition(positionId)
    pp.agent    = nftOwner
    pp.service  = nftOwner // Link to service
    pp.protocol = "velodrome-cl"
    pp.pool     = poolAddress
    pp.tokenId  = tokenId
    pp.isActive = true
    
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
    
    // Set static position metadata (required fields)
    pp.tickLower = tickLower
    pp.tickUpper = tickUpper
    pp.tickSpacing = data.value4
    
    // CRITICAL FIX: Initialize entry data for new positions
    // Entry amounts will be set by refreshVeloCLPositionWithEventAmounts
    // But we need to capture the initial transaction data
    pp.entryTxHash = txHash
    pp.entryTimestamp = block.timestamp
    pp.entryAmount0 = BigDecimal.zero()
    pp.entryAmount0USD = BigDecimal.zero()
    pp.entryAmount1 = BigDecimal.zero()
    pp.entryAmount1USD = BigDecimal.zero()
    pp.entryAmountUSD = BigDecimal.zero()
    
    // Entry amounts will be set by event processing
  }
  
  // Update current state (for both new and existing positions)
  pp.usdCurrent = usd
  pp.token0     = data.value2
  pp.token0Symbol = getTokenSymbol(data.value2)
  pp.amount0    = amount0Human
  pp.amount0USD = usd0
  pp.token1     = data.value3
  pp.token1Symbol = getTokenSymbol(data.value3)
  pp.amount1    = amount1Human
  pp.amount1USD = usd1
  pp.liquidity  = data.value7
  
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
    removeAgentNFTFromPool("velodrome-cl", poolAddress, tokenId)
  }
  
  pp.save()

  // bubble up to AgentPortfolio
  refreshPortfolio(nftOwner, block)
}

// 3. Handle NFT transfers (add/remove from cache)
export function handleNFTTransferForCache(tokenId: BigInt, from: Address, to: Address): void {
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  const posResult = mgr.try_positions(tokenId)
  
  if (posResult.reverted) {
    return
  }
  
  const pos = posResult.value
  
  // Derive pool address from position data with caching
  const poolAddress = getPoolAddress(pos.value2, pos.value3, pos.value4 as i32, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    return
  }
  
  // Remove from cache if transferring out
  if (!from.equals(Address.zero())) {
    removeAgentNFTFromPool("velodrome-cl", poolAddress, tokenId)
  }
  
  // Add to cache if transferring in
  if (!to.equals(Address.zero())) {
    addAgentNFTToPool("velodrome-cl", poolAddress, tokenId)
  }
}
