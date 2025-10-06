// NOTE: This import will work once Uniswap V3 is added to subgraph.yaml and types are generated
import { Swap } from "../../../../generated/templates/UniV3Pool/UniswapV3Pool"
import { getAgentNFTsInPool } from "./poolIndexCache"
import { refreshUniV3Position } from "./uniV3Shared"
import { log } from "@graphprotocol/graph-ts"

export function handleUniV3Swap(ev: Swap): void {
  const ids = getAgentNFTsInPool("uniswap-v3", ev.address)
  
  for (let i = 0; i < ids.length; i++) {
    const tokenId = ids[i]
    
    // refreshUniV3Position will handle:
    // 1. Getting the NFT owner
    // 2. Checking if the owner is a service
    // 3. Checking if the position is still active
    // 4. Updating the position if needed
    refreshUniV3Position(tokenId, ev.block, ev.transaction.hash)
  }
}
