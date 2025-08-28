import { 
  Address, 
  BigInt, 
  BigDecimal, 
  Bytes, 
  ethereum,
  log
} from "@graphprotocol/graph-ts"

import { 
  ProtocolPosition,
  Service
} from "../../../../generated/schema"

import { 
  calculatePortfolioMetrics,
  updateFirstTradingTimestamp
} from "./helpers"

import { getServiceByAgent } from "./config"
import { getTokenPriceUSD } from "./priceDiscovery"
import { getTokenDecimals, getTokenSymbol } from "./tokenUtils"
import { BALANCER_VAULT } from "./constants"

// Import the generated event types
import { PoolBalanceChanged } from "../../../../generated/BalancerVault/BalancerV2Vault"
import { BalancerV2WeightedPool } from "../../../../generated/BalancerVault/BalancerV2WeightedPool"
import { ERC20 } from "../../../../generated/BalancerVault/ERC20"

// Import shared functions
import { 
  refreshBalancerPosition,
  refreshBalancerPositionWithEventAmounts,
  extractPoolAddress,
  detectTransactionType
} from "./balancerShared"

// Handle Balancer Vault PoolBalanceChanged events
export function handlePoolBalanceChanged(event: PoolBalanceChanged): void {
  const poolId = event.params.poolId
  const liquidityProvider = event.params.liquidityProvider
  const tokens = event.params.tokens
  const deltas = event.params.deltas
  const protocolFeeAmounts = event.params.protocolFeeAmounts
  
  log.info("BALANCER POOL BALANCE CHANGED: poolId={}, liquidityProvider={}, tokens={}, deltas={}", [
    poolId.toHexString(),
    liquidityProvider.toHexString(),
    tokens.length.toString(),
    deltas.length.toString()
  ])
  
  // Extract pool address from poolId (first 20 bytes)
  const poolAddress = extractPoolAddress(poolId)
  
  // Check if the liquidity provider is a tracked service
  const service = getServiceByAgent(liquidityProvider)
  
  if (service != null) {
    log.info("BALANCER: Tracked service {} interacting with pool {}", [
      liquidityProvider.toHexString(),
      poolAddress.toHexString()
    ])
    
    // Detect transaction type based on deltas
    const transactionType = detectTransactionType(deltas)
    
    log.info("BALANCER: Transaction type detected: {}", [transactionType])
    
    if (transactionType == "entry" || transactionType == "rebalance") {
      // Handle position entry or rebalancing
      refreshBalancerPositionWithEventAmounts(
        liquidityProvider,
        poolAddress,
        poolId,
        tokens,
        deltas,
        event.block,
        event.transaction.hash
      )
    } else if (transactionType == "exit") {
      // Handle position exit
      refreshBalancerPositionWithEventAmounts(
        liquidityProvider,
        poolAddress,
        poolId,
        tokens,
        deltas,
        event.block,
        event.transaction.hash
      )
    } else {
      // Mixed transaction - still update position
      refreshBalancerPosition(
        liquidityProvider,
        poolAddress,
        poolId,
        event.block,
        event.transaction.hash
      )
    }
  } else {
    log.info("BALANCER: Liquidity provider {} is not a tracked service", [
      liquidityProvider.toHexString()
    ])
  }
}
