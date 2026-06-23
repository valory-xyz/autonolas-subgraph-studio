import { BigInt } from "@graphprotocol/graph-ts"

// Maximum uint256 value
export const MAX_UINT256 = BigInt.fromString("115792089237316195423570985008687907853269984665640564039457584007913129639935")
export const ZERO = BigInt.fromI32(0)

const TWO = BigInt.fromI32(2)
const POWERS_OF_2: Array<i32> = [128, 64, 32, 16, 8, 4, 2, 1]

/**
 * Returns the index of the most significant bit of the number,
 * where the least significant bit is at index 0 and the most significant bit is at index 255
 * 
 * @param x the value for which to compute the most significant bit, must be greater than 0
 * @return the index of the most significant bit
 */
export function mostSignificantBit(x: BigInt): i32 {
  // Ensure x is greater than zero
  if (x.le(ZERO)) {
    throw new Error("ZERO")
  }
  
  // Ensure x is less than or equal to MAX_UINT256
  if (x.gt(MAX_UINT256)) {
    throw new Error("MAX")
  }

  let msb: i32 = 0
  for (let i = 0; i < POWERS_OF_2.length; i++) {
    const power = POWERS_OF_2[i]
    const min = TWO.pow(power as u8)
    
    if (x.ge(min)) {
      x = x.rightShift(power)
      msb += power
    }
  }
  
  return msb
}
