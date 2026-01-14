import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  afterEach,
  createMockedFunction,
} from 'matchstick-as/assembly/index';
import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import { handleSync, handleLPTransfer } from '../src/mapping';
import { LPTokenMetrics, PoolReserves } from '../generated/schema';
import {
  createSyncEvent,
  createMintEvent,
  createTransferEvent,
  POOL_ADDRESS,
  TREASURY_ADDRESS,
  ZERO_ADDRESS,
  CHAINLINK_ADDRESS,
  ethPriceToChainlink,
  ethToWei,
  toBigInt,
} from './test-utils';

/**
 * Mock Chainlink latestRoundData response
 * Returns: (roundId, answer, startedAt, updatedAt, answeredInRound)
 */
function mockChainlinkPrice(priceUsd: i32): void {
  const price = ethPriceToChainlink(priceUsd);

  createMockedFunction(
    CHAINLINK_ADDRESS,
    'latestRoundData',
    'latestRoundData():(uint80,int256,uint256,uint256,uint80)'
  ).returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)), // roundId
    ethereum.Value.fromSignedBigInt(price), // answer (price)
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000000)), // startedAt
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000000)), // updatedAt
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)), // answeredInRound
  ]);
}

describe('handleSync', () => {
  beforeEach(() => {
    // Setup default Chainlink mock for $2000 ETH
    mockChainlinkPrice(2000);
  });

  afterEach(() => {
    clearStore();
  });

  test('creates PoolReserves entity on first sync', () => {
    const reserve0 = toBigInt('1000000000000000000000'); // 1000 OLAS
    const reserve1 = ethToWei(100); // 100 ETH

    const syncEvent = createSyncEvent(reserve0, reserve1);
    handleSync(syncEvent);

    // Check PoolReserves was created
    const poolReserves = PoolReserves.load(POOL_ADDRESS);
    assert.assertNotNull(poolReserves);
    assert.bigIntEquals(poolReserves!.reserve0, reserve0);
    assert.bigIntEquals(poolReserves!.reserve1, reserve1);
  });

  test('updates LPTokenMetrics with USD values', () => {
    const reserve0 = toBigInt('1000000000000000000000');
    const reserve1 = ethToWei(100); // 100 ETH

    const syncEvent = createSyncEvent(reserve0, reserve1);
    handleSync(syncEvent);

    // Check LPTokenMetrics has USD values
    const metrics = LPTokenMetrics.load('global');
    assert.assertNotNull(metrics);

    // Pool liquidity USD should be 2 * 100 ETH * $2000 = $400,000
    assert.stringEquals(metrics!.poolLiquidityUsd.toString(), '400000');

    // ETH price should be $2000
    assert.stringEquals(metrics!.lastEthPriceUsd.toString(), '2000');
  });

  test('calculates POL USD correctly when treasury has tokens', () => {
    // First, mint some tokens to treasury
    const mintAmount = BigInt.fromI32(1000);
    const mintEvent = createMintEvent(TREASURY_ADDRESS, mintAmount);
    handleLPTransfer(mintEvent);

    // Now sync with reserves
    mockChainlinkPrice(1800);
    const reserve0 = toBigInt('500000000000000000000');
    const reserve1 = ethToWei(50); // 50 ETH

    const syncEvent = createSyncEvent(reserve0, reserve1);
    handleSync(syncEvent);

    const metrics = LPTokenMetrics.load('global');
    assert.assertNotNull(metrics);

    // Pool liquidity USD: 2 * 50 ETH * $1800 = $180,000
    assert.stringEquals(metrics!.poolLiquidityUsd.toString(), '180000');

    // Treasury owns 100% (only minted to treasury)
    // POL USD: 180000 * (1000/1000) = $180,000
    assert.stringEquals(metrics!.protocolOwnedLiquidityUsd.toString(), '180000');
  });

  test('handles reserves update correctly', () => {
    // First sync
    let syncEvent = createSyncEvent(
      toBigInt('1000000000000000000000'),
      ethToWei(100)
    );
    handleSync(syncEvent);

    // Second sync with different reserves
    mockChainlinkPrice(2500);
    syncEvent = createSyncEvent(
      toBigInt('2000000000000000000000'),
      ethToWei(200)
    );
    handleSync(syncEvent);

    const poolReserves = PoolReserves.load(POOL_ADDRESS);
    assert.assertNotNull(poolReserves);
    assert.bigIntEquals(poolReserves!.reserve1, ethToWei(200));

    const metrics = LPTokenMetrics.load('global');
    // Pool liquidity USD: 2 * 200 ETH * $2500 = $1,000,000
    assert.stringEquals(metrics!.poolLiquidityUsd.toString(), '1000000');
  });
});

