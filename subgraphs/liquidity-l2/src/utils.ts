import { BigInt, Address, Bytes } from '@graphprotocol/graph-ts';
import { PoolMetrics, DailyFees } from '../generated/schema';

export const ZERO_ADDRESS = Address.fromString(
  '0x0000000000000000000000000000000000000000'
);

// Balancer V2 Vault — same address on all EVM chains
export const BALANCER_VAULT = Address.fromString(
  '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
);

// Chainlink CELO/USD price feed on Celo mainnet
export const CHAINLINK_CELO_USD = Address.fromString(
  '0x0568fD19986748cEfF3301e55c0eb1E729E0Ab7e'
);

export const CELO_PRICE_ID = 'celo-usd';

// Chainlink price refresh interval (1 hour)
export const PRICE_STALENESS_THRESHOLD = BigInt.fromI32(3600);

// Fee calculation constants
export const DAY_SECONDS = BigInt.fromI32(86400);
export const WEI = BigInt.fromString('1000000000000000000'); // 1e18
export const SWAP_FEE_NUMERATOR = BigInt.fromI32(3);
export const SWAP_FEE_DENOMINATOR = BigInt.fromI32(1000);

export function isZeroAddress(address: Address): boolean {
  return address.equals(ZERO_ADDRESS);
}

export function getOrCreatePoolMetrics(poolAddress: Address): PoolMetrics {
  let metrics = PoolMetrics.load(poolAddress);
  if (metrics == null) {
    metrics = new PoolMetrics(poolAddress);
    metrics.poolId = Bytes.empty();
    metrics.token0 = Bytes.empty();
    metrics.token1 = Bytes.empty();
    metrics.reserve0 = BigInt.zero();
    metrics.reserve1 = BigInt.zero();
    metrics.totalSupply = BigInt.zero();
    metrics.totalMinted = BigInt.zero();
    metrics.totalBurned = BigInt.zero();
    metrics.cumulativeFeesToken0 = BigInt.zero();
    metrics.cumulativeFeesToken1 = BigInt.zero();
    metrics.swapFeePercentage = BigInt.zero();
    metrics.celoUsdPrice = BigInt.zero();
    metrics.lastUpdatedBlock = BigInt.zero();
    metrics.lastUpdatedTimestamp = BigInt.zero();
    metrics.lastUpdatedTransaction = Bytes.empty();
  }
  return metrics;
}

export function getOrCreateDailyFees(timestamp: BigInt): DailyFees {
  let dayTimestamp = timestamp.div(DAY_SECONDS).times(DAY_SECONDS);
  let id = dayTimestamp.toString();
  let daily = DailyFees.load(id);
  if (daily == null) {
    daily = new DailyFees(id);
    daily.dayTimestamp = dayTimestamp;
    daily.totalFeesToken0 = BigInt.zero();
    daily.totalFeesToken1 = BigInt.zero();
    daily.swapCount = 0;
  }
  return daily;
}
