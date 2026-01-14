import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  afterEach,
} from 'matchstick-as/assembly/index';
import { BigInt, BigDecimal } from '@graphprotocol/graph-ts';
import {
  calculatePoolLiquidityUsd,
  calculateProtocolOwnedLiquidityUsd,
  CHAINLINK_DECIMALS,
  ETH_DECIMALS,
  PRICE_DECIMALS,
} from '../src/utils';
import { ethPriceToChainlink, ethToWei, toBigInt } from './test-utils';

describe('USD Calculation Functions', () => {
  afterEach(() => {
    clearStore();
  });

  describe('calculatePoolLiquidityUsd', () => {
    test('returns zero when ETH price is zero', () => {
      const reserve1 = ethToWei(100); // 100 ETH
      const ethPrice = BigInt.zero();

      const result = calculatePoolLiquidityUsd(reserve1, ethPrice);

      assert.assertTrue(result.equals(BigDecimal.zero()));
    });

    test('calculates correct USD value for pool with 100 ETH at $1800', () => {
      // 100 ETH in wei
      const reserve1 = ethToWei(100);
      // $1800 in Chainlink format (8 decimals)
      const ethPrice = ethPriceToChainlink(1800);

      const result = calculatePoolLiquidityUsd(reserve1, ethPrice);

      // Expected: 2 * 100 ETH * $1800 = $360,000
      // Result should be approximately 360000
      const expected = BigDecimal.fromString('360000');
      assert.assertTrue(result.equals(expected));
    });

    test('calculates correct USD value for pool with 50 ETH at $2000', () => {
      const reserve1 = ethToWei(50);
      const ethPrice = ethPriceToChainlink(2000);

      const result = calculatePoolLiquidityUsd(reserve1, ethPrice);

      // Expected: 2 * 50 ETH * $2000 = $200,000
      const expected = BigDecimal.fromString('200000');
      assert.assertTrue(result.equals(expected));
    });

    test('handles small reserve amounts correctly', () => {
      // 0.5 ETH (500000000000000000 wei)
      const reserve1 = BigInt.fromString('500000000000000000');
      const ethPrice = ethPriceToChainlink(2000);

      const result = calculatePoolLiquidityUsd(reserve1, ethPrice);

      // Expected: 2 * 0.5 ETH * $2000 = $2,000
      const expected = BigDecimal.fromString('2000');
      assert.assertTrue(result.equals(expected));
    });

    test('handles large reserve amounts correctly', () => {
      // 10000 ETH
      const reserve1 = toBigInt('10000000000000000000000');
      const ethPrice = ethPriceToChainlink(3000);

      const result = calculatePoolLiquidityUsd(reserve1, ethPrice);

      // Expected: 2 * 10000 ETH * $3000 = $60,000,000
      const expected = BigDecimal.fromString('60000000');
      assert.assertTrue(result.equals(expected));
    });
  });

  describe('calculateProtocolOwnedLiquidityUsd', () => {
    test('returns zero when totalSupply is zero', () => {
      const poolLiquidityUsd = BigDecimal.fromString('360000');
      const treasurySupply = BigInt.fromI32(1000);
      const totalSupply = BigInt.zero();

      const result = calculateProtocolOwnedLiquidityUsd(
        poolLiquidityUsd,
        treasurySupply,
        totalSupply
      );

      assert.assertTrue(result.equals(BigDecimal.zero()));
    });

    test('calculates correct POL USD for 10% treasury ownership', () => {
      const poolLiquidityUsd = BigDecimal.fromString('100000');
      const treasurySupply = BigInt.fromI32(100); // 10%
      const totalSupply = BigInt.fromI32(1000);

      const result = calculateProtocolOwnedLiquidityUsd(
        poolLiquidityUsd,
        treasurySupply,
        totalSupply
      );

      // Expected: 100000 * (100/1000) = 10000
      const expected = BigDecimal.fromString('10000');
      assert.assertTrue(result.equals(expected));
    });

    test('calculates correct POL USD for 50% treasury ownership', () => {
      const poolLiquidityUsd = BigDecimal.fromString('200000');
      const treasurySupply = BigInt.fromI32(500);
      const totalSupply = BigInt.fromI32(1000);

      const result = calculateProtocolOwnedLiquidityUsd(
        poolLiquidityUsd,
        treasurySupply,
        totalSupply
      );

      // Expected: 200000 * (500/1000) = 100000
      const expected = BigDecimal.fromString('100000');
      assert.assertTrue(result.equals(expected));
    });

    test('calculates correct POL USD for 100% treasury ownership', () => {
      const poolLiquidityUsd = BigDecimal.fromString('500000');
      const treasurySupply = BigInt.fromI32(1000);
      const totalSupply = BigInt.fromI32(1000);

      const result = calculateProtocolOwnedLiquidityUsd(
        poolLiquidityUsd,
        treasurySupply,
        totalSupply
      );

      // Expected: 500000 * (1000/1000) = 500000
      const expected = BigDecimal.fromString('500000');
      assert.assertTrue(result.equals(expected));
    });

    test('returns zero when treasury has no tokens', () => {
      const poolLiquidityUsd = BigDecimal.fromString('100000');
      const treasurySupply = BigInt.zero();
      const totalSupply = BigInt.fromI32(1000);

      const result = calculateProtocolOwnedLiquidityUsd(
        poolLiquidityUsd,
        treasurySupply,
        totalSupply
      );

      assert.assertTrue(result.equals(BigDecimal.zero()));
    });

    test('handles fractional ownership correctly', () => {
      const poolLiquidityUsd = BigDecimal.fromString('1000000');
      const treasurySupply = BigInt.fromI32(333); // 33.3%
      const totalSupply = BigInt.fromI32(1000);

      const result = calculateProtocolOwnedLiquidityUsd(
        poolLiquidityUsd,
        treasurySupply,
        totalSupply
      );

      // Expected: 1000000 * (333/1000) = 333000
      const expected = BigDecimal.fromString('333000');
      assert.assertTrue(result.equals(expected));
    });
  });

  describe('Constants', () => {
    test('CHAINLINK_DECIMALS is 8', () => {
      assert.i32Equals(CHAINLINK_DECIMALS, 8);
    });

    test('ETH_DECIMALS is 18', () => {
      assert.i32Equals(ETH_DECIMALS, 18);
    });

    test('PRICE_DECIMALS is 26 (8 + 18)', () => {
      assert.i32Equals(PRICE_DECIMALS, 26);
    });
  });
});
