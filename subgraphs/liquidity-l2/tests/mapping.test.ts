import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  afterEach,
  createMockedFunction,
} from 'matchstick-as/assembly/index';
import { ethereum, BigInt, Bytes } from '@graphprotocol/graph-ts';

import { handleBPTTransfer, handleVaultSwap, handleUniswapSwap } from '../src/mapping';
import { createBPTTransferEvent, createVaultSwapEvent, createUniswapSwapEvent } from './mapping-utils';
import { TestAddresses, TestValues, POOL_ID } from './test-helpers';

// Mock the pool's getPoolId() and the Vault's getPoolTokens()
function mockBalancerCalls(): void {
  createMockedFunction(
    TestAddresses.POOL,
    'getPoolId',
    'getPoolId():(bytes32)'
  ).returns([ethereum.Value.fromFixedBytes(POOL_ID)]);

  createMockedFunction(
    TestAddresses.VAULT,
    'getPoolTokens',
    'getPoolTokens(bytes32):(address[],uint256[],uint256)'
  )
    .withArgs([ethereum.Value.fromFixedBytes(POOL_ID)])
    .returns([
      ethereum.Value.fromAddressArray([
        TestAddresses.TOKEN_OLAS,
        TestAddresses.TOKEN_WXDAI,
      ]),
      ethereum.Value.fromUnsignedBigIntArray([
        TestValues.RESERVE_OLAS,
        TestValues.RESERVE_WXDAI,
      ]),
      ethereum.Value.fromUnsignedBigInt(TestValues.BLOCK),
    ]);
}

describe('handleBPTTransfer', () => {
  beforeEach(() => {
    clearStore();
    mockBalancerCalls();
  });

  afterEach(() => {
    clearStore();
  });

  test('Mint increases BPT total supply', () => {
    let event = createBPTTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.BPT_AMOUNT,
      TestAddresses.POOL
    );
    handleBPTTransfer(event);

    assert.entityCount('BPTTransfer', 1);
    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'totalSupply',
      TestValues.BPT_AMOUNT.toString()
    );
    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'totalMinted',
      TestValues.BPT_AMOUNT.toString()
    );
  });

  test('Burn decreases BPT total supply', () => {
    // First mint
    let mintEvent = createBPTTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.BPT_AMOUNT,
      TestAddresses.POOL
    );
    handleBPTTransfer(mintEvent);

    // Then burn half
    let burnEvent = createBPTTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.ZERO,
      TestValues.BPT_AMOUNT_SMALL,
      TestAddresses.POOL,
      1
    );
    handleBPTTransfer(burnEvent);

    let expectedSupply = TestValues.BPT_AMOUNT.minus(TestValues.BPT_AMOUNT_SMALL);
    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'totalSupply',
      expectedSupply.toString()
    );
    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'totalBurned',
      TestValues.BPT_AMOUNT_SMALL.toString()
    );
  });

  test('Fetches pool reserves from Vault', () => {
    let event = createBPTTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.BPT_AMOUNT,
      TestAddresses.POOL
    );
    handleBPTTransfer(event);

    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'reserve0',
      TestValues.RESERVE_OLAS.toString()
    );
    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'reserve1',
      TestValues.RESERVE_WXDAI.toString()
    );
  });

  test('Stores token addresses from Vault', () => {
    let event = createBPTTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.BPT_AMOUNT,
      TestAddresses.POOL
    );
    handleBPTTransfer(event);

    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'token0',
      TestAddresses.TOKEN_OLAS.toHexString()
    );
    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'token1',
      TestAddresses.TOKEN_WXDAI.toHexString()
    );
  });

  test('Stores pool ID', () => {
    let event = createBPTTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.BPT_AMOUNT,
      TestAddresses.POOL
    );
    handleBPTTransfer(event);

    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'poolId',
      POOL_ID.toHexString()
    );
  });

  test('Regular transfer does not change supply', () => {
    // Mint first
    let mintEvent = createBPTTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.BPT_AMOUNT,
      TestAddresses.POOL
    );
    handleBPTTransfer(mintEvent);

    // Regular transfer
    let transferEvent = createBPTTransferEvent(
      TestAddresses.USER_1,
      TestAddresses.USER_2,
      TestValues.BPT_AMOUNT_SMALL,
      TestAddresses.POOL,
      1
    );
    handleBPTTransfer(transferEvent);

    // Supply unchanged
    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'totalSupply',
      TestValues.BPT_AMOUNT.toString()
    );
    assert.entityCount('BPTTransfer', 2);
  });

  test('Multiple mints accumulate correctly', () => {
    let mint1 = createBPTTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.BPT_AMOUNT,
      TestAddresses.POOL
    );
    handleBPTTransfer(mint1);

    let mint2 = createBPTTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_2,
      TestValues.BPT_AMOUNT_SMALL,
      TestAddresses.POOL,
      1
    );
    handleBPTTransfer(mint2);

    let expectedSupply = TestValues.BPT_AMOUNT.plus(TestValues.BPT_AMOUNT_SMALL);
    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'totalSupply',
      expectedSupply.toString()
    );
    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'totalMinted',
      expectedSupply.toString()
    );
  });
});

