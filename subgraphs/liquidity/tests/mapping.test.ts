import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  afterEach,
  createMockedFunction,
} from 'matchstick-as/assembly/index';
import { ethereum, BigInt } from '@graphprotocol/graph-ts';

import { handleLPTransfer, handleSync, handleBridgedLPTransfer } from '../src/mapping';
import { createTransferEvent, createSyncEvent } from './mapping-utils';
import { TestAddresses, TestValues } from './test-helpers';

// Mock Chainlink latestRoundData for handleSync tests
function mockChainlinkPrices(): void {
  createMockedFunction(
    TestAddresses.CHAINLINK_ETH_USD,
    'latestRoundData',
    'latestRoundData():(uint80,int256,uint256,uint256,uint80)'
  ).returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
    ethereum.Value.fromSignedBigInt(TestValues.ETH_PRICE),
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000000)),
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000000)),
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
  ]);
  createMockedFunction(
    TestAddresses.CHAINLINK_MATIC_USD,
    'latestRoundData',
    'latestRoundData():(uint80,int256,uint256,uint256,uint80)'
  ).returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
    ethereum.Value.fromSignedBigInt(TestValues.MATIC_PRICE),
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000000)),
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000000)),
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
  ]);
}

describe('handleLPTransfer', () => {
  beforeEach(() => {
    clearStore();
  });

  afterEach(() => {
    clearStore();
  });

  test('Mint increases total supply', () => {
    let event = createTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.LP_AMOUNT,
      TestAddresses.POOL
    );
    handleLPTransfer(event);

    assert.entityCount('LPTransfer', 1);
    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'totalSupply',
      TestValues.LP_AMOUNT.toString()
    );
    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'totalMinted',
      TestValues.LP_AMOUNT.toString()
    );
  });

  test('Burn decreases total supply', () => {
    // First mint
    let mintEvent = createTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.LP_AMOUNT,
      TestAddresses.POOL
    );
    handleLPTransfer(mintEvent);

    // Then burn half
    let burnEvent = createTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.ZERO,
      TestValues.LP_AMOUNT_SMALL,
      TestAddresses.POOL,
      1
    );
    handleLPTransfer(burnEvent);

    let expectedSupply = TestValues.LP_AMOUNT.minus(TestValues.LP_AMOUNT_SMALL);
    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'totalSupply',
      expectedSupply.toString()
    );
    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'totalBurned',
      TestValues.LP_AMOUNT_SMALL.toString()
    );
  });

  test('Transfer to treasury updates treasury holdings', () => {
    // Mint to user
    let mintEvent = createTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.LP_AMOUNT,
      TestAddresses.POOL
    );
    handleLPTransfer(mintEvent);

    // Transfer to treasury
    let transferEvent = createTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.TREASURY,
      TestValues.LP_AMOUNT_SMALL,
      TestAddresses.POOL,
      1
    );
    handleLPTransfer(transferEvent);

    assert.fieldEquals(
      'TreasuryHoldings',
      TestAddresses.TREASURY.toHexString(),
      'currentBalance',
      TestValues.LP_AMOUNT_SMALL.toString()
    );
    assert.fieldEquals(
      'TreasuryHoldings',
      TestAddresses.TREASURY.toHexString(),
      'totalAcquired',
      TestValues.LP_AMOUNT_SMALL.toString()
    );
    assert.fieldEquals(
      'TreasuryHoldings',
      TestAddresses.TREASURY.toHexString(),
      'transactionCount',
      '1'
    );
  });

  test('Transfer from treasury updates treasury holdings', () => {
    // Mint directly to treasury
    let mintEvent = createTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.TREASURY,
      TestValues.LP_AMOUNT,
      TestAddresses.POOL
    );
    handleLPTransfer(mintEvent);

    // Treasury sends some out
    let transferEvent = createTransferEvent(
      TestAddresses.TREASURY,
      TestAddresses.USER_1,
      TestValues.LP_AMOUNT_SMALL,
      TestAddresses.POOL,
      1
    );
    handleLPTransfer(transferEvent);

    let expectedBalance = TestValues.LP_AMOUNT.minus(TestValues.LP_AMOUNT_SMALL);
    assert.fieldEquals(
      'TreasuryHoldings',
      TestAddresses.TREASURY.toHexString(),
      'currentBalance',
      expectedBalance.toString()
    );
    assert.fieldEquals(
      'TreasuryHoldings',
      TestAddresses.TREASURY.toHexString(),
      'totalSold',
      TestValues.LP_AMOUNT_SMALL.toString()
    );
  });

  test('Treasury percentage calculated correctly', () => {
    // Mint 1000 LP total
    let mintEvent = createTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.LP_AMOUNT,
      TestAddresses.POOL
    );
    handleLPTransfer(mintEvent);

    // Transfer 500 to treasury (50%)
    let transferEvent = createTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.TREASURY,
      TestValues.LP_AMOUNT_SMALL,
      TestAddresses.POOL,
      1
    );
    handleLPTransfer(transferEvent);

    // 500/1000 = 50% = 5000 basis points
    assert.fieldEquals('LPTokenMetrics', 'global', 'treasuryPercentage', '5000');
  });
});

