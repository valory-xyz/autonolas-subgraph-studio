import { BigInt, BigDecimal, Address, Bytes, log, dataSource } from '@graphprotocol/graph-ts';
import { getOlasTokenAddress } from '../../../shared/constants';
import {
  TreasuryHoldings,
  LPTokenMetrics,
  PoolReserves,
} from '../generated/schema';
import { AggregatorV3Interface } from '../generated/OLASETHPair/AggregatorV3Interface';

// Chainlink price feeds (8 decimals)
export const CHAINLINK_PRICE_FEED_ADDRESS_MAINNET_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
export const CHAINLINK_PRICE_FEED_ADDRESS_CELO_CELO_USD = '0x022F9dCC73C5Fb43F2b4eF2EF9ad3eDD1D853946';
export const CHAINLINK_DECIMALS = 8;
export const ETH_DECIMALS = 18;
export const PRICE_DECIMALS = CHAINLINK_DECIMALS + ETH_DECIMALS; // 26

export const ZERO_ADDRESS = Address.fromString(
  '0x0000000000000000000000000000000000000000'
);

// Protocol-Owned Liquidity (POL) addresses per chain
// Source: Dune queries (https://dune.com/queries/5383248)
//
// Chains with on-chain POL holders (trackable by this subgraph):
// - Ethereum: Treasury contract holds LP tokens
// - Gnosis: Fee Collector holds BPT tokens on Gnosis
// - Celo: Protocol holder holds LP tokens on Celo
//
// Chains with bridged POL (NOT trackable - POL held on Ethereum mainnet):
// - Polygon: Bridged LP on ETH 0xf9825A563222f9eFC81e369311DAdb13D68e60a4
// - Arbitrum: Bridged LP on ETH 0x36B203Cb3086269f005a4b987772452243c0767f
// - Optimism: Bridged LP on ETH 0x2FD007a534eB7527b535a1DF35aba6bD2a8b660F
// - Base: Bridged LP on ETH 0x9946d6FD1210D85EC613Ca956F142D911C97a074
export const POL_ADDRESS_ETHEREUM = '0xa0DA53447C0f6C4987964d8463da7e6628B30f82';
export const POL_ADDRESS_GNOSIS = '0xce88686553686DA562CE7Cea497CE749DA109f9F';
export const POL_ADDRESS_CELO = '0x796Dff6D74F3E27060B71255Fe517BFb23C93eed';

export const SECONDS_PER_DAY = BigInt.fromI32(86400);
export const BASIS_POINTS = BigInt.fromI32(10000); // 100% = 10000 basis points
export const GLOBAL_ID = '';

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
 * Get the POL (Protocol-Owned Liquidity) address for the current network.
 * Returns zero address if no POL address is configured for the network.
 *
 * Note: Polygon/Arbitrum/Optimism/Base POL is held as bridged LP on Ethereum,
 * so those L2 subgraphs cannot track POL directly (returns zero address).
 */
export function getPolAddress(): Address {
  const network = dataSource.network();
  if (network == 'mainnet') {
    return Address.fromString(POL_ADDRESS_ETHEREUM);
  }
  if (network == 'gnosis' || network == 'xdai') {
    return Address.fromString(POL_ADDRESS_GNOSIS);
  }
  if (network == 'celo') {
    return Address.fromString(POL_ADDRESS_CELO);
  }
  // Polygon/Arbitrum/Optimism/Base - POL is bridged to Ethereum, not trackable here
  return ZERO_ADDRESS;
}

/**
 * Check if an address is the POL (Protocol-Owned Liquidity) address.
 *
 * - Ethereum: Treasury contract (0xa0DA53447C0f6C4987964d8463da7e6628B30f82)
 * - Gnosis: Fee Collector (0xce88686553686DA562CE7Cea497CE749DA109f9F)
 * - Celo: Protocol Holder (0x796Dff6D74F3E27060B71255Fe517BFb23C93eed)
 * - Polygon/Arbitrum/Optimism/Base: POL bridged to Ethereum (returns false)
 */
