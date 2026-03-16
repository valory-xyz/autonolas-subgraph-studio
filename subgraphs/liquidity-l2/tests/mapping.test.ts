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

import { handleBPTTransfer } from '../src/mapping';
import { createBPTTransferEvent } from './mapping-utils';
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
