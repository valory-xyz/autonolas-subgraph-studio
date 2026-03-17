import { Transfer } from '../generated/BalancerPool/BalancerV2WeightedPool';
import { BalancerV2WeightedPool } from '../generated/BalancerPool/BalancerV2WeightedPool';
import { BalancerV2Vault } from '../generated/BalancerPool/BalancerV2Vault';

import { BPTTransfer } from '../generated/schema';

import {
  isZeroAddress,
  getOrCreatePoolMetrics,
  BALANCER_VAULT,
} from './utils';

/**
 * Handle BPT (Balancer Pool Token) Transfer events.
 * Tracks total supply via mint/burn detection, and fetches current
 * pool reserves from the Balancer Vault on mint/burn only (not on
 * regular transfers, where reserves don't change).
 */
export function handleBPTTransfer(event: Transfer): void {
  let from = event.params.from;
  let to = event.params.to;
  let value = event.params.value;
  let poolAddress = event.address;
  let timestamp = event.block.timestamp;

  // Record immutable transfer entity
  let transferId = event.transaction.hash.concatI32(event.logIndex.toI32());
  let transfer = new BPTTransfer(transferId);
  transfer.from = from;
  transfer.to = to;
  transfer.value = value;
  transfer.blockNumber = event.block.number;
  transfer.blockTimestamp = timestamp;
  transfer.transactionHash = event.transaction.hash;
  transfer.save();

  // Track BPT supply
  let isMint = isZeroAddress(from);
  let isBurn = isZeroAddress(to);

  let metrics = getOrCreatePoolMetrics(poolAddress);

  if (isMint) {
    metrics.totalSupply = metrics.totalSupply.plus(value);
    metrics.totalMinted = metrics.totalMinted.plus(value);
  } else if (isBurn) {
    // Clamp to zero to guard against underflow from partial-history indexing
    if (value.gt(metrics.totalSupply)) {
      metrics.totalSupply = metrics.totalSupply.minus(metrics.totalSupply);
    } else {
      metrics.totalSupply = metrics.totalSupply.minus(value);
    }
    metrics.totalBurned = metrics.totalBurned.plus(value);
  }

  // Fetch pool reserves only on mint/burn (join/exit events that change reserves)
  if (isMint || isBurn) {
    let pool = BalancerV2WeightedPool.bind(poolAddress);
    let poolIdResult = pool.try_getPoolId();
    if (!poolIdResult.reverted) {
      let poolId = poolIdResult.value;
      metrics.poolId = poolId;

      let vault = BalancerV2Vault.bind(BALANCER_VAULT);
      let tokensResult = vault.try_getPoolTokens(poolId);
      if (!tokensResult.reverted) {
        let tokens = tokensResult.value.getTokens();
        let balances = tokensResult.value.getBalances();

        if (tokens.length >= 2 && balances.length >= 2) {
          metrics.token0 = tokens[0];
          metrics.token1 = tokens[1];
          metrics.reserve0 = balances[0];
          metrics.reserve1 = balances[1];
        }
      }
    }
  }

  metrics.lastUpdatedBlock = event.block.number;
  metrics.lastUpdatedTimestamp = timestamp;
  metrics.lastUpdatedTransaction = event.transaction.hash;
  metrics.save();
}
