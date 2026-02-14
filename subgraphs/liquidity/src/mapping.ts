import { Transfer } from '../generated/OLASETHLPToken/ERC20';
import { Sync } from '../generated/OLASETHPair/UniswapV2Pair';

import { LPTransfer } from '../generated/schema';

import {
  isZeroAddress,
  isTreasuryAddress,
  getOrCreatePoolReserves,
  updateTreasuryHoldings,
  updateGlobalMetricsAfterTransfer,
  updateGlobalMetricsAfterSync,
  calculateUsdMetrics,
  getOrCreateLPTokenMetrics,
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