// Mock getSwapFeePercentage for Vault swap tests
function mockSwapFee(): void {
  createMockedFunction(
    TestAddresses.POOL,
    'getSwapFeePercentage',
    'getSwapFeePercentage():(uint256)'
  ).returns([
    ethereum.Value.fromUnsignedBigInt(TestValues.SWAP_FEE_PERCENTAGE),
  ]);
}

describe('handleVaultSwap', () => {
  beforeEach(() => {
    clearStore();
    mockBalancerCalls();
    mockSwapFee();

    // First do a mint so PoolMetrics has poolId and token addresses
    let mintEvent = createBPTTransferEvent(
      TestAddresses.ZERO,
      TestAddresses.USER_1,
      TestValues.BPT_AMOUNT,
      TestAddresses.POOL
    );
    handleBPTTransfer(mintEvent);
  });

  afterEach(() => {
    clearStore();
  });

  test('Matching poolId tracks fees correctly', () => {
    // Swap 1000 WXDAI into OLAS
    let swapEvent = createVaultSwapEvent(
      POOL_ID,
      TestAddresses.TOKEN_WXDAI,
      TestAddresses.TOKEN_OLAS,
      TestValues.SWAP_AMOUNT,
      BigInt.fromI32(5000),
      TestAddresses.VAULT
    );
    handleVaultSwap(swapEvent);

    // fee = 1000e18 * 10000000000000000 / 1e18 = 10e18 = 10 WXDAI
    let expectedFee = TestValues.SWAP_AMOUNT
      .times(TestValues.SWAP_FEE_PERCENTAGE)
      .div(BigInt.fromString('1000000000000000000'));

    let dayId = TestValues.TIMESTAMP.div(BigInt.fromI32(86400)).times(BigInt.fromI32(86400)).toString();

    assert.entityCount('DailyFees', 1);
    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken1', expectedFee.toString());
    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken0', '0');
    assert.fieldEquals('DailyFees', dayId, 'swapCount', '1');
  });

  test('Swap before any mint is ignored (no PoolMetrics)', () => {
    // Clear store to ensure no PoolMetrics exists
    clearStore();

    let swapEvent = createVaultSwapEvent(
      POOL_ID,
      TestAddresses.TOKEN_WXDAI,
      TestAddresses.TOKEN_OLAS,
      TestValues.SWAP_AMOUNT,
      BigInt.fromI32(5000),
      TestAddresses.VAULT
    );
    handleVaultSwap(swapEvent);

    // No DailyFees should be created because PoolMetrics doesn't exist yet
    assert.entityCount('DailyFees', 0);
  });

  test('Non-matching poolId is ignored', () => {
    // Use a different poolId
    let otherPoolId = Bytes.fromHexString(
      '0x1111111111111111111111111111111111111111000200000000000000000099'
    );
    let swapEvent = createVaultSwapEvent(
      otherPoolId,
      TestAddresses.TOKEN_WXDAI,
      TestAddresses.TOKEN_OLAS,
      TestValues.SWAP_AMOUNT,
      BigInt.fromI32(5000),
      TestAddresses.VAULT
    );
    handleVaultSwap(swapEvent);

    assert.entityCount('DailyFees', 0);
  });

  test('Multiple swaps accumulate daily fees', () => {
    let swap1 = createVaultSwapEvent(
      POOL_ID,
      TestAddresses.TOKEN_WXDAI,
      TestAddresses.TOKEN_OLAS,
      TestValues.SWAP_AMOUNT,
      BigInt.fromI32(5000),
      TestAddresses.VAULT
    );
    handleVaultSwap(swap1);

    let swap2 = createVaultSwapEvent(
      POOL_ID,
      TestAddresses.TOKEN_OLAS,
      TestAddresses.TOKEN_WXDAI,
      TestValues.SWAP_AMOUNT,
      BigInt.fromI32(100),
      TestAddresses.VAULT,
      TestValues.TIMESTAMP,
      1
    );
    handleVaultSwap(swap2);

    let dayId = TestValues.TIMESTAMP.div(BigInt.fromI32(86400)).times(BigInt.fromI32(86400)).toString();
    assert.fieldEquals('DailyFees', dayId, 'swapCount', '2');

    let singleFee = TestValues.SWAP_AMOUNT
      .times(TestValues.SWAP_FEE_PERCENTAGE)
      .div(BigInt.fromString('1000000000000000000'));

    // First swap: fee in token1 (WXDAI), second: fee in token0 (OLAS)
    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken1', singleFee.toString());
    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken0', singleFee.toString());
  });

  test('Cumulative fees update on PoolMetrics', () => {
    let swapEvent = createVaultSwapEvent(
      POOL_ID,
      TestAddresses.TOKEN_WXDAI,
      TestAddresses.TOKEN_OLAS,
      TestValues.SWAP_AMOUNT,
      BigInt.fromI32(5000),
      TestAddresses.VAULT
    );
    handleVaultSwap(swapEvent);

    let expectedFee = TestValues.SWAP_AMOUNT
      .times(TestValues.SWAP_FEE_PERCENTAGE)
      .div(BigInt.fromString('1000000000000000000'));

    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'cumulativeFeesToken1',
      expectedFee.toString()
    );
    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'swapFeePercentage',
      TestValues.SWAP_FEE_PERCENTAGE.toString()
    );
  });
});