export function isTreasuryAddress(address: Address): boolean {
  const polAddress = getPolAddress();
  if (polAddress.equals(ZERO_ADDRESS)) {
    return false;
  }
  return address.equals(polAddress);
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
    metrics.poolLiquidityUsd = BigDecimal.zero();
    metrics.protocolOwnedLiquidityUsd = BigDecimal.zero();
    metrics.lastEthPriceUsd = BigDecimal.zero();
    metrics.lastUpdated = BigInt.zero();
    metrics.firstTransferTimestamp = BigInt.zero();
  }

  if (metrics.poolLiquidityUsd === null) {
    metrics.poolLiquidityUsd = BigDecimal.zero();
  }
  if (metrics.protocolOwnedLiquidityUsd === null) {
    metrics.protocolOwnedLiquidityUsd = BigDecimal.zero();
  }
  if (metrics.lastEthPriceUsd === null) {
    metrics.lastEthPriceUsd = BigDecimal.zero();
  }
  return metrics;
}

/**
 * Get or create treasury holdings tracker.
 * Uses the POL address for the current network.
 */
export function getOrCreateTreasuryHoldings(): TreasuryHoldings {
  const polAddress = getPolAddress();
  let treasury = TreasuryHoldings.load(polAddress);
  if (treasury == null) {
    treasury = new TreasuryHoldings(polAddress);
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
 * Fetch native token/USD price from Chainlink feed.
 *
 * Mainnet: ETH/USD feed for OLAS-ETH pool.
 * Celo: CELO/USD feed for OLAS-CELO pool (Ubeswap uses native CELO, not ETH).
 *
 * Returns price in 8 decimals (e.g., 180000000000 = $1800.00).
 * Returns zero on Chainlink call failure (safe default: USD values remain zero).
 */
export function getNativeTokenPriceUsd(txHash: Bytes): BigInt {
  const network = dataSource.network();
  let priceFeedAddr = CHAINLINK_PRICE_FEED_ADDRESS_MAINNET_ETH_USD;

  if (network == 'celo') {
    priceFeedAddr = CHAINLINK_PRICE_FEED_ADDRESS_CELO_CELO_USD;
  }

  const priceFeedAddress = Address.fromString(priceFeedAddr);
  const priceFeed = AggregatorV3Interface.bind(priceFeedAddress);

  const result = priceFeed.try_latestRoundData();
  if (result.reverted) {
    log.error('Chainlink price fetch failed for tx {} on network {}', [txHash.toHexString(), network]);
    return BigInt.zero();
  }

  return result.value.value1;
}

/**
 * Calculate total pool liquidity in USD.
 *
 * Formula: 2 × reserve1 × ethPrice / 10^26
 *
 * Uniswap V2 constant product AMM: both sides have equal USD value at equilibrium.
 * Total pool value = 2 × one side's USD value.
 *
 * Decimal normalization (10^26):
 *   - Chainlink price has 8 decimals (e.g., 180000000000 = $1800.00)
 *   - reserve1 is in wei (18 decimals)
 *   - Divide by 10^(8+18) = 10^26 to get USD dollars
 */
export function calculatePoolLiquidityUsd(reserve1: BigInt, ethPrice: BigInt): BigDecimal {
  if (ethPrice.equals(BigInt.zero())) {
    return BigDecimal.zero();
  }

  const two = BigInt.fromI32(2);
  const numerator = two.times(reserve1).times(ethPrice);
  const denominator = BigInt.fromI32(10).pow(PRICE_DECIMALS as u8);

  return numerator.toBigDecimal().div(denominator.toBigDecimal());
}

/**
 * Calculate protocol-owned liquidity in USD.
 *
 * Formula: (treasurySupply / totalSupply) × poolLiquidityUsd
 *
 * Returns treasury's proportional share of pool liquidity.
 * Returns zero when totalSupply is zero (occurs before first mint during pool initialization).
 */
export function calculateProtocolOwnedLiquidityUsd(
  poolLiquidityUsd: BigDecimal,
  treasurySupply: BigInt,
  totalSupply: BigInt
): BigDecimal {
  if (totalSupply.equals(BigInt.zero())) {
    return BigDecimal.zero();
  }

  const treasuryFraction = treasurySupply.toBigDecimal().div(totalSupply.toBigDecimal());
  return poolLiquidityUsd.times(treasuryFraction);
}

/**
 * Calculate all USD metrics for a sync event.
 *
 * Fetches ETH price from Chainlink and computes pool liquidity USD,
 * protocol-owned liquidity USD, and human-readable ETH price.
 */
export function calculateUsdMetrics(
  reserve1: BigInt,
  txHash: Bytes,
  treasurySupply: BigInt,
  totalSupply: BigInt
): UsdMetrics {
  const ethPrice = getNativeTokenPriceUsd(txHash);
  const poolLiquidityUsd = calculatePoolLiquidityUsd(reserve1, ethPrice);
  const protocolOwnedLiquidityUsd = calculateProtocolOwnedLiquidityUsd(
    poolLiquidityUsd, treasurySupply, totalSupply
  );
  const lastEthPriceUsd = ethPrice.toBigDecimal().div(
    BigInt.fromI32(10).pow(CHAINLINK_DECIMALS as u8).toBigDecimal()
  );

  return { poolLiquidityUsd, protocolOwnedLiquidityUsd, lastEthPriceUsd };
}

/** Return type for calculateUsdMetrics */
export class UsdMetrics {
  poolLiquidityUsd: BigDecimal;
  protocolOwnedLiquidityUsd: BigDecimal;
  lastEthPriceUsd: BigDecimal;
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
  timestamp: BigInt,
  poolLiquidityUsd: BigDecimal,
  protocolOwnedLiquidityUsd: BigDecimal,
  lastEthPriceUsd: BigDecimal
): void {
  let metrics = getOrCreateLPTokenMetrics();

  metrics.currentReserve0 = reserve0;
  metrics.currentReserve1 = reserve1;
  metrics.poolLiquidityUsd = poolLiquidityUsd;
  metrics.protocolOwnedLiquidityUsd = protocolOwnedLiquidityUsd;
  metrics.lastEthPriceUsd = lastEthPriceUsd;
  metrics.lastUpdated = timestamp;

  metrics.save();
}

/**
 * Pool balance extraction result.
 * Valid flag prevents zeroing metrics on temporary failures.
 */
export class PoolBalances {
  olasBalance: BigInt;
  stablecoinBalance: BigInt;
  stablecoinDecimals: i32;
  valid: boolean;
}

/**
 * Extract OLAS and stablecoin balances from Balancer pool tokens.
 *
 * Validates exactly 2 tokens: pool structure assumption from Balancer weighted pool design.
 * Returns invalid result (valid=false) on validation failure to preserve last known value.
 */
export function extractPoolBalances(
  tokens: Address[],
  balances: BigInt[]
): PoolBalances {
  if (tokens.length != 2) {
    log.error('Pool has {} tokens, expected 2', [tokens.length.toString()]);
    return { olasBalance: BigInt.zero(), stablecoinBalance: BigInt.zero(), stablecoinDecimals: 18, valid: false };
  }

  const network = dataSource.network();
  // WXDAI=18 decimals (Gnosis), USDC=6 decimals (Polygon, Arbitrum, Optimism, Base)
  let stablecoinDecimals = 18;
  if (network == 'matic' || network == 'arbitrum-one' || network == 'optimism' || network == 'base') {
    stablecoinDecimals = 6;
  }

  const olasAddr = getOlasTokenAddress().toHexString().toLowerCase();
  let olasBalance = BigInt.zero();
  let stablecoinBalance = BigInt.zero();
  let olasFound = false;

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].toHexString().toLowerCase() == olasAddr) {
      olasBalance = balances[i];
      olasFound = true;
    } else {
      stablecoinBalance = balances[i];
    }
  }

  if (!olasFound) {
    log.error('OLAS token not found in pool tokens', []);
    return { olasBalance: BigInt.zero(), stablecoinBalance: BigInt.zero(), stablecoinDecimals: 18, valid: false };
  }

  return { olasBalance, stablecoinBalance, stablecoinDecimals, valid: true };
}

/**
 * Calculate OLAS price from Balancer pool spot price.
 *
 * Formula: stablecoinBalance / olasBalance (normalized for decimals).
 * Assumes stablecoin = $1 USD (WXDAI, USDC).
 *
 * Why pool spot price: eliminates Chainlink dependency on L2s where ETH pools don't exist.
 * Trade-off: less accurate during low liquidity periods vs external price oracles.
 */
export function calculateBalancerPoolPrice(
  olasBalance: BigInt,
  stablecoinBalance: BigInt,
  stablecoinDecimals: i32
): BigDecimal {
  if (olasBalance.isZero()) {
    return BigDecimal.zero();
  }

  // Normalize: OLAS=18 decimals, WXDAI=18, USDC=6
  const olasBD = olasBalance.toBigDecimal().div(BigDecimal.fromString('1000000000000000000'));
  const stableBD = stablecoinBalance.toBigDecimal().div(
    BigInt.fromI32(10).pow(stablecoinDecimals as u8).toBigDecimal()
  );

  return stableBD.div(olasBD);
}
