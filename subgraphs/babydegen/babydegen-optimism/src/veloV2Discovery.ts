import { 
  Transfer as TransferEvent
} from "../generated/USDC_Native/ERC20"
import { 
  VelodromeV2Pool 
} from "../generated/templates/VeloV2Pool/VelodromeV2Pool"
import { 
  VeloV2Pool as VeloV2PoolTemplate 
} from "../generated/templates"
import { 
  Address, 
  log 
} from "@graphprotocol/graph-ts"
import { isSafe } from "./common"

// VelodromeV2 Factory address
const VELO_V2_FACTORY = Address.fromString("0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a")

// Cache for already discovered pools
let discoveredPools = new Map<string, boolean>()

// Check if an address is a VelodromeV2 pool
export function isVelodromeV2Pool(address: Address): boolean {
  log.warning("VELO V2 DISCOVERY: Checking if {} is a VelodromeV2 pool", [address.toHexString()])
  
  // Try to bind to the address as a VelodromeV2Pool
  let poolContract = VelodromeV2Pool.bind(address)
  
  // Try to call VelodromeV2-specific methods
  let token0Call = poolContract.try_token0()
  let token1Call = poolContract.try_token1()
  let stableCall = poolContract.try_stable()
  let reservesCall = poolContract.try_getReserves()
  
  // Check if all VelodromeV2-specific calls succeed
  // These methods exist on VelodromeV2 pools but not on regular ERC20 tokens
  if (!token0Call.reverted && 
      !token1Call.reverted && 
      !stableCall.reverted &&
      !reservesCall.reverted) {
    
    log.warning("VELO V2 DISCOVERY: ✅ {} is a VelodromeV2 pool! token0: {}, token1: {}, stable: {}", [
      address.toHexString(),
      token0Call.value.toHexString(),
      token1Call.value.toHexString(),
      stableCall.value ? "true" : "false"
    ])
    return true
  } else {
    log.warning("VELO V2 DISCOVERY: ❌ {} failed method calls - not a VelodromeV2 pool", [
      address.toHexString()
    ])
  }
  
  return false
}

// Ensure a VelodromeV2 pool template is created
export function ensureVeloV2PoolDiscovery(poolAddress: Address): void {
  const poolKey = poolAddress.toHexString()
  
  // Check cache first
  if (discoveredPools.has(poolKey)) {
    log.warning("VELO V2 DISCOVERY: Pool {} already discovered, skipping", [poolKey])
    return
  }
  
  // Verify it's actually a VelodromeV2 pool
  if (isVelodromeV2Pool(poolAddress)) {
    log.warning("VELO V2 DISCOVERY: 🎯 Creating template for newly discovered pool: {}", [poolKey])
    
    // Create the template instance
    VeloV2PoolTemplate.create(poolAddress)
    
    // Add to cache
    discoveredPools.set(poolKey, true)
    
    log.warning("VELO V2 DISCOVERY: ✅ Template created for pool: {}", [poolKey])
  }
}

// Handle any ERC20 transfer to detect VelodromeV2 LP tokens
export function handleVeloV2Discovery(event: TransferEvent): void {
  // Only care about transfers TO the Safe
  if (!isSafe(event.params.to)) {
    return
  }
  
  log.warning("VELO V2 DISCOVERY: Transfer TO Safe detected from token: {}", [
    event.address.toHexString()
  ])
  
  // Check if the token contract is a VelodromeV2 pool
  ensureVeloV2PoolDiscovery(event.address)
}
