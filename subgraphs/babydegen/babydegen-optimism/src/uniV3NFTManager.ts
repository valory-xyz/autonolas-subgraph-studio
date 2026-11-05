// NOTE: These imports will work once Uniswap V3 is added to subgraph.yaml and types are generated
import { 
  IncreaseLiquidity, 
  DecreaseLiquidity, 
  Collect, 
  Transfer 
} from "../generated/UniV3NFTManager/UniswapV3PositionNFTManager"
import { 
  ensureUniV3PoolTemplate, 
  refreshUniV3Position, 
  refreshUniV3PositionWithEventAmounts, 
  refreshUniV3PositionWithExitAmounts,
  handleUniV3NFTTransferForCache,
  getUniV3PositionId
} from "./uniV3Shared"
import { getServiceByAgent } from "./config"
import { ProtocolPosition } from "../generated/schema"
import { Address } from "@graphprotocol/graph-ts"
import { calculatePortfolioMetrics } from "./helpers"
import { PROTOCOL_UNISWAP_V3 } from "./constants"
import { loadMappedPosition, mapNFTPosition, recordReleasedPrincipal, recordCollectedFees, reopenClosedWithoutExit } from "./positionIncome"

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
  if (loadMappedPosition(PROTOCOL_UNISWAP_V3, event.params.tokenId) != null) {
    recordReleasedPrincipal(PROTOCOL_UNISWAP_V3, event.params.tokenId, event.params.amount0, event.params.amount1)
  }

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
  let position = loadMappedPosition(PROTOCOL_UNISWAP_V3, event.params.tokenId)
  if (position != null) {
    recordCollectedFees(position, PROTOCOL_UNISWAP_V3, event.params.recipient, event.params.amount0, event.params.amount1, event.block.timestamp)
    // refreshUniV3Position skips a closed position, so its closing fees reach the portfolio here
    if (!position.isActive) {
      calculatePortfolioMetrics(Address.fromBytes(position.agent), event.block)
    }
  }
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
    // A Safe getting back an NFT it held before: its row is the position again (a new row maps itself on creation)
    let returnedId = getUniV3PositionId(event.params.to, event.params.tokenId)
    let returned = ProtocolPosition.load(returnedId)
    if (returned != null) {
      mapNFTPosition(PROTOCOL_UNISWAP_V3, event.params.tokenId, returnedId)
      reopenClosedWithoutExit(returned)
    }
  }
  
  if (fromService) {
    // Transferred out: closed with no exit amounts, so the new owner's DecreaseLiquidity is not this
    // position's exit (a burn follows the agent's own full-exit DecreaseLiquidity)
    let position = ProtocolPosition.load(getUniV3PositionId(event.params.from, event.params.tokenId))
    
    if (position && position.isActive) {
      position.isActive = false
      position.exitTxHash = event.transaction.hash
      position.exitTimestamp = event.block.timestamp
      
      position.save()
      // The later refresh skips an NFT no service holds, so the position's value leaves the portfolio here
      calculatePortfolioMetrics(event.params.from, event.block)
    }
  }
  
  // Update cache
  handleUniV3NFTTransferForCache(event.params.tokenId, event.params.from, event.params.to)
  
  // Call refresh
  refreshUniV3Position(event.params.tokenId, event.block, event.transaction.hash)
}
