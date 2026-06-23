import { PoolCreated } from "../generated/VeloV2Factory/PoolFactory"
import { ensureVeloV2PoolTemplate } from "./veloV2Shared"
import { log } from "@graphprotocol/graph-ts"

// Handle VelodromeV2 Factory PoolCreated events
export function handleVeloV2PoolCreated(event: PoolCreated): void {
  log.warning("VELODROME V2 FACTORY: Pool created event triggered!", [])
  log.warning("VELODROME V2 FACTORY: New pool created - token0: {}, token1: {}, stable: {}, pool: {}, txHash: {}, block: {}", [
    event.params.token0.toHexString(),
    event.params.token1.toHexString(),
    event.params.stable.toString(),
    event.params.pool.toHexString(),
    event.transaction.hash.toHexString(),
    event.block.number.toString()
  ])
  
  // Create a template to track this new pool's events
  ensureVeloV2PoolTemplate(event.params.pool)
  
  log.warning("VELODROME V2 FACTORY: Pool template created for {}", [event.params.pool.toHexString()])
}