describe('handleSync', () => {
  beforeEach(() => {
    clearStore();
    mockChainlinkPrices();
  });

  afterEach(() => {
    clearStore();
  });

  test('Updates pool reserves', () => {
    let event = createSyncEvent(
      TestValues.RESERVE_OLAS,
      TestValues.RESERVE_ETH,
      TestAddresses.POOL
    );
    handleSync(event);

    assert.fieldEquals(
      'PoolReserves',
      TestAddresses.POOL.toHexString(),
      'reserve0',
      TestValues.RESERVE_OLAS.toString()
    );
    assert.fieldEquals(
      'PoolReserves',
      TestAddresses.POOL.toHexString(),
      'reserve1',
      TestValues.RESERVE_ETH.toString()
    );
  });

  test('Updates global metrics reserves', () => {
    let event = createSyncEvent(
      TestValues.RESERVE_OLAS,
      TestValues.RESERVE_ETH,
      TestAddresses.POOL
    );
    handleSync(event);

    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'currentReserve0',
      TestValues.RESERVE_OLAS.toString()
    );
    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'currentReserve1',
      TestValues.RESERVE_ETH.toString()
    );
  });

  test('Fetches and stores ETH/USD price from Chainlink', () => {
    let event = createSyncEvent(
      TestValues.RESERVE_OLAS,
      TestValues.RESERVE_ETH,
      TestAddresses.POOL
    );
    handleSync(event);

    assert.fieldEquals(
      'PriceData',
      'eth-usd',
      'price',
      TestValues.ETH_PRICE.toString()
    );
  });

  test('Fetches and stores MATIC/USD price from Chainlink', () => {
    let event = createSyncEvent(
      TestValues.RESERVE_OLAS,
      TestValues.RESERVE_ETH,
      TestAddresses.POOL
    );
    handleSync(event);

    assert.fieldEquals(
      'PriceData',
      'matic-usd',
      'price',
      TestValues.MATIC_PRICE.toString()
    );
    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'maticUsdPrice',
      TestValues.MATIC_PRICE.toString()
    );
  });

  test('Calculates poolLiquidityUsd correctly', () => {
    // First mint some LP so treasury % is set
    let mintEvent = createTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.LP_AMOUNT,
      TestAddresses.POOL
    );
    handleLPTransfer(mintEvent);

    let event = createSyncEvent(
      TestValues.RESERVE_OLAS,
      TestValues.RESERVE_ETH,
      TestAddresses.POOL
    );
    handleSync(event);

    // poolLiquidityUsd = 2 * 100e18 * 200000000000 / 1e18 = 40000000000000 (= $400,000 in 8 dec)
    let expectedUsd = BigInt.fromI32(2)
      .times(TestValues.RESERVE_ETH)
      .times(TestValues.ETH_PRICE)
      .div(BigInt.fromString('1000000000000000000'));

    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'poolLiquidityUsd',
      expectedUsd.toString()
    );
  });

  test('Calculates protocolOwnedLiquidityUsd with treasury share', () => {
    // Mint 1000 LP
    let mintEvent = createTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.LP_AMOUNT,
      TestAddresses.POOL
    );
    handleLPTransfer(mintEvent);

    // Transfer 500 to treasury (50%)
    let transferEvent = createTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.TREASURY,
      TestValues.LP_AMOUNT_SMALL,
      TestAddresses.POOL,
      1
    );
    handleLPTransfer(transferEvent);

    // Sync reserves
    let syncEvent = createSyncEvent(
      TestValues.RESERVE_OLAS,
      TestValues.RESERVE_ETH,
      TestAddresses.POOL
    );
    handleSync(syncEvent);

    // poolLiquidityUsd = 40000000000000
    // protocolOwnedLiquidityUsd = 40000000000000 * 5000 / 10000 = 20000000000000
    let poolUsd = BigInt.fromI32(2)
      .times(TestValues.RESERVE_ETH)
      .times(TestValues.ETH_PRICE)
      .div(BigInt.fromString('1000000000000000000'));
    let expectedPolUsd = poolUsd
      .times(BigInt.fromI32(5000))
      .div(BigInt.fromI32(10000));

    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'protocolOwnedLiquidityUsd',
      expectedPolUsd.toString()
    );
  });
});

