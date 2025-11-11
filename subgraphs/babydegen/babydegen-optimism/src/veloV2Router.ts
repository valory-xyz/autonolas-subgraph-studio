import { 
  Mint as RouterMint
} from "../generated/VeloV2Router/VelodromeV2Router"
import { 
  VelodromeV2Pool,
  Transfer
} from "../generated/templates/VeloV2Pool/VelodromeV2Pool"
import { ensureVeloV2PoolTemplate } from "./veloV2Shared"
import { log, Address } from "@graphprotocol/graph-ts"
import { isSafe } from "./common"

// Handle VelodromeV2 Router Mint events
export function handleVeloV2RouterMint(event: RouterMint): void {
  log.warning("===== VELODROME V2 ROUTER MINT EVENT START =====", [])
  log.warning("VELODROME V2 ROUTER: Block: {}, TxHash: {}", [
    event.block.number.toString(),
    event.transaction.hash.toHexString()
  ])
  log.warning("VELODROME V2 ROUTER: Mint Details - to: {}, pool: {}", [
    event.params.to.toHexString(),
    event.params.pool.toHexString()
  ])
  log.warning("VELODROME V2 ROUTER: Amounts - amount0: {}, amount1: {}, liquidity: {}", [
    event.params.amount0.toString(),
    event.params.amount1.toString(),
    event.params.liquidity.toString()
  ])
  
  // Log Safe address for comparison
  const safeAddress = Address.fromString("0xc8e264f402ae94f69bdef8b1f035f7200cd2b0c7")
  log.warning("VELODROME V2 ROUTER: Checking if recipient {} matches Safe {}", [
    event.params.to.toHexString(),
    safeAddress.toHexString()
  ])
  
  // Check if the recipient is our Safe
  if (isSafe(event.params.to)) {
    log.warning("VELODROME V2 ROUTER: ✅ MINT TO SAFE DETECTED! Creating pool template for {}", [
      event.params.pool.toHexString()
    ])
    
    // Ensure we have a template for this pool
    ensureVeloV2PoolTemplate(event.params.pool)
    
    // The Transfer event from the pool will handle position creation
    log.warning("VELODROME V2 ROUTER: Pool template creation complete. Waiting for Transfer event to create position", [])
    log.warning("VELODROME V2 ROUTER: Expected Transfer event from pool {} to Safe {}", [
      event.params.pool.toHexString(),
      event.params.to.toHexString()
    ])
  } else {
    log.warning("VELODROME V2 ROUTER: ❌ Mint to non-Safe address {}, skipping template creation", [
      event.params.to.toHexString()
    ])
  }
  
  log.warning("===== VELODROME V2 ROUTER MINT EVENT END =====", [])
}
