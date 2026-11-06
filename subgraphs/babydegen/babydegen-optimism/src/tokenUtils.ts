import { Address, BigDecimal, BigInt, log } from "@graphprotocol/graph-ts"
import { getTokenConfig } from "./tokenConfig"

// Centralized function to get token decimals
export function getTokenDecimals(tokenAddress: Address): i32 {
  let config = getTokenConfig(tokenAddress)
  if (config !== null) {
    return config.decimals
  }
  log.warning("TOKEN_UTILS: Unknown token decimals for {}, defaulting to 18", [tokenAddress.toHexString()])
  return 18
}

// Centralized function to get token symbol
export function getTokenSymbol(tokenAddress: Address): string {
  let config = getTokenConfig(tokenAddress)
  if (config !== null) {
    return config.symbol
  }
  const tokenHex = tokenAddress.toHexString().toLowerCase()
  log.warning("TOKEN_UTILS: Unknown token symbol for {}, using address", [tokenHex])
  return tokenHex
}

// A raw token amount in whole tokens, by the token's decimals
export function convertTokenAmount(amount: BigInt, tokenAddress: Address): BigDecimal {
  return amount.toBigDecimal().div(BigDecimal.fromString("1e" + getTokenDecimals(tokenAddress).toString()))
}
