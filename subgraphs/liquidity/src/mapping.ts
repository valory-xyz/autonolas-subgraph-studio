import { Transfer } from '../generated/OLASETHLPToken/ERC20';
import { Sync } from '../generated/OLASETHPair/UniswapV2Pair';
import { AggregatorV3Interface } from '../generated/OLASETHPair/AggregatorV3Interface';

import { LPTransfer, PriceData } from '../generated/schema';

import {
  isZeroAddress,
  isTreasuryAddress,
  getOrCreatePoolReserves,
  getOrCreateBridgedPOLHolding,
  updateTreasuryHoldings,
  updateGlobalMetricsAfterTransfer,
  updateGlobalMetricsAfterSync,
  CHAINLINK_ETH_USD,
  PRICE_ID,
} from './utils';

/**
 * Handle LP Token Transfer events for the native OLAS-ETH pool.
 * Tracks minting, burning, and treasury movements.
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
    updateTreasuryHoldings(value, true, timestamp);
  } else if (isTreasuryAddress(from)) {
    updateTreasuryHoldings(value, false, timestamp);
  }

  updateGlobalMetricsAfterTransfer(value, isMint, isBurn, timestamp);
}

/**
 * Handle Uniswap V2 Sync events.
 * Updates pool reserves and fetches latest ETH/USD price from Chainlink.
 */
export function handleSync(event: Sync): void {
  let poolAddress = event.address;
  let reserve0 = event.params.reserve0; // OLAS reserves
  let reserve1 = event.params.reserve1; // ETH reserves
  let timestamp = event.block.timestamp;

  // Update current pool reserves
  let reserves = getOrCreatePoolReserves(poolAddress);
  reserves.reserve0 = reserve0;
  reserves.reserve1 = reserve1;
  reserves.lastSyncBlock = event.block.number;
  reserves.lastSyncTimestamp = timestamp;
  reserves.lastSyncTransaction = event.transaction.hash;
  reserves.save();

  // Fetch latest ETH/USD price from Chainlink
  let chainlink = AggregatorV3Interface.bind(CHAINLINK_ETH_USD);
  let result = chainlink.try_latestRoundData();
  if (!result.reverted) {
    let ethPrice = result.value.getAnswer();
    let priceData = new PriceData(PRICE_ID);
    priceData.price = ethPrice;
    priceData.lastUpdatedBlock = event.block.number;
    priceData.lastUpdatedTimestamp = timestamp;
    priceData.save();
  }

  // Update global metrics (includes USD recalculation)
  updateGlobalMetricsAfterSync(reserve0, reserve1, timestamp);
}

/**
 * Handle Transfer events for bridged LP tokens on Ethereum mainnet.
 * Only tracks transfers to/from Treasury for POL accounting.
 * The token address (event.address) identifies which bridged LP token is being transferred.
 */
export function handleBridgedLPTransfer(event: Transfer): void {
  let from = event.params.from;
  let to = event.params.to;
  let value = event.params.value;
  let timestamp = event.block.timestamp;

  if (isTreasuryAddress(to)) {
    let holding = getOrCreateBridgedPOLHolding(event.address);
    holding.currentBalance = holding.currentBalance.plus(value);
    holding.totalAcquired = holding.totalAcquired.plus(value);
    holding.lastTransactionTimestamp = timestamp;
    holding.transactionCount = holding.transactionCount + 1;
    holding.save();
  } else if (isTreasuryAddress(from)) {
    let holding = getOrCreateBridgedPOLHolding(event.address);
    holding.currentBalance = holding.currentBalance.minus(value);
    holding.totalSold = holding.totalSold.plus(value);
    holding.lastTransactionTimestamp = timestamp;
    holding.transactionCount = holding.transactionCount + 1;
    holding.save();
  }
}
