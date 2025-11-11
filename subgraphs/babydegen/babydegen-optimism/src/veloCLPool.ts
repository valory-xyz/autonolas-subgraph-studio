import { Swap } from "../generated/templates/VeloCLPool/VelodromeCLPool"
import { getAgentNFTsInPool } from "./poolIndexCache"        // tiny util map
import { refreshVeloCLPosition } from "./veloCLShared"
import { log } from "@graphprotocol/graph-ts"

export function handleSwap(ev: Swap): void {
  const ids = getAgentNFTsInPool("velodrome-cl", ev.address)                // BigInt[]
  
  for (let i = 0; i < ids.length; i++) {
    const tokenId = ids[i]
    
    // refreshVeloCLPosition will handle:
    // 1. Getting the NFT owner
    // 2. Checking if the owner is a service
    // 3. Checking if the position is still active
    // 4. Updating the position if needed
    refreshVeloCLPosition(tokenId, ev.block, ev.transaction.hash)
  }
}
