import { BigInt, log } from "@graphprotocol/graph-ts"
import { mostSignificantBit } from "./mostSignificantBit"

/** 2^n helpers */
const Q32  = BigInt.fromI32(2).pow(32)
const ZERO = BigInt.fromI32(0)
const ONE  = BigInt.fromI32(1)

/** MaxUint256 = 2^256 - 1 */
const MAX_UINT256 = BigInt.fromString(
  "115792089237316195423570985008687907853269984665640564039457584007913129639935"
)

/** Parse 0x… hex into graph-ts BigInt (decimal) */
function fromHex(hex: string): BigInt {
  let h = hex.startsWith("0x") ? hex.slice(2) : hex
  let acc = BigInt.fromI32(0)
  const sixteen = BigInt.fromI32(16)
  for (let i = 0; i < h.length; i++) {
    acc = acc.times(sixteen)
    const c = h.charCodeAt(i)
    if (c >= 48 && c <= 57) acc = acc.plus(BigInt.fromI32(c - 48))      // 0..9
    else if (c >= 97 && c <= 102) acc = acc.plus(BigInt.fromI32(c - 87)) // a..f
    else if (c >= 65 && c <= 70) acc = acc.plus(BigInt.fromI32(c - 55))  // A..F
    else {
      log.critical("TickMath: invalid hex char '{}' in {}", [
        String.fromCharCode(c),
        hex,
      ])
      return BigInt.fromI32(0)
    }
  }
  return acc
}

/** val * hexConst >> 128, mirroring Uniswap mulShift */
function mulShift(val: BigInt, hexConst: string): BigInt {
  const mul = fromHex(hexConst)
  return val.times(mul).rightShift(128)
}

export class TickMath {
  static MIN_TICK: i32 = -887272
  static MAX_TICK: i32 =  887272

  static MIN_SQRT_RATIO: BigInt = BigInt.fromString("4295128739")
  static MAX_SQRT_RATIO: BigInt = BigInt.fromString("1461446703485210103287273052203988822378723970342")

  /** sqrtPriceX96 = sqrt(1.0001)^tick, Q64.96 */
  static getSqrtRatioAtTick(tick: i32): BigInt {
    if (tick < TickMath.MIN_TICK || tick > TickMath.MAX_TICK) {
      log.warning("TickMath: clamping tick {} to range [{}, {}]", [
        tick.toString(),
        TickMath.MIN_TICK.toString(),
        TickMath.MAX_TICK.toString(),
      ])
      tick = tick < TickMath.MIN_TICK ? TickMath.MIN_TICK : TickMath.MAX_TICK
    }

    const absTick = tick < 0 ? -tick : tick

    // Seed ratio per Uniswap v3-sdk
    let ratio = ((absTick & 0x1) != 0)
      ? fromHex("0xfffcb933bd6fad37aa2d162d1a594001")
      : fromHex("0x100000000000000000000000000000000")

    if ((absTick & 0x2)     != 0) ratio = mulShift(ratio, "0xfff97272373d413259a46990580e213a")
    if ((absTick & 0x4)     != 0) ratio = mulShift(ratio, "0xfff2e50f5f656932ef12357cf3c7fdcc")
    if ((absTick & 0x8)     != 0) ratio = mulShift(ratio, "0xffe5caca7e10e4e61c3624eaa0941cd0")
    if ((absTick & 0x10)    != 0) ratio = mulShift(ratio, "0xffcb9843d60f6159c9db58835c926644")
    if ((absTick & 0x20)    != 0) ratio = mulShift(ratio, "0xff973b41fa98c081472e6896dfb254c0")
    if ((absTick & 0x40)    != 0) ratio = mulShift(ratio, "0xff2ea16466c96a3843ec78b326b52861")
    if ((absTick & 0x80)    != 0) ratio = mulShift(ratio, "0xfe5dee046a99a2a811c461f1969c3053")
    if ((absTick & 0x100)   != 0) ratio = mulShift(ratio, "0xfcbe86c7900a88aedcffc83b479aa3a4")
    if ((absTick & 0x200)   != 0) ratio = mulShift(ratio, "0xf987a7253ac413176f2b074cf7815e54")
    if ((absTick & 0x400)   != 0) ratio = mulShift(ratio, "0xf3392b0822b70005940c7a398e4b70f3")
    if ((absTick & 0x800)   != 0) ratio = mulShift(ratio, "0xe7159475a2c29b7443b29c7fa6e889d9")
    if ((absTick & 0x1000)  != 0) ratio = mulShift(ratio, "0xd097f3bdfd2022b8845ad8f792aa5825")
    if ((absTick & 0x2000)  != 0) ratio = mulShift(ratio, "0xa9f746462d870fdf8a65dc1f90e061e5")
    if ((absTick & 0x4000)  != 0) ratio = mulShift(ratio, "0x70d869a156d2a1b890bb3df62baf32f7")
    if ((absTick & 0x8000)  != 0) ratio = mulShift(ratio, "0x31be135f97d08fd981231505542fcfa6")
    if ((absTick & 0x10000) != 0) ratio = mulShift(ratio, "0x9aa508b5b7a84e1c677de54f3e99bc9")
    if ((absTick & 0x20000) != 0) ratio = mulShift(ratio, "0x5d6af8dedb81196699c329225ee604")
    if ((absTick & 0x40000) != 0) ratio = mulShift(ratio, "0x2216e584f5fa1ea926041bedfe98")
    if ((absTick & 0x80000) != 0) ratio = mulShift(ratio, "0x48a170391f7dc42444e8fa2")

    if (tick > 0) {
      ratio = MAX_UINT256.div(ratio) // invert
    }

    // Round up to Q64.96 like the SDK
    const roundUp = ratio.mod(Q32).gt(ZERO)
    const sqrtPriceX96 = ratio.rightShift(32).plus(roundUp ? ONE : ZERO)
    return sqrtPriceX96
  }

