// NOTE: These imports will work once Uniswap V3 is added to subgraph.yaml and types are generated
import { 
  IncreaseLiquidity, 
  DecreaseLiquidity, 
  Collect, 
  Transfer 
} from "../../../../generated/UniV3NFTManager/NonfungiblePositionManager"
import { 
  ensureUniV3PoolTemplate, 
  refreshUniV3Position, 
  refreshUniV3PositionWithEventAmounts, 
  refreshUniV3PositionWithExitAmounts,
  handleUniV3NFTTransferForCache
} from "./uniV3Shared"
import { getServiceByAgent } from "./config"
import { ProtocolPosition } from "../../../../generated/schema"
import { log, Bytes } from "@graphprotocol/graph-ts"

export function handleUniV3IncreaseLiquidity(event: IncreaseLiquidity): void {
  ensureUniV3PoolTemplate(event.params.tokenId)
  
  // Use actual amounts from the IncreaseLiquidity event for entry data
  refreshUniV3PositionWithEventAmounts(
    event.params.tokenId, 
    event.block, 
    event.params.amount0,  // Actual USDC amount from event
    event.params.amount1,  // Actual DAI amount from event
    event.transaction.hash
  )
}

export function handleUniV3DecreaseLiquidity(event: DecreaseLiquidity): void {
  // For DecreaseLiquidity, we need to check if this is a full exit (liquidity going to 0)
  // and if so, use the event amounts as exit amounts
  refreshUniV3PositionWithExitAmounts(
    event.params.tokenId, 
    event.block, 
    event.params.amount0,  // Actual amount0 from event
    event.params.amount1,  // Actual amount1 from event
    event.params.liquidity, // Liquidity being removed
    event.transaction.hash
  )
}

export function handleUniV3Collect(event: Collect): void {
  refreshUniV3Position(event.params.tokenId, event.block, event.transaction.hash)
}

export function handleUniV3Transfer(event: Transfer): void {
  const toService = getServiceByAgent(event.params.to)
  const fromService = getServiceByAgent(event.params.from)

  if (!toService && !fromService) {
    return
  }

  if (toService) {
    ensureUniV3PoolTemplate(event.params.tokenId)
  }
  
  if (fromService) {
    // Mark position as closed when NFT is transferred out
    const positionId = event.params.from.toHex() + "-" + event.params.tokenId.toString()
    const id = Bytes.fromUTF8(positionId)
    let position = ProtocolPosition.load(id)
    
    if (position && position.isActive) {
      // SIMPLIFIED: Only mark as inactive, never set exit amounts
      // Exit amounts will always be set by DecreaseLiquidity events
      position.isActive = false
      position.exitTxHash = event.transaction.hash
      position.exitTimestamp = event.block.timestamp
      
      // Position closed by NFT transfer
      position.save()
    }
  }
  
  // Update cache
  handleUniV3NFTTransferForCache(event.params.tokenId, event.params.from, event.params.to)
  
  // Call refresh
  refreshUniV3Position(event.params.tokenId, event.block, event.transaction.hash)
}
