import { BigInt, Address, Bytes } from '@graphprotocol/graph-ts';
import {
  TreasuryHoldings,
  LPTokenMetrics,
  PoolReserves,
  PriceData,
  BridgedPOLHolding,
} from '../generated/schema';

// ──────────────────────────────────────────────────────────────
// Core addresses
// ──────────────────────────────────────────────────────────────

export const ZERO_ADDRESS = Address.fromString(
  '0x0000000000000000000000000000000000000000'
);
export const TREASURY_ADDRESS = Address.fromString(
  '0xa0DA53447C0f6C4987964d8463da7e6628B30f82'
);

// Chainlink price feed proxies on Ethereum mainnet
export const CHAINLINK_ETH_USD = Address.fromString(
  '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
);
export const CHAINLINK_MATIC_USD = Address.fromString(
  '0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676'
);

// ──────────────────────────────────────────────────────────────
// Bridged LP token addresses on Ethereum mainnet
// Source: https://github.com/valory-xyz/autonolas-tokenomics/blob/main/docs/lp_token_bridging.md
// ──────────────────────────────────────────────────────────────

export const BRIDGED_LP_GNOSIS = Address.fromString(
  '0x27df632fd0dcf191C418c803801D521cd579F18e'
);
export const BRIDGED_LP_POLYGON = Address.fromString(
  '0xf9825A563222f9eFC81e369311DAdb13D68e60a4'
);
export const BRIDGED_LP_SOLANA = Address.fromString(
  '0x3685B8cC36B8df09ED9E81C1690100306bF23E04'
);
export const BRIDGED_LP_ARBITRUM = Address.fromString(
  '0x36B203Cb3086269f005a4b987772452243c0767f'
);
export const BRIDGED_LP_OPTIMISM = Address.fromString(
  '0x2FD007a534eB7527b535a1DF35aba6bD2a8b660F'
);
export const BRIDGED_LP_BASE = Address.fromString(
  '0x9946d6FD1210D85EC613Ca956F142D911C97a074'
);
export const BRIDGED_LP_CELO = Address.fromString(
  '0xC085F31E4ca659fF8A17042dDB26f1dcA2fBdAB4'
);

// ──────────────────────────────────────────────────────────────
// Numeric constants
// ──────────────────────────────────────────────────────────────

export const BASIS_POINTS = BigInt.fromI32(10000); // 100% = 10000 basis points
export const WEI = BigInt.fromString('1000000000000000000'); // 1e18
export const GLOBAL_ID = 'global';
export const ETH_PRICE_ID = 'eth-usd';
export const MATIC_PRICE_ID = 'matic-usd';

// Chainlink price refresh interval: only call latestRoundData()
// if the stored price is older than this many seconds
export const PRICE_STALENESS_THRESHOLD = BigInt.fromI32(3600); // 1 hour

// ──────────────────────────────────────────────────────────────
// Address checks
// ──────────────────────────────────────────────────────────────

export function isZeroAddress(address: Address): boolean {
  return address.equals(ZERO_ADDRESS);
}

export function isTreasuryAddress(address: Address): boolean {
  return address.equals(TREASURY_ADDRESS);
}

// ──────────────────────────────────────────────────────────────
// Math helpers
// ──────────────────────────────────────────────────────────────

export function calculatePercentageBasisPoints(
  numerator: BigInt,
  denominator: BigInt
): BigInt {
  if (denominator.equals(BigInt.zero())) {
    return BigInt.zero();
  }
  return numerator.times(BASIS_POINTS).div(denominator);
}

// ──────────────────────────────────────────────────────────────
// Bridged LP metadata
// ──────────────────────────────────────────────────────────────

// Returns the origin chain name for a bridged LP token address
export function getBridgedLPOriginChain(address: Address): string {
  if (address.equals(BRIDGED_LP_GNOSIS)) return 'gnosis';
  if (address.equals(BRIDGED_LP_POLYGON)) return 'polygon';
  if (address.equals(BRIDGED_LP_SOLANA)) return 'solana';
  if (address.equals(BRIDGED_LP_ARBITRUM)) return 'arbitrum';
  if (address.equals(BRIDGED_LP_OPTIMISM)) return 'optimism';
  if (address.equals(BRIDGED_LP_BASE)) return 'base';
  if (address.equals(BRIDGED_LP_CELO)) return 'celo';
  return 'unknown';
}

