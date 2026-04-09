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

import { handleLPTransfer, handleSync, handleSwap, handleBridgedLPTransfer } from '../src/mapping';
import { createTransferEvent, createSyncEvent, createSwapEvent } from './mapping-utils';
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
  createMockedFunction(
    TestAddresses.CHAINLINK_SOL_USD,
    'latestRoundData',
    'latestRoundData():(uint80,int256,uint256,uint256,uint80)'
  ).returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
    ethereum.Value.fromSignedBigInt(TestValues.SOL_PRICE),
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

  test('Fetches and stores SOL/USD price from Chainlink', () => {
    let event = createSyncEvent(
      TestValues.RESERVE_OLAS,
      TestValues.RESERVE_ETH,
      TestAddresses.POOL
    );
    handleSync(event);

    assert.fieldEquals(
      'PriceData',
      'sol-usd',
      'price',
      TestValues.SOL_PRICE.toString()
    );
    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'solUsdPrice',
      TestValues.SOL_PRICE.toString()
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

describe('handleSwap', () => {
  beforeEach(() => {
    clearStore();
    mockChainlinkPrices();

    // Set up pool state: mint LP, send to treasury, sync reserves
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

    // Sync reserves so prices and reserves are available
    let syncEvent = createSyncEvent(
      TestValues.RESERVE_OLAS,
      TestValues.RESERVE_ETH,
      TestAddresses.POOL
    );
    handleSync(syncEvent);
  });

  afterEach(() => {
    clearStore();
  });

  test('ETH input swap creates DailyFees with correct fee', () => {
    // Swap: 1 ETH in, OLAS out
    let ethIn = BigInt.fromString('1000000000000000000'); // 1 ETH
    let swapEvent = createSwapEvent(
      TestAddresses.USER_1,
      BigInt.zero(),          // amount0In (OLAS) = 0
      ethIn,                  // amount1In (ETH) = 1 ETH
      BigInt.fromI32(1000),   // amount0Out (OLAS)
      BigInt.zero(),          // amount1Out (ETH) = 0
      TestAddresses.USER_1,
      TestAddresses.POOL
    );
    handleSwap(swapEvent);

    // fee = 1 ETH * 3 / 1000 = 0.003 ETH = 3000000000000000 wei
    let expectedFeeEth = ethIn.times(BigInt.fromI32(3)).div(BigInt.fromI32(1000));
    // feeUsd = 3000000000000000 * 200000000000 / 1e18 = 600000000 ($6.00 in 8 dec)
    let expectedFeeUsd = expectedFeeEth.times(TestValues.ETH_PRICE).div(BigInt.fromString('1000000000000000000'));

    let dayId = TestValues.TIMESTAMP.div(BigInt.fromI32(86400)).times(BigInt.fromI32(86400)).toString();

    assert.entityCount('DailyFees', 1);
    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken1', expectedFeeEth.toString());
    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken0', '0');
    assert.fieldEquals('DailyFees', dayId, 'totalFeesUsd', expectedFeeUsd.toString());
    assert.fieldEquals('DailyFees', dayId, 'swapCount', '1');
  });

  test('OLAS input swap calculates fee using pool ratio', () => {
    // Swap: 10000 OLAS in, ETH out
    let olasIn = BigInt.fromString('10000000000000000000000'); // 10,000 OLAS
    let swapEvent = createSwapEvent(
      TestAddresses.USER_1,
      olasIn,                 // amount0In (OLAS)
      BigInt.zero(),          // amount1In (ETH) = 0
      BigInt.zero(),          // amount0Out (OLAS) = 0
      BigInt.fromI32(1000),   // amount1Out (ETH)
      TestAddresses.USER_1,
      TestAddresses.POOL
    );
    handleSwap(swapEvent);

    // fee = 10000 OLAS * 3 / 1000 = 30 OLAS = 30e18 wei
    let expectedFeeOlas = olasIn.times(BigInt.fromI32(3)).div(BigInt.fromI32(1000));
    // feeInEth = 30 OLAS * 100 ETH / 1,000,000 OLAS = 0.003 ETH
    let feeInEth = expectedFeeOlas.times(TestValues.RESERVE_ETH).div(TestValues.RESERVE_OLAS);
    // feeUsd = 0.003 ETH * $2000 = $6.00 = 600000000
    let expectedFeeUsd = feeInEth.times(TestValues.ETH_PRICE).div(BigInt.fromString('1000000000000000000'));

    let dayId = TestValues.TIMESTAMP.div(BigInt.fromI32(86400)).times(BigInt.fromI32(86400)).toString();

    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken0', expectedFeeOlas.toString());
    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken1', '0');
    assert.fieldEquals('DailyFees', dayId, 'totalFeesUsd', expectedFeeUsd.toString());
  });

  test('Protocol/external split uses treasury percentage', () => {
    // Treasury owns 50% (5000 basis points)
    let ethIn = BigInt.fromString('1000000000000000000'); // 1 ETH
    let swapEvent = createSwapEvent(
      TestAddresses.USER_1,
      BigInt.zero(),
      ethIn,
      BigInt.fromI32(1000),
      BigInt.zero(),
      TestAddresses.USER_1,
      TestAddresses.POOL
    );
    handleSwap(swapEvent);

    let feeEth = ethIn.times(BigInt.fromI32(3)).div(BigInt.fromI32(1000));
    let feeUsd = feeEth.times(TestValues.ETH_PRICE).div(BigInt.fromString('1000000000000000000'));
    let protocolFeeUsd = feeUsd.times(BigInt.fromI32(5000)).div(BigInt.fromI32(10000));
    let externalFeeUsd = feeUsd.minus(protocolFeeUsd);

    let dayId = TestValues.TIMESTAMP.div(BigInt.fromI32(86400)).times(BigInt.fromI32(86400)).toString();

    assert.fieldEquals('DailyFees', dayId, 'protocolFeesUsd', protocolFeeUsd.toString());
    assert.fieldEquals('DailyFees', dayId, 'externalFeesUsd', externalFeeUsd.toString());
  });

  test('Multiple swaps in same day accumulate', () => {
    let ethIn = BigInt.fromString('1000000000000000000'); // 1 ETH
    let swap1 = createSwapEvent(
      TestAddresses.USER_1,
      BigInt.zero(),
      ethIn,
      BigInt.fromI32(1000),
      BigInt.zero(),
      TestAddresses.USER_1,
      TestAddresses.POOL
    );
    handleSwap(swap1);

    let swap2 = createSwapEvent(
      TestAddresses.USER_1,
      BigInt.zero(),
      ethIn,
      BigInt.fromI32(1000),
      BigInt.zero(),
      TestAddresses.USER_1,
      TestAddresses.POOL,
      TestValues.TIMESTAMP,
      1
    );
    handleSwap(swap2);

    let dayId = TestValues.TIMESTAMP.div(BigInt.fromI32(86400)).times(BigInt.fromI32(86400)).toString();
    let singleFee = ethIn.times(BigInt.fromI32(3)).div(BigInt.fromI32(1000));
    let totalFee = singleFee.times(BigInt.fromI32(2));

    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken1', totalFee.toString());
    assert.fieldEquals('DailyFees', dayId, 'swapCount', '2');
  });

  test('Swaps on different days create separate DailyFees', () => {
    let ethIn = BigInt.fromString('1000000000000000000');

    // Day 1 swap
    let swap1 = createSwapEvent(
      TestAddresses.USER_1,
      BigInt.zero(),
      ethIn,
      BigInt.fromI32(1000),
      BigInt.zero(),
      TestAddresses.USER_1,
      TestAddresses.POOL,
      TestValues.TIMESTAMP
    );
    handleSwap(swap1);

    // Day 2 swap (next day = +86400 seconds)
    let nextDay = TestValues.TIMESTAMP.plus(BigInt.fromI32(86400));
    let swap2 = createSwapEvent(
      TestAddresses.USER_1,
      BigInt.zero(),
      ethIn,
      BigInt.fromI32(1000),
      BigInt.zero(),
      TestAddresses.USER_1,
      TestAddresses.POOL,
      nextDay,
      1
    );
    handleSwap(swap2);

    assert.entityCount('DailyFees', 2);

    let day1Id = TestValues.TIMESTAMP.div(BigInt.fromI32(86400)).times(BigInt.fromI32(86400)).toString();
    let day2Id = nextDay.div(BigInt.fromI32(86400)).times(BigInt.fromI32(86400)).toString();

    assert.fieldEquals('DailyFees', day1Id, 'swapCount', '1');
    assert.fieldEquals('DailyFees', day2Id, 'swapCount', '1');
  });

  test('Cumulative fees update on LPTokenMetrics', () => {
    let ethIn = BigInt.fromString('1000000000000000000');
    let swapEvent = createSwapEvent(
      TestAddresses.USER_1,
      BigInt.zero(),
      ethIn,
      BigInt.fromI32(1000),
      BigInt.zero(),
      TestAddresses.USER_1,
      TestAddresses.POOL
    );
    handleSwap(swapEvent);

    let feeEth = ethIn.times(BigInt.fromI32(3)).div(BigInt.fromI32(1000));
    let feeUsd = feeEth.times(TestValues.ETH_PRICE).div(BigInt.fromString('1000000000000000000'));

    assert.fieldEquals(
      'LPTokenMetrics',
      'global',
      'cumulativeFeesUsd',
      feeUsd.toString()
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

  test('Base WETH-OLAS bridged LP creates correct metadata', () => {
    let event = createTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.TREASURY,
      TestValues.LP_AMOUNT,
      TestAddresses.BRIDGED_LP_BASE_WETH
    );
    handleBridgedLPTransfer(event);

    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_BASE_WETH.toHexString(),
      'originChain',
      'base-weth'
    );
    assert.fieldEquals(
      'BridgedPOLHolding',
      TestAddresses.BRIDGED_LP_BASE_WETH.toHexString(),
      'pair',
      'WETH-OLAS'
    );
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
