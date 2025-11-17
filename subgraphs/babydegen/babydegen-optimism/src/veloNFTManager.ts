import {
  IncreaseLiquidity,
  DecreaseLiquidity,
  Collect,
  Transfer,
  VelodromePositionNFTManager
} from "../generated/VeloNFTManager/VelodromePositionNFTManager"
import { PROTOCOL_VELODROME_V3, VELO_MANAGER } from "./constants"
import { getServiceByAgent } from "./config"
import { refreshVeloCLPosition, refreshVeloCLPositionWithEventAmounts, refreshVeloCLPositionWithExitAmounts, getVeloCLPositionId } from "./veloCLShared"
import { Address, Bytes, BigInt, log } from "@graphprotocol/graph-ts"
import { ProtocolPosition, NFTPositionMapping } from "../generated/schema"
import { calculatePortfolioMetrics } from "./helpers"

const ZERO_ADDRESS = Address.fromString("0x0000000000000000000000000000000000000000")


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
      const mappingId = Bytes.fromUTF8(PROTOCOL_VELODROME_V3 + tokenId.toString())
      let mapping = NFTPositionMapping.load(mappingId)
      
      if (mapping == null) {
        mapping = new NFTPositionMapping(mappingId)
        mapping.protocol = PROTOCOL_VELODROME_V3
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
        refreshVeloCLPosition(positionId, tokenId, event.block, event.transaction.hash, false, to)
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
    return
  }
}

export function handleIncreaseLiquidity(event: IncreaseLiquidity): void {
  const tokenId = event.params.tokenId
  
  // Look up position using mapping
  const mappingId = Bytes.fromUTF8(PROTOCOL_VELODROME_V3 + tokenId.toString())
  const mapping = NFTPositionMapping.load(mappingId)
  
  if (mapping == null) {
    // Position not tracked (not owned by a service)
    return
  }
  
  // Update position with actual event amounts
  refreshVeloCLPositionWithEventAmounts(
    mapping.positionId,
    tokenId,
    event.block,
    event.params.amount0,
    event.params.amount1,
    event.transaction.hash
  )
}

export function handleDecreaseLiquidity(event: DecreaseLiquidity): void {
  const tokenId = event.params.tokenId
  
  // Look up position using mapping
  const mappingId = Bytes.fromUTF8(PROTOCOL_VELODROME_V3 + tokenId.toString())
  const mapping = NFTPositionMapping.load(mappingId)
  
  if (mapping == null) {
    // Position not tracked (not owned by a service)
    return
  }
  
  // Check if this is a full withdrawal by looking at remaining liquidity
  // This will be handled in refreshVeloCLPositionWithExitAmounts
  refreshVeloCLPositionWithExitAmounts(
    mapping.positionId,
    tokenId,
    event.block,
    event.params.amount0,
    event.params.amount1,
    event.params.liquidity,
    event.transaction.hash
  )
}


export function handleCollect(event: Collect): void {
  const tokenId = event.params.tokenId
  
  // Look up position using mapping
  const mappingId = Bytes.fromUTF8(PROTOCOL_VELODROME_V3 + tokenId.toString())
  const mapping = NFTPositionMapping.load(mappingId)
  
  if (mapping == null) {
    // Position not tracked (not owned by a service)
    return
  }
  
  // Load position to get owner for portfolio update
  let position = ProtocolPosition.load(mapping.positionId)
  if (position == null) {
    return
  }
  
  // Refresh position (fees collected don't change liquidity amounts)
  refreshVeloCLPosition(mapping.positionId, tokenId, event.block, event.transaction.hash, false)
  
  // Trigger portfolio recalculation
  calculatePortfolioMetrics(Address.fromBytes(position.agent), event.block)
}
