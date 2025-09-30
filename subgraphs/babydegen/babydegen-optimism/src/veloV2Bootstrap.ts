import { 
  Sugar
} from "../../../../generated/VeloV2Sugar/Sugar"
import {
  PoolFactory
} from "../../../../generated/VeloV2Factory/PoolFactory"
import {
  PoolCreated as PoolCreatedEvent
} from "../../../../generated/VeloV2Factory/PoolFactory"
import { 
  VeloV2Pool
} from "../../../../generated/templates"
import { 
  Address, 
  BigInt,
  ethereum,
  log 
} from "@graphprotocol/graph-ts"
import { VELO_V2_SUGAR, VELO_V2_FACTORY, WHITELISTED_TOKENS } from "./constants"

// Configuration
const SUGAR_ADDRESS = VELO_V2_SUGAR
const FACTORY_ADDRESS = VELO_V2_FACTORY

// Cache to track discovered pools
let discoveredPools = new Map<string, boolean>()

function isTokenWhitelisted(tokenAddress: Address): boolean {
  let tokenString = tokenAddress.toHexString().toLowerCase()
  for (let i = 0; i < WHITELISTED_TOKENS.length; i++) {
    if (WHITELISTED_TOKENS[i].toLowerCase() == tokenString) {
      return true
    }
  }
  return false
}

function isPoolRelevant(token0: Address, token1: Address): boolean {
  return isTokenWhitelisted(token0) && isTokenWhitelisted(token1)
}

function createPoolTemplate(poolAddress: Address, token0: Address, token1: Address, stable: boolean): void {
  let poolKey = poolAddress.toHexString()
  
  // Check cache first
  if (discoveredPools.has(poolKey)) {
    return
  }
  
  // Create template
  VeloV2Pool.create(poolAddress)
  discoveredPools.set(poolKey, true)
  
  log.info("VELO V2: Created pool template {}", [poolKey])
}

// Bootstrap handler - runs once at startup
export function handleVeloV2Bootstrap(block: ethereum.Block): void {
  log.info("VELO V2: Starting pool discovery at block {}", [block.number.toString()])
  
  let sugar = Sugar.bind(SUGAR_ADDRESS)
  let totalDiscovered = 0
  let whitelistedFound = 0
  
  // Fetch pools in batches (Sugar contract MAX_LPS = 500)
  let limit = 500
  let offset = 0
  let hasMore = true
  
  while (hasMore) {
    let poolsResult = sugar.try_all(BigInt.fromI32(limit), BigInt.fromI32(offset))
    
    if (poolsResult.reverted) {
      log.error("VELO V2: Sugar call reverted at offset {}", [offset.toString()])
      break
    }
    
    let pools = poolsResult.value
    totalDiscovered += pools.length
    
    if (pools.length == 0) {
      hasMore = false
      break
    }
    
    // Filter and create relevant pools
    for (let i = 0; i < pools.length; i++) {
      let poolData = pools[i]
      
      // IMPORTANT: Pool type mapping for VelodromeV2 (confirmed manually)
      // type 0 = stable pools
      // type -1 = volatile pools  
      // type 1 = concentrated liquidity pools (skip these)
      // Only track stable (0) and volatile (-1) pools
      if ([0,-1].includes(poolData.type) && isPoolRelevant(poolData.token0, poolData.token1)) {
        // Note: isStable is true when type is -1 (this is correct per manual verification)
        let isStable = poolData.type == -1
        createPoolTemplate(poolData.id, poolData.token0, poolData.token1, isStable)
        whitelistedFound++
      }
    }
    
    // Check if we got fewer pools than requested (end of list)
    if (pools.length < limit) {
      hasMore = false
    } else {
      offset += limit
    }
  }
  
  log.info("VELO V2: Discovery complete - {} whitelisted pools from {} total", [
    whitelistedFound.toString(),
    totalDiscovered.toString()
  ])
}

// Factory event handler for new pools
export function handleVeloV2PoolCreated(event: PoolCreatedEvent): void {
  // Only create template if both tokens are whitelisted and not already discovered
  if (isPoolRelevant(event.params.token0, event.params.token1)) {
    let poolKey = event.params.pool.toHexString()
    
    if (!discoveredPools.has(poolKey)) {
      createPoolTemplate(event.params.pool, event.params.token0, event.params.token1, event.params.stable)
      log.info("VELO V2: New pool template created {}", [event.params.pool.toHexString()])
    }
  }
}
