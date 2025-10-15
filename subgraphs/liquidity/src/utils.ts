import { BigInt, Address, Bytes } from '@graphprotocol/graph-ts';
import {
  TreasuryHoldings,
  LPTokenMetrics,
  PoolReserves,
} from '../generated/schema';

export const ZERO_ADDRESS = Address.fromString(
  '0x0000000000000000000000000000000000000000'
);
export const TREASURY_ADDRESS = Address.fromString(
  '0xa0DA53447C0f6C4987964d8463da7e6628B30f82'
);

export const SECONDS_PER_DAY = BigInt.fromI32(86400);
export const BASIS_POINTS = BigInt.fromI32(10000); // 100% = 10000 basis points
export const GLOBAL_ID = 'global';

/**
 * Get day timestamp by truncating to start of day (UTC)
 */
export function getDayTimestamp(timestamp: BigInt): BigInt {
  return timestamp.div(SECONDS_PER_DAY).times(SECONDS_PER_DAY);
}

/**
 * Check if an address is the zero address
 */
export function isZeroAddress(address: Address): boolean {
  return address.equals(ZERO_ADDRESS);
}

/**
 * Check if an address is the treasury address
 */
export function isTreasuryAddress(address: Address): boolean {
  return address.equals(TREASURY_ADDRESS);
}

/**
 * Calculate percentage in basis points (10000 = 100%)
 */
export function calculatePercentageBasisPoints(
  numerator: BigInt,
  denominator: BigInt
): BigInt {
  if (denominator.equals(BigInt.zero())) {
    return BigInt.zero();
  }
  return numerator.times(BASIS_POINTS).div(denominator);
}

/**
 * Get or create global LP token metrics
 */
export function getOrCreateLPTokenMetrics(): LPTokenMetrics {
  let metrics = LPTokenMetrics.load(GLOBAL_ID);
  if (metrics == null) {
    metrics = new LPTokenMetrics(GLOBAL_ID);
    metrics.totalSupply = BigInt.zero();
    metrics.totalMinted = BigInt.zero();
    metrics.totalBurned = BigInt.zero();
    metrics.treasurySupply = BigInt.zero();
    metrics.treasuryPercentage = BigInt.zero();
    metrics.currentReserve0 = BigInt.zero();
    metrics.currentReserve1 = BigInt.zero();
    metrics.lastUpdated = BigInt.zero();
    metrics.firstTransferTimestamp = BigInt.zero();
  }
  return metrics;
}

/**
 * Get or create treasury holdings tracker
 */
export function getOrCreateTreasuryHoldings(): TreasuryHoldings {
  let treasury = TreasuryHoldings.load(TREASURY_ADDRESS);
  if (treasury == null) {
    treasury = new TreasuryHoldings(TREASURY_ADDRESS);
    treasury.currentBalance = BigInt.zero();
    treasury.totalAcquired = BigInt.zero();
    treasury.totalSold = BigInt.zero();
    treasury.firstTransactionTimestamp = BigInt.zero();
    treasury.lastTransactionTimestamp = BigInt.zero();
    treasury.transactionCount = 0;
  }
  return treasury;
}

/**
 * Get or create pool reserves
 */
export function getOrCreatePoolReserves(poolAddress: Address): PoolReserves {
  let reserves = PoolReserves.load(poolAddress);
  if (reserves == null) {
    reserves = new PoolReserves(poolAddress);
    reserves.reserve0 = BigInt.zero();
    reserves.reserve1 = BigInt.zero();
    reserves.lastSyncBlock = BigInt.zero();
    reserves.lastSyncTimestamp = BigInt.zero();
    reserves.lastSyncTransaction = Bytes.empty();
  }
  return reserves;
}

/**
 * Update treasury holdings based on transfer
 */
export function updateTreasuryHoldings(
  amount: BigInt,
  isIncoming: boolean,
  timestamp: BigInt
): void {
  let treasury = getOrCreateTreasuryHoldings();

  if (isIncoming) {
    treasury.currentBalance = treasury.currentBalance.plus(amount);
    treasury.totalAcquired = treasury.totalAcquired.plus(amount);
  } else {
    treasury.currentBalance = treasury.currentBalance.minus(amount);
    treasury.totalSold = treasury.totalSold.plus(amount);
  }

  if (treasury.firstTransactionTimestamp.equals(BigInt.zero())) {
    treasury.firstTransactionTimestamp = timestamp;
  }
  treasury.lastTransactionTimestamp = timestamp;
  treasury.transactionCount = treasury.transactionCount + 1;

  treasury.save();
}

/**
 * Update global metrics after LP transfer
 */
export function updateGlobalMetricsAfterTransfer(
  amount: BigInt,
  isMint: boolean,
  isBurn: boolean,
  timestamp: BigInt
): void {
  let metrics = getOrCreateLPTokenMetrics();

  if (isMint) {
    metrics.totalSupply = metrics.totalSupply.plus(amount);
    metrics.totalMinted = metrics.totalMinted.plus(amount);
  } else if (isBurn) {
    metrics.totalSupply = metrics.totalSupply.minus(amount);
    metrics.totalBurned = metrics.totalBurned.plus(amount);
  }

  // Update treasury supply from current treasury holdings
  let treasury = getOrCreateTreasuryHoldings();
  metrics.treasurySupply = treasury.currentBalance;

  // Calculate treasury percentage
  metrics.treasuryPercentage = calculatePercentageBasisPoints(
    metrics.treasurySupply,
    metrics.totalSupply
  );

  if (metrics.firstTransferTimestamp.equals(BigInt.zero())) {
    metrics.firstTransferTimestamp = timestamp;
  }
  metrics.lastUpdated = timestamp;

  metrics.save();
}

/**
 * Update global metrics after reserves sync
 */
export function updateGlobalMetricsAfterSync(
  reserve0: BigInt,
  reserve1: BigInt,
  timestamp: BigInt
): void {
  let metrics = getOrCreateLPTokenMetrics();

  metrics.currentReserve0 = reserve0;
  metrics.currentReserve1 = reserve1;
  metrics.lastUpdated = timestamp;

  metrics.save();
}
