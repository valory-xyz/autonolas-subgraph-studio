import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts';
import { Transfer } from '../generated/BalancerPool/BalancerV2WeightedPool';
import { BalancerV2WeightedPool } from '../generated/BalancerPool/BalancerV2WeightedPool';
import { BalancerV2Vault } from '../generated/BalancerPool/BalancerV2Vault';
import { Swap as VaultSwap } from '../generated/BalancerPool/BalancerV2Vault';
import { Sync, UniswapV2Pair, Swap as UniswapSwap } from '../generated/BalancerPool/UniswapV2Pair';
import { AggregatorV3Interface } from '../generated/BalancerPool/AggregatorV3Interface';

import { BPTTransfer, PoolMetrics, PriceData } from '../generated/schema';

import {
  isZeroAddress,
  getOrCreatePoolMetrics,
  getOrCreateDailyFees,
  BALANCER_VAULT,
  CHAINLINK_CELO_USD,
  CELO_PRICE_ID,
  PRICE_STALENESS_THRESHOLD,
  WEI,
  SWAP_FEE_NUMERATOR,
  SWAP_FEE_DENOMINATOR,
} from './utils';

/**
 * Refresh a Chainlink price feed if the cached value is stale (> 1 hour old).
 */
function refreshChainlinkPrice(
  feedAddress: Address,
  priceId: string,
  blockNumber: BigInt,
  timestamp: BigInt
): void {
  let existing = PriceData.load(priceId);
  let shouldRefresh =
    existing == null ||
    timestamp.minus(existing.lastUpdatedTimestamp).gt(PRICE_STALENESS_THRESHOLD);

  if (shouldRefresh) {
    let chainlink = AggregatorV3Interface.bind(feedAddress);
    let result = chainlink.try_latestRoundData();
    if (!result.reverted) {
      let price = result.value.getAnswer();
      if (price.gt(BigInt.zero())) {
        let priceData = existing != null ? existing : new PriceData(priceId);
        priceData.price = price;
        priceData.lastUpdatedBlock = blockNumber;
        priceData.lastUpdatedTimestamp = timestamp;
        priceData.save();
      }
    }
  }
}

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
 * Populates token0/token1 addresses on first invocation.
 * Fetches CELO/USD price from Chainlink on Celo mainnet.
 */
export function handleUniswapSync(event: Sync): void {
  let poolAddress = event.address;
  let timestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let metrics = getOrCreatePoolMetrics(poolAddress);

  metrics.reserve0 = event.params.reserve0;
  metrics.reserve1 = event.params.reserve1;

  // Populate token addresses if not yet set (checked independently)
  if (metrics.token0.length == 0 || metrics.token1.length == 0) {
    let pair = UniswapV2Pair.bind(poolAddress);
    if (metrics.token0.length == 0) {
      let token0Result = pair.try_token0();
      if (!token0Result.reverted) {
        metrics.token0 = token0Result.value;
      }
    }
    if (metrics.token1.length == 0) {
      let token1Result = pair.try_token1();
      if (!token1Result.reverted) {
        metrics.token1 = token1Result.value;
      }
    }
  }

  // Fetch CELO/USD from Chainlink (with staleness caching)
  refreshChainlinkPrice(CHAINLINK_CELO_USD, CELO_PRICE_ID, blockNumber, timestamp);

  // Update celoUsdPrice on metrics from PriceData
  let celoPrice = PriceData.load(CELO_PRICE_ID);
  if (celoPrice != null && celoPrice.price.gt(BigInt.zero())) {
    metrics.celoUsdPrice = celoPrice.price;
  }

  metrics.lastUpdatedBlock = blockNumber;
  metrics.lastUpdatedTimestamp = timestamp;
  metrics.lastUpdatedTransaction = event.transaction.hash;
  metrics.save();
}

/**
 * Handle Balancer V2 Vault Swap events for fee tracking.
 * Processes ALL Vault swaps; filters by poolId to only track our pool.
 * Fee = amountIn * swapFeePercentage / 1e18.
 */
