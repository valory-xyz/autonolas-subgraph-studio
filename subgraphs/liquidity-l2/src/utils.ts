import { BigInt, Address, Bytes } from '@graphprotocol/graph-ts';
import { PoolMetrics } from '../generated/schema';

export const ZERO_ADDRESS = Address.fromString(
  '0x0000000000000000000000000000000000000000'
);

// Balancer V2 Vault — same address on all EVM chains
export const BALANCER_VAULT = Address.fromString(
  '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
);

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
    metrics.lastUpdatedBlock = BigInt.zero();
    metrics.lastUpdatedTimestamp = BigInt.zero();
    metrics.lastUpdatedTransaction = Bytes.empty();
  }
  return metrics;
}