describe('handleUniswapSwap', () => {
  beforeEach(() => {
    clearStore();
  });

  afterEach(() => {
    clearStore();
  });

  test('Celo swap tracks fees at 0.3%', () => {
    let celoIn = BigInt.fromString('1000000000000000000000'); // 1000 CELO
    let swapEvent = createUniswapSwapEvent(
      TestAddresses.USER_1,
      BigInt.zero(),
      celoIn,
      BigInt.fromI32(5000),
      BigInt.zero(),
      TestAddresses.USER_1,
      TestAddresses.POOL
    );
    handleUniswapSwap(swapEvent);

    // fee = 1000e18 * 3 / 1000 = 3e18 = 3 CELO
    let expectedFee = celoIn.times(BigInt.fromI32(3)).div(BigInt.fromI32(1000));
    let dayId = TestValues.TIMESTAMP.div(BigInt.fromI32(86400)).times(BigInt.fromI32(86400)).toString();

    assert.entityCount('DailyFees', 1);
    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken1', expectedFee.toString());
    assert.fieldEquals('DailyFees', dayId, 'totalFeesToken0', '0');
    assert.fieldEquals('DailyFees', dayId, 'swapCount', '1');
  });

  test('Swaps on different days create separate DailyFees', () => {
    let celoIn = BigInt.fromString('1000000000000000000000');

    let swap1 = createUniswapSwapEvent(
      TestAddresses.USER_1,
      BigInt.zero(),
      celoIn,
      BigInt.fromI32(5000),
      BigInt.zero(),
      TestAddresses.USER_1,
      TestAddresses.POOL
    );
    handleUniswapSwap(swap1);

    let nextDay = TestValues.TIMESTAMP.plus(BigInt.fromI32(86400));
    let swap2 = createUniswapSwapEvent(
      TestAddresses.USER_1,
      BigInt.zero(),
      celoIn,
      BigInt.fromI32(5000),
      BigInt.zero(),
      TestAddresses.USER_1,
      TestAddresses.POOL,
      nextDay,
      1
    );
    handleUniswapSwap(swap2);

    assert.entityCount('DailyFees', 2);
  });

  test('Cumulative fees update on PoolMetrics', () => {
    let olasIn = BigInt.fromString('10000000000000000000000'); // 10000 OLAS
    let swapEvent = createUniswapSwapEvent(
      TestAddresses.USER_1,
      olasIn,
      BigInt.zero(),
      BigInt.zero(),
      BigInt.fromI32(100),
      TestAddresses.USER_1,
      TestAddresses.POOL
    );
    handleUniswapSwap(swapEvent);

    let expectedFee = olasIn.times(BigInt.fromI32(3)).div(BigInt.fromI32(1000));

    assert.fieldEquals(
      'PoolMetrics',
      TestAddresses.POOL.toHexString(),
      'cumulativeFeesToken0',
      expectedFee.toString()
    );
  });
});
