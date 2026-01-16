import { Transfer } from '../generated/OLASETHLPToken/ERC20';
import { Sync } from '../generated/OLASETHPair/UniswapV2Pair';
import { PoolBalanceChanged } from '../generated/BalancerVault/BalancerV2Vault';
import { BalancerV2Vault } from '../generated/BalancerVault/BalancerV2Vault';
import { log, Bytes, BigDecimal, dataSource } from '@graphprotocol/graph-ts';

import { LPTransfer } from '../generated/schema';
import { getBalancerVaultAddress, getOlasPoolId } from '../../../shared/constants';

import {
  isZeroAddress,
  isTreasuryAddress,
  getOrCreatePoolReserves,
  updateTreasuryHoldings,
  updateGlobalMetricsAfterTransfer,
  updateGlobalMetricsAfterSync,
  calculateUsdMetrics,
  getOrCreateLPTokenMetrics,
  extractPoolBalances,
  calculateBalancerPoolPrice,
  calculateProtocolOwnedLiquidityUsd,
} from './utils';

/**
 * Handle LP Token Transfer events
 * Tracks minting, burning, and treasury movements
 */
export function handleLPTransfer(event: Transfer): void {
  let from = event.params.from;
  let to = event.params.to;
  let value = event.params.value;
  let timestamp = event.block.timestamp;

  const transferId = event.transaction.hash.concatI32(event.logIndex.toI32());
  const transfer = new LPTransfer(transferId);
  transfer.from = from;
  transfer.to = to;
  transfer.value = value;
  transfer.blockNumber = event.block.number;
  transfer.blockTimestamp = timestamp;
  transfer.transactionHash = event.transaction.hash;
  transfer.save();

  // Determine transfer type
  let isMint = isZeroAddress(from);
  let isBurn = isZeroAddress(to);

  // Handle treasury movements
  if (isTreasuryAddress(to)) {
    // Treasury acquiring LP tokens (mint to treasury OR transfer to treasury)
    updateTreasuryHoldings(value, true, timestamp);
  } else if (isTreasuryAddress(from)) {
    // Treasury selling LP tokens (burn from treasury OR transfer from treasury)
    updateTreasuryHoldings(value, false, timestamp);
  }

  updateGlobalMetricsAfterTransfer(value, isMint, isBurn, timestamp);
}

/**
 * Handle Uniswap V2 Sync events
 * Tracks pool reserves for OLAS and ETH
 */
export function handleSync(event: Sync): void {
  const reserve0 = event.params.reserve0;
  const reserve1 = event.params.reserve1;
  const timestamp = event.block.timestamp;

  // Update current pool reserves
  const reserves = getOrCreatePoolReserves(event.address);
  reserves.reserve0 = reserve0;
  reserves.reserve1 = reserve1;
  reserves.lastSyncBlock = event.block.number;
  reserves.lastSyncTimestamp = timestamp;
  reserves.lastSyncTransaction = event.transaction.hash;
  reserves.save();

  // Calculate USD metrics
  const metrics = getOrCreateLPTokenMetrics();
  const usdMetrics = calculateUsdMetrics(
    reserve1,
    event.transaction.hash,
    metrics.treasurySupply,
    metrics.totalSupply
  );

  updateGlobalMetricsAfterSync(
    reserve0, reserve1, timestamp,
    usdMetrics.poolLiquidityUsd,
    usdMetrics.protocolOwnedLiquidityUsd,
    usdMetrics.lastEthPriceUsd
  );
}

/**
 * Handle Balancer V2 PoolBalanceChanged events.
 * Tracks pool balance changes for OLAS pools on Balancer V2 chains.
 *
 * Filters by poolId because Balancer Vault emits events for 100+ pools per chain.
 * Early returns on validation failure to preserve last known USD value when RPC fails.
 */
export function handlePoolBalanceChanged(event: PoolBalanceChanged): void {
  const configuredPoolId = getOlasPoolId();
  if (configuredPoolId.equals(Bytes.empty())) {
    log.critical('Network not supported for Balancer pools: {}', [dataSource.network()]);
    return;
  }

  if (!event.params.poolId.equals(configuredPoolId)) {
    return;
  }

  const vault = BalancerV2Vault.bind(getBalancerVaultAddress());
  const poolTokensResult = vault.try_getPoolTokens(event.params.poolId);
  if (poolTokensResult.reverted) {
    log.error('Vault.getPoolTokens() failed for pool {}', [event.params.poolId.toHexString()]);
    return;
  }

  const balances = extractPoolBalances(
    poolTokensResult.value.getTokens(),
    poolTokensResult.value.getBalances()
  );
  if (!balances.valid) {
    return;
  }

  // Pool spot price assumes stablecoin = $1 USD (WXDAI, USDC)
  const olasPrice = calculateBalancerPoolPrice(
    balances.olasBalance,
    balances.stablecoinBalance,
    balances.stablecoinDecimals
  );

  const metrics = getOrCreateLPTokenMetrics();
  const poolLiquidityUsd = olasPrice
    .times(balances.olasBalance.toBigDecimal().div(BigDecimal.fromString('1000000000000000000')))
    .times(BigDecimal.fromString('2'));
  const protocolOwnedLiquidityUsd = calculateProtocolOwnedLiquidityUsd(
    poolLiquidityUsd,
    metrics.treasurySupply,
    metrics.totalSupply
  );

  updateGlobalMetricsAfterSync(
    balances.olasBalance,
    balances.stablecoinBalance,
    event.block.timestamp,
    poolLiquidityUsd,
    protocolOwnedLiquidityUsd,
    olasPrice
  );
}