export function handleVaultSwap(event: VaultSwap): void {
  let poolAddress = event.address; // This is the Vault address, not the pool
  // We need to find the pool address from the poolId — first 20 bytes of poolId
  let poolId = event.params.poolId;

  // Load metrics using the pool address derived from poolId (first 20 bytes).
  // Only process if PoolMetrics already exists (created by a prior mint/burn).
  // This prevents creating orphan entities for unrelated Vault swaps.
  let poolAddrBytes = Bytes.fromUint8Array(poolId.slice(0, 20));
  let poolAddr = Address.fromBytes(poolAddrBytes);
  let metrics = PoolMetrics.load(poolAddr);

  // Skip if this pool hasn't been initialized by a mint/burn event
  if (metrics == null) {
    return;
  }

  // If poolId hasn't been set yet on an existing entity, populate it
  if (metrics.poolId.length == 0) {
    metrics.poolId = poolId;
  }

  // Verify this swap is for our pool
  if (!metrics.poolId.equals(poolId)) {
    return;
  }

  // Get swap fee percentage (cached, refresh if not set)
  if (metrics.swapFeePercentage.equals(BigInt.zero())) {
    let pool = BalancerV2WeightedPool.bind(poolAddr);
    let feeResult = pool.try_getSwapFeePercentage();
    if (!feeResult.reverted) {
      metrics.swapFeePercentage = feeResult.value;
    }
  }

  // Compute fee: amountIn * swapFeePercentage / 1e18
  let amountIn = event.params.amountIn;
  let fee = amountIn.times(metrics.swapFeePercentage).div(WEI);

  // Determine if tokenIn is token0 or token1
  let tokenIn = event.params.tokenIn;
  let feeToken0 = BigInt.zero();
  let feeToken1 = BigInt.zero();

  if (tokenIn.equals(Address.fromBytes(metrics.token0))) {
    feeToken0 = fee;
  } else {
    feeToken1 = fee;
  }

  // Update daily fees
  let daily = getOrCreateDailyFees(event.block.timestamp);
  daily.totalFeesToken0 = daily.totalFeesToken0.plus(feeToken0);
  daily.totalFeesToken1 = daily.totalFeesToken1.plus(feeToken1);
  daily.swapCount = daily.swapCount + 1;
  daily.save();

  // Update cumulative fees on pool metrics
  metrics.cumulativeFeesToken0 = metrics.cumulativeFeesToken0.plus(feeToken0);
  metrics.cumulativeFeesToken1 = metrics.cumulativeFeesToken1.plus(feeToken1);
  metrics.lastUpdatedBlock = event.block.number;
  metrics.lastUpdatedTimestamp = event.block.timestamp;
  metrics.lastUpdatedTransaction = event.transaction.hash;
  metrics.save();
}

/**
 * Handle UniswapV2 Swap events (Celo/Ubeswap only).
 * Fee = 0.3% of input amounts.
 */
export function handleUniswapSwap(event: UniswapSwap): void {
  let amount0In = event.params.amount0In;
  let amount1In = event.params.amount1In;
  let timestamp = event.block.timestamp;

  // Compute fees: 0.3% of input amounts
  let feeToken0 = amount0In.times(SWAP_FEE_NUMERATOR).div(SWAP_FEE_DENOMINATOR);
  let feeToken1 = amount1In.times(SWAP_FEE_NUMERATOR).div(SWAP_FEE_DENOMINATOR);

  // Update daily fees
  let daily = getOrCreateDailyFees(timestamp);
  daily.totalFeesToken0 = daily.totalFeesToken0.plus(feeToken0);
  daily.totalFeesToken1 = daily.totalFeesToken1.plus(feeToken1);
  daily.swapCount = daily.swapCount + 1;
  daily.save();

  // Update cumulative fees on pool metrics
  let metrics = getOrCreatePoolMetrics(event.address);
  metrics.cumulativeFeesToken0 = metrics.cumulativeFeesToken0.plus(feeToken0);
  metrics.cumulativeFeesToken1 = metrics.cumulativeFeesToken1.plus(feeToken1);
  metrics.lastUpdatedBlock = event.block.number;
  metrics.lastUpdatedTimestamp = timestamp;
  metrics.lastUpdatedTransaction = event.transaction.hash;
  metrics.save();
}
