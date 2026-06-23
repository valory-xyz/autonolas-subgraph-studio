import { BigInt } from "@graphprotocol/graph-ts"
import { Q96 } from "../constants"

export class LiquidityAmounts {
  
  static getAmountsForLiquidity(
    sqrtRatioX96: BigInt,
    sqrtRatioAX96: BigInt,
    sqrtRatioBX96: BigInt,
    liquidity: BigInt
  ): AmountResult {
    let amount0: BigInt = BigInt.zero()
    let amount1: BigInt = BigInt.zero()

    if (sqrtRatioAX96.gt(sqrtRatioBX96)) {
      let temp = sqrtRatioAX96
      sqrtRatioAX96 = sqrtRatioBX96
      sqrtRatioBX96 = temp
    }

    if (sqrtRatioX96.le(sqrtRatioAX96)) {
      // Current price is below the range
      amount0 = LiquidityAmounts.getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity)
    } else if (sqrtRatioX96.lt(sqrtRatioBX96)) {
      // Current price is within the range
      amount0 = LiquidityAmounts.getAmount0ForLiquidity(sqrtRatioX96, sqrtRatioBX96, liquidity)
      amount1 = LiquidityAmounts.getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioX96, liquidity)
    } else {
      // Current price is above the range
      amount1 = LiquidityAmounts.getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity)
    }

    return new AmountResult(amount0, amount1)
  }

  static getAmount0ForLiquidity(
    sqrtRatioAX96: BigInt,
    sqrtRatioBX96: BigInt,
    liquidity: BigInt
  ): BigInt {
    if (sqrtRatioAX96.gt(sqrtRatioBX96)) {
      let temp = sqrtRatioAX96
      sqrtRatioAX96 = sqrtRatioBX96
      sqrtRatioBX96 = temp
    }

    // amount0 = liquidity * (sqrtRatioBX96 - sqrtRatioAX96) / (sqrtRatioAX96 * sqrtRatioBX96 / 2^96)
    // Simplified calculation to avoid overflow
    let numerator = liquidity.times(sqrtRatioBX96.minus(sqrtRatioAX96))
    let denominator = sqrtRatioAX96.times(sqrtRatioBX96).div(Q96)
    
    if (denominator.isZero()) {
      return BigInt.zero()
    }
    
    return numerator.div(denominator)
  }

  static getAmount1ForLiquidity(
    sqrtRatioAX96: BigInt,
    sqrtRatioBX96: BigInt,
    liquidity: BigInt
  ): BigInt {
    if (sqrtRatioAX96.gt(sqrtRatioBX96)) {
      let temp = sqrtRatioAX96
      sqrtRatioAX96 = sqrtRatioBX96
      sqrtRatioBX96 = temp
    }

    // amount1 = liquidity * (sqrtRatioBX96 - sqrtRatioAX96) / 2^96
    let numerator = liquidity.times(sqrtRatioBX96.minus(sqrtRatioAX96))
    let denominator = Q96
    
    return numerator.div(denominator)
  }
}

export class AmountResult {
  amount0: BigInt
  amount1: BigInt

  constructor(amount0: BigInt, amount1: BigInt) {
    this.amount0 = amount0
    this.amount1 = amount1
  }
}