  /** inverse: tick(s) such that getSqrtRatioAtTick(tick) <= sqrtRatioX96 < getSqrtRatioAtTick(tick+1) */
  static getTickAtSqrtRatio(sqrtRatioX96: BigInt): i32 {
    if (sqrtRatioX96.lt(TickMath.MIN_SQRT_RATIO) || sqrtRatioX96.ge(TickMath.MAX_SQRT_RATIO)) {
      log.warning("TickMath: sqrtRatioX96 {} out of range", [sqrtRatioX96.toString()])
      return sqrtRatioX96.lt(TickMath.MIN_SQRT_RATIO) ? TickMath.MIN_TICK : TickMath.MAX_TICK
    }

    const sqrtRatioX128 = sqrtRatioX96.leftShift(32)
    const msb = mostSignificantBit(sqrtRatioX128)

    let r: BigInt
    if (msb >= 128) r = sqrtRatioX128.rightShift(msb - 127)
    else            r = sqrtRatioX128.leftShift(127 - msb)

    // log2 in Q64.64
    let log_2 = BigInt.fromI32(msb - 128).leftShift(64)

    // iterative refinement (14 steps), per SDK
    for (let i = 0; i < 14; i++) {
      r = r.times(r).rightShift(127)
      const f = r.rightShift(128) // 0 or 1
      log_2 = log_2.bitOr(f.leftShift(63 - i))
      // if f == 1 keep r (i.e., r / 2), else keep r as is; implemented as shift by f
      r = r.rightShift(f.toI32())
    }

    // 255738958999603826347141 = floor(2^128 / ln(1.0001))
    const log_sqrt10001 = log_2.times(BigInt.fromString("255738958999603826347141"))

    const tickLow = log_sqrt10001
      .minus(BigInt.fromString("3402992956809132418596140100660247210"))
      .rightShift(128)
      .toI32()

    const tickHigh = log_sqrt10001
      .plus(BigInt.fromString("291339464771989622907027621153398088495"))
      .rightShift(128)
      .toI32()

    if (tickLow == tickHigh) return tickLow
    return TickMath.getSqrtRatioAtTick(tickHigh).le(sqrtRatioX96) ? tickHigh : tickLow
  }
}