describe('handleLPTransfer', () => {
  afterEach(() => {
    clearStore();
  });

  test('handles mint (from zero address) correctly', () => {
    const mintAmount = BigInt.fromI32(5000);
    const mintEvent = createMintEvent(TREASURY_ADDRESS, mintAmount);

    handleLPTransfer(mintEvent);

    const metrics = LPTokenMetrics.load('global');
    assert.assertNotNull(metrics);
    assert.bigIntEquals(metrics!.totalSupply, mintAmount);
    assert.bigIntEquals(metrics!.totalMinted, mintAmount);
    assert.bigIntEquals(metrics!.treasurySupply, mintAmount);
  });

  test('handles burn (to zero address) correctly', () => {
    // First mint
    const mintAmount = BigInt.fromI32(5000);
    const mintEvent = createMintEvent(TREASURY_ADDRESS, mintAmount);
    handleLPTransfer(mintEvent);

    // Then burn half
    const burnAmount = BigInt.fromI32(2500);
    const burnEvent = createTransferEvent(
      TREASURY_ADDRESS,
      ZERO_ADDRESS,
      burnAmount
    );
    handleLPTransfer(burnEvent);

    const metrics = LPTokenMetrics.load('global');
    assert.assertNotNull(metrics);
    assert.bigIntEquals(metrics!.totalSupply, BigInt.fromI32(2500));
    assert.bigIntEquals(metrics!.totalBurned, burnAmount);
  });

  test('tracks treasury balance correctly', () => {
    // Mint to treasury
    const mintAmount = BigInt.fromI32(10000);
    const mintEvent = createMintEvent(TREASURY_ADDRESS, mintAmount);
    handleLPTransfer(mintEvent);

    // Transfer some out of treasury
    const transferAmount = BigInt.fromI32(3000);
    const otherAddress = Address.fromString(
      '0x1234567890123456789012345678901234567890'
    );
    const transferEvent = createTransferEvent(
      TREASURY_ADDRESS,
      otherAddress,
      transferAmount
    );
    handleLPTransfer(transferEvent);

    const metrics = LPTokenMetrics.load('global');
    assert.assertNotNull(metrics);
    // Treasury should have 10000 - 3000 = 7000
    assert.bigIntEquals(metrics!.treasurySupply, BigInt.fromI32(7000));
  });

  test('calculates treasury percentage correctly', () => {
    // Mint to treasury
    const treasuryMint = BigInt.fromI32(3000);
    const mintToTreasury = createMintEvent(TREASURY_ADDRESS, treasuryMint);
    handleLPTransfer(mintToTreasury);

    // Mint to another address
    const otherAddress = Address.fromString(
      '0x1234567890123456789012345678901234567890'
    );
    const otherMint = BigInt.fromI32(7000);
    const mintToOther = createMintEvent(otherAddress, otherMint);
    handleLPTransfer(mintToOther);

    const metrics = LPTokenMetrics.load('global');
    assert.assertNotNull(metrics);
    // Treasury owns 3000/10000 = 30% = 3000 basis points
    assert.bigIntEquals(metrics!.treasuryPercentage, BigInt.fromI32(3000));
  });
});

describe('Integration: Transfer + Sync', () => {
  beforeEach(() => {
    mockChainlinkPrice(2000);
  });

  afterEach(() => {
    clearStore();
  });

  test('POL USD reflects treasury ownership after transfers and sync', () => {
    // Setup: Treasury owns 25% of LP tokens
    // Mint 1000 to treasury
    const treasuryMint = createMintEvent(TREASURY_ADDRESS, BigInt.fromI32(1000));
    handleLPTransfer(treasuryMint);

    // Mint 3000 to other address
    const otherAddress = Address.fromString(
      '0x1234567890123456789012345678901234567890'
    );
    const otherMint = createMintEvent(otherAddress, BigInt.fromI32(3000));
    handleLPTransfer(otherMint);

    // Sync with 100 ETH reserves at $2000
    const syncEvent = createSyncEvent(
      toBigInt('500000000000000000000'),
      ethToWei(100)
    );
    handleSync(syncEvent);

    const metrics = LPTokenMetrics.load('global');
    assert.assertNotNull(metrics);

    // Pool liquidity: 2 * 100 ETH * $2000 = $400,000
    assert.stringEquals(metrics!.poolLiquidityUsd.toString(), '400000');

    // POL: $400,000 * 25% = $100,000
    assert.stringEquals(metrics!.protocolOwnedLiquidityUsd.toString(), '100000');

    // Treasury percentage: 25% = 2500 basis points
    assert.bigIntEquals(metrics!.treasuryPercentage, BigInt.fromI32(2500));
  });
});
