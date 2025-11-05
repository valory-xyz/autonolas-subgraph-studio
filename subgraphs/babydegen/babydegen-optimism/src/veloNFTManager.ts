import {
  IncreaseLiquidity,
  DecreaseLiquidity,
  Collect,
  Transfer,
  NonfungiblePositionManager
} from "../../../../generated/VeloNFTManager/NonfungiblePositionManager"
import { VELO_MANAGER } from "./constants"
import { getServiceByAgent } from "./config"
import { refreshVeloCLPosition, refreshVeloCLPositionWithEventAmounts, refreshVeloCLPositionWithExitAmounts, getVeloCLPositionId } from "./veloCLShared"
import { Address, Bytes, BigInt, log } from "@graphprotocol/graph-ts"
import { ProtocolPosition, NFTPositionMapping } from "../../../../generated/schema"
import { calculatePortfolioMetrics } from "./helpers"

const ZERO_ADDRESS = Address.fromString("0x0000000000000000000000000000000000000000")

// ============================================
// HANDLER 1: Track NFT Transfers
// ============================================
export function handleNFTTransfer(event: Transfer): void {
  const from = event.params.from
  const to = event.params.to
  const tokenId = event.params.tokenId
  
  // CASE 1: NFT Minted (Position Opened) - Transfer FROM zero address
  if (from.equals(ZERO_ADDRESS)) {
    // Check if recipient is a service
    const toService = getServiceByAgent(to)
    
    if (toService != null) {
      // Create mapping entity for this NFT
      const mappingId = Bytes.fromUTF8("velo-cl-" + tokenId.toString())
      let mapping = NFTPositionMapping.load(mappingId)

      if (mapping == null) {
        mapping = new NFTPositionMapping(mappingId)
        mapping.protocol = "velo-cl"
        const positionId = getVeloCLPositionId(to, tokenId)
        mapping.positionId = positionId
        mapping.save()
      }
      
      // Create position entity with zero amounts
      // (will be updated by IncreaseLiquidity event)
      let positionId = getVeloCLPositionId(to, tokenId)
      let position = ProtocolPosition.load(positionId)
      
      if (position == null) {
        // Create placeholder position - amounts will be set by IncreaseLiquidity
        refreshVeloCLPosition(tokenId, event.block, event.transaction.hash, false)
      }
    }
    return
  }

  // CASE 2: NFT Burned (Position Closed) - Transfer TO zero address
  if (to.equals(ZERO_ADDRESS)) {
    // Check if sender is a service
    const fromService = getServiceByAgent(from)
    
    if (fromService != null) {
      const positionId = getVeloCLPositionId(from, tokenId)
      let position = ProtocolPosition.load(positionId)
    
      if (position != null) {
        // Mark position as closed
      position.isActive = false
        position.exitTxHash = event.transaction.hash
        position.exitTimestamp = event.block.timestamp
      position.save()
    }
  }
  
  // Update cache
  handleNFTTransferForCache(ev.params.tokenId, ev.params.from, ev.params.to)
  
  // Call refresh - no try/catch since it's not supported
  refreshVeloCLPosition(ev.params.tokenId, ev.block, ev.transaction.hash)
}

export function handleIncreaseLiquidity(ev: IncreaseLiquidity): void {
  // Get owner early for logging
  let owner = Address.zero()
  const mgr = NonfungiblePositionManager.bind(MANAGER)
  const ownerResult = mgr.try_ownerOf(ev.params.tokenId)
  if (!ownerResult.reverted) {
    owner = ownerResult.value
  }
  
  let shouldProcess = false
  
  // PHASE 1 OPTIMIZATION: Use cache instead of ownerOf() RPC call
  const isSafeOwned = isSafeOwnedNFT("velodrome-cl", ev.params.tokenId)
  
  
  if (isSafeOwned) {
    shouldProcess = true
  } else {
    // FALLBACK: Check actual ownership for positions not in cache (existing positions)
    
    if (!ownerResult.reverted && getServiceByAgent(owner) != null) {
      shouldProcess = true
      
      // Ensure pool template exists and populate cache for future
      ensurePoolTemplate(ev.params.tokenId)
    }
  }
  
  
  if (shouldProcess) {
    // Use event amounts for accurate entry tracking
    refreshVeloCLPositionWithEventAmounts(
      ev.params.tokenId, 
      ev.block, 
      ev.params.amount0,
      ev.params.amount1,
      ev.transaction.hash
    )
    
  }
}

export function handleDecreaseLiquidity(ev: DecreaseLiquidity): void {
  let shouldProcess = false
  
  // 1. Check cache first (fast path)
  const isSafeOwned = isSafeOwnedNFT("velodrome-cl", ev.params.tokenId)
  
  if (isSafeOwned) {
    shouldProcess = true
    
  } else {
    
    // 2. Final fallback: check actual ownership on-chain
    const mgr = NonfungiblePositionManager.bind(MANAGER)
    const ownerResult = mgr.try_ownerOf(ev.params.tokenId)
    
    if (!ownerResult.reverted) {
      const owner = ownerResult.value
      const ownerService = getServiceByAgent(owner)
      
      if (ownerService != null) {
        shouldProcess = true
        
        // Check for existing active position
        const positionId = owner.toHex() + "-" + ev.params.tokenId.toString()
        const id = Bytes.fromUTF8(positionId)
        const position = ProtocolPosition.load(id)
        
        if (position && position.isActive) {
          shouldProcess = true
        }
        
        // Ensure pool template exists and populate cache for future
        ensurePoolTemplate(ev.params.tokenId)
      }
    }
  }
  
  if (shouldProcess) {
    // Use refreshVeloCLPositionWithExitAmounts to handle exit with actual event amounts
    refreshVeloCLPositionWithExitAmounts(
      ev.params.tokenId,
      ev.block,
      ev.params.amount0,  // Actual amount0 from event
      ev.params.amount1,  // Actual amount1 from event
      ev.params.liquidity, // Liquidity being removed
      ev.transaction.hash
    )
  }
}

export function handleCollect(ev: Collect): void {
  // PHASE 1 OPTIMIZATION: Use cache instead of ownerOf() RPC call
  const isSafeOwned = isSafeOwnedNFT("velodrome-cl", ev.params.tokenId)
  
  if (isSafeOwned) {
    // Process fee collection
    
    // Refresh position and trigger portfolio update
    refreshVeloCLPosition(ev.params.tokenId, ev.block, ev.transaction.hash)
    
    // Get the owner to trigger portfolio recalculation
    const mgr = NonfungiblePositionManager.bind(MANAGER)
    const ownerResult = mgr.try_ownerOf(ev.params.tokenId)
    
    if (!ownerResult.reverted) {
      const owner = ownerResult.value
      const ownerService = getServiceByAgent(owner)
      
      if (ownerService != null) {
        // Trigger portfolio recalculation
        calculatePortfolioMetrics(owner, ev.block)
      }
    }
  }
}