describe('handleBridgedLPTransfer', () => {
  beforeEach(() => {
    clearStore();
  });

  afterEach(() => {
    clearStore();
  });

  test('Transfer to treasury creates BridgedPOLHolding', () => {
    let event = createTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.TREASURY,
      TestValues.LP_AMOUNT,
      TestAddresses.BRIDGED_LP_GNOSIS
    );
    handleBridgedLPTransfer(event);

    assert.entityCount('BridgedPOLHolding', 1);
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_GNOSIS.toHexString(),
      'currentBalance',
      TestValues.LP_AMOUNT.toString()
    );
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_GNOSIS.toHexString(),
      'originChain',
      'gnosis'
    );
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_GNOSIS.toHexString(),
      'pair',
      'OLAS-WXDAI'
    );
  });

  test('Transfer from treasury decreases balance', () => {
    // First acquire
    let acquireEvent = createTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.TREASURY,
      TestValues.LP_AMOUNT,
      TestAddresses.BRIDGED_LP_GNOSIS
    );
    handleBridgedLPTransfer(acquireEvent);

    // Then sell some
    let sellEvent = createTransferEvent(
      TestAddresses.TREASURY,
      TestAddresses.USER_2,
      TestValues.LP_AMOUNT_SMALL,
      TestAddresses.BRIDGED_LP_GNOSIS,
      1
    );
    handleBridgedLPTransfer(sellEvent);

    let expectedBalance = TestValues.LP_AMOUNT.minus(TestValues.LP_AMOUNT_SMALL);
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_GNOSIS.toHexString(),
      'currentBalance',
      expectedBalance.toString()
    );
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_GNOSIS.toHexString(),
      'totalSold',
      TestValues.LP_AMOUNT_SMALL.toString()
    );
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_GNOSIS.toHexString(),
      'transactionCount',
      '2'
    );
  });

  test('Non-treasury transfer is ignored', () => {
    let event = createTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.USER_2,
      TestValues.LP_AMOUNT,
      TestAddresses.BRIDGED_LP_GNOSIS
    );
    handleBridgedLPTransfer(event);

    assert.entityCount('BridgedPOLHolding', 0);
  });

  test('Multiple bridged tokens tracked independently', () => {
    let gnosisEvent = createTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.TREASURY,
      TestValues.LP_AMOUNT,
      TestAddresses.BRIDGED_LP_GNOSIS
    );
    handleBridgedLPTransfer(gnosisEvent);

    let polygonEvent = createTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.TREASURY,
      TestValues.LP_AMOUNT_SMALL,
      TestAddresses.BRIDGED_LP_POLYGON
    );
    handleBridgedLPTransfer(polygonEvent);

    assert.entityCount('BridgedPOLHolding', 2);
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_GNOSIS.toHexString(),
      'currentBalance',
      TestValues.LP_AMOUNT.toString()
    );
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_POLYGON.toHexString(),
      'currentBalance',
      TestValues.LP_AMOUNT_SMALL.toString()
    );
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_POLYGON.toHexString(),
      'originChain',
      'polygon'
    );
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_POLYGON.toHexString(),
      'pair',
      'OLAS-WMATIC'
    );
  });
});
