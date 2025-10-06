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

// Import shared functions
import { 
  refreshBalancerPosition,
  refreshBalancerPositionWithEventAmounts,
  extractPoolAddress,
  detectTransactionType
} from "./balancerShared"

export function handlePoolBalanceChanged(event: PoolBalanceChanged): void {
  const poolId = event.params.poolId
  const liquidityProvider = event.params.liquidityProvider
  const tokens = event.params.tokens
  const deltas = event.params.deltas
  const protocolFeeAmounts = event.params.protocolFeeAmounts
  
  const poolAddress = extractPoolAddress(poolId)
  const service = getServiceByAgent(liquidityProvider)
  
  if (service != null) {
    const transactionType = detectTransactionType(deltas)
    
    if (transactionType == "entry" || transactionType == "rebalance" || transactionType == "exit") {
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
      refreshBalancerPosition(
        liquidityProvider,
        poolAddress,
        poolId,
        event.block,
        event.transaction.hash
      )
    }
  }
}
