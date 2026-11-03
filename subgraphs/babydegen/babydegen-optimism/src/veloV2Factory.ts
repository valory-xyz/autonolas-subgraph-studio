import { PoolCreated } from "../generated/VeloV2Factory/PoolFactory"
import { PoolCreated as AeroV2PoolCreated } from "../generated/AeroV2StableFactory/AeroV2PoolFactory"
import { AeroV2Pool as AeroV2PoolTemplate } from "../generated/templates"
import { V2PoolVenue } from "../generated/schema"
import { ensureVeloV2PoolTemplate } from "./veloV2Shared"
import { isPoolRelevant } from "./veloV2Bootstrap"
import { PROTOCOL_AERO_V2, AERO_V2_STABLE_FACTORY } from "./constants"
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

// Handle PoolCreated from both Aero v2 factories (stable and volatile share one ABI).
// Same whitelist filter as the legacy factory; the venue row is what labels the pool's
// positions aero-v2 and sends their gauge lookup to the GaugeManager map.
export function handleAeroV2PoolCreated(event: AeroV2PoolCreated): void {
  if (!isPoolRelevant(event.params.token0, event.params.token1)) {
    return
  }
  const venue = new V2PoolVenue(event.params.pool)
  venue.protocol = PROTOCOL_AERO_V2
  venue.stable = event.address.equals(AERO_V2_STABLE_FACTORY)
  venue.save()
  AeroV2PoolTemplate.create(event.params.pool)
}