export function getBridgedLPPair(address: Address): string {
  if (address.equals(BRIDGED_LP_GNOSIS)) return 'OLAS-WXDAI';
  if (address.equals(BRIDGED_LP_POLYGON)) return 'OLAS-WMATIC';
  if (address.equals(BRIDGED_LP_SOLANA)) return 'WSOL-OLAS';
  if (address.equals(BRIDGED_LP_ARBITRUM)) return 'OLAS-WETH';
  if (address.equals(BRIDGED_LP_OPTIMISM)) return 'WETH-OLAS';
  if (address.equals(BRIDGED_LP_BASE)) return 'OLAS-USDC';
  if (address.equals(BRIDGED_LP_CELO)) return 'CELO-OLAS';
  return 'unknown';
}

// ──────────────────────────────────────────────────────────────
// Entity get-or-create functions
// ──────────────────────────────────────────────────────────────

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
    metrics.ethUsdPrice = BigInt.zero();
    metrics.maticUsdPrice = BigInt.zero();
    metrics.poolLiquidityUsd = BigInt.zero();
    metrics.protocolOwnedLiquidityUsd = BigInt.zero();
    metrics.lastUpdated = BigInt.zero();
    metrics.firstTransferTimestamp = BigInt.zero();
  }
  return metrics;
}

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

export function getOrCreateBridgedPOLHolding(
  tokenAddress: Address
): BridgedPOLHolding {
  let holding = BridgedPOLHolding.load(tokenAddress);
  if (holding == null) {
    holding = new BridgedPOLHolding(tokenAddress);
    holding.originChain = getBridgedLPOriginChain(tokenAddress);
    holding.pair = getBridgedLPPair(tokenAddress);
    holding.currentBalance = BigInt.zero();
    holding.totalAcquired = BigInt.zero();
    holding.totalSold = BigInt.zero();
    holding.lastTransactionTimestamp = BigInt.zero();
    holding.transactionCount = 0;
  }
  return holding;
}

// ──────────────────────────────────────────────────────────────
// USD valuation
// ──────────────────────────────────────────────────────────────

/**
 * Recalculate USD valuations on LPTokenMetrics using current reserves and Chainlink prices.
 * poolLiquidityUsd (8 decimals) = 2 * reserve1_ETH_wei * ethUsdPrice_8dec / 1e18
 * protocolOwnedLiquidityUsd = poolLiquidityUsd * treasuryPercentage / 10000
 * Also updates maticUsdPrice from the MATIC/USD feed (for off-chain POL aggregation).
 */
export function recalculateUsd(metrics: LPTokenMetrics): void {
  let ethPriceData = PriceData.load(ETH_PRICE_ID);
  if (ethPriceData != null && ethPriceData.price.gt(BigInt.zero())) {
    metrics.ethUsdPrice = ethPriceData.price;
    metrics.poolLiquidityUsd = BigInt.fromI32(2)
      .times(metrics.currentReserve1)
      .times(ethPriceData.price)
      .div(WEI);
    metrics.protocolOwnedLiquidityUsd = metrics.poolLiquidityUsd
      .times(metrics.treasuryPercentage)
      .div(BASIS_POINTS);
  }

  let maticPriceData = PriceData.load(MATIC_PRICE_ID);
  if (maticPriceData != null && maticPriceData.price.gt(BigInt.zero())) {
    metrics.maticUsdPrice = maticPriceData.price;
  }
}

// ──────────────────────────────────────────────────────────────
// Update functions
// ──────────────────────────────────────────────────────────────

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

  // Recalculate USD with updated treasury percentage
  recalculateUsd(metrics);

  if (metrics.firstTransferTimestamp.equals(BigInt.zero())) {
    metrics.firstTransferTimestamp = timestamp;
  }
  metrics.lastUpdated = timestamp;

  metrics.save();
}

export function updateGlobalMetricsAfterSync(
  reserve0: BigInt,
  reserve1: BigInt,
  timestamp: BigInt
): void {
  let metrics = getOrCreateLPTokenMetrics();

  metrics.currentReserve0 = reserve0;
  metrics.currentReserve1 = reserve1;

  // Recalculate USD with updated reserves
  recalculateUsd(metrics);

  metrics.lastUpdated = timestamp;

  metrics.save();
}
