import { Address, log } from "@graphprotocol/graph-ts"
import {
  USDC_NATIVE,
  WETH,
  AERO,
  BOLD,
  MSUSD,
  FRXUSD,
  EUSD,
  AXLUSDC,
  AERO_PROTOCOL_AERO,
  USDT,
  DAI,
  USDE,
  USDS
} from "./constants"

// Centralized function to get token decimals (Base token set)
export function getTokenDecimals(tokenAddress: Address): i32 {
  const tokenHex = tokenAddress.toHexString().toLowerCase()

  if (tokenHex == USDC_NATIVE.toHexString().toLowerCase()) return 6   // USDC
  if (tokenHex == WETH.toHexString().toLowerCase()) return 18         // WETH
  if (tokenHex == AERO.toHexString().toLowerCase()) return 18         // AERO
  if (tokenHex == BOLD.toHexString().toLowerCase()) return 18         // BOLD
  if (tokenHex == MSUSD.toHexString().toLowerCase()) return 18        // msUSD
  if (tokenHex == FRXUSD.toHexString().toLowerCase()) return 18       // frxUSD
  if (tokenHex == EUSD.toHexString().toLowerCase()) return 18         // eUSD
  if (tokenHex == AXLUSDC.toHexString().toLowerCase()) return 6       // axlUSDC
  if (tokenHex == AERO_PROTOCOL_AERO.toHexString().toLowerCase()) return 18     // AERO (Aero)
  if (tokenHex == USDT.toHexString().toLowerCase()) return 6          // USDT
  if (tokenHex == DAI.toHexString().toLowerCase()) return 18          // DAI
  if (tokenHex == USDE.toHexString().toLowerCase()) return 18         // USDe
  if (tokenHex == USDS.toHexString().toLowerCase()) return 18         // USDS

  // Default to 18 decimals for unknown tokens
  log.warning("TOKEN_UTILS: Unknown token decimals for {}, defaulting to 18", [tokenHex])
  return 18
}

// Centralized function to get token symbol (Base token set)
export function getTokenSymbol(tokenAddress: Address): string {
  const tokenHex = tokenAddress.toHexString().toLowerCase()

  if (tokenHex == USDC_NATIVE.toHexString().toLowerCase()) return "USDC"
  if (tokenHex == WETH.toHexString().toLowerCase()) return "WETH"
  if (tokenHex == AERO.toHexString().toLowerCase()) return "AERO"
  if (tokenHex == BOLD.toHexString().toLowerCase()) return "BOLD"
  if (tokenHex == MSUSD.toHexString().toLowerCase()) return "msUSD"
  if (tokenHex == FRXUSD.toHexString().toLowerCase()) return "frxUSD"
  if (tokenHex == EUSD.toHexString().toLowerCase()) return "eUSD"
  if (tokenHex == AXLUSDC.toHexString().toLowerCase()) return "axlUSDC"
  if (tokenHex == AERO_PROTOCOL_AERO.toHexString().toLowerCase()) return "AERO"
  if (tokenHex == USDT.toHexString().toLowerCase()) return "USDT"
  if (tokenHex == DAI.toHexString().toLowerCase()) return "DAI"
  if (tokenHex == USDE.toHexString().toLowerCase()) return "USDe"
  if (tokenHex == USDS.toHexString().toLowerCase()) return "USDS"

  // Return the address as fallback for unknown tokens
  log.warning("TOKEN_UTILS: Unknown token symbol for {}, using address", [tokenHex])
  return tokenHex
}
