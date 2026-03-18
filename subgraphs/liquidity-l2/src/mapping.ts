import { Transfer } from '../generated/BalancerPool/BalancerV2WeightedPool';
import { BalancerV2WeightedPool } from '../generated/BalancerPool/BalancerV2WeightedPool';
import { BalancerV2Vault } from '../generated/BalancerPool/BalancerV2Vault';
import { Sync, UniswapV2Pair } from '../generated/BalancerPool/UniswapV2Pair';

import { BPTTransfer } from '../generated/schema';

import {
  isZeroAddress,
  getOrCreatePoolMetrics,
  BALANCER_VAULT,
} from './utils';

/**
 * Handle BPT / LP Token Transfer events.
 * Tracks total supply via mint/burn detection, and fetches current
 * pool reserves from the Balancer Vault on mint/burn only.
 * On Celo (Ubeswap/UniswapV2), the Vault calls fail silently via try_;
 * reserves are provided by handleUniswapSync instead.
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

  // Fetch pool reserves from Balancer Vault on mint/burn only.
  // On Celo (Ubeswap), these calls fail silently — reserves come from handleUniswapSync.
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

/**
 * Handle UniswapV2 Sync events (Celo/Ubeswap only).
 * Updates pool reserves directly from the event params.
 * Also populates token0/token1 addresses via contract calls on first invocation.
 */
export function handleUniswapSync(event: Sync): void {
  let poolAddress = event.address;
  let metrics = getOrCreatePoolMetrics(poolAddress);

  metrics.reserve0 = event.params.reserve0;
  metrics.reserve1 = event.params.reserve1;

  // Populate token addresses on first Sync (one-time contract call)
  if (metrics.token0.length == 0) {
    let pair = UniswapV2Pair.bind(poolAddress);
    let token0Result = pair.try_token0();
    let token1Result = pair.try_token1();
    if (!token0Result.reverted) {
      metrics.token0 = token0Result.value;
    }
    if (!token1Result.reverted) {
      metrics.token1 = token1Result.value;
    }
  }

  metrics.lastUpdatedBlock = event.block.number;
  metrics.lastUpdatedTimestamp = event.block.timestamp;
  metrics.lastUpdatedTransaction = event.transaction.hash;
  metrics.save();
}
