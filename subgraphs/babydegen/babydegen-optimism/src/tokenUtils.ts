import { Address, log } from "@graphprotocol/graph-ts"
import { 
  USDC_NATIVE, 
  USDC_BRIDGED, 
  USDT, 
  DAI, 
  WETH, 
  LUSD,
  FRAX,
  DOLA,
  BOLD,
  SDAI
} from "./constants"

// Centralized function to get token decimals
export function getTokenDecimals(tokenAddress: Address): i32 {
  const tokenHex = tokenAddress.toHexString().toLowerCase()
  
  // Use constants instead of hardcoded addresses
  if (tokenHex == USDC_NATIVE.toHexString().toLowerCase()) return 6   // USDC
  if (tokenHex == USDC_BRIDGED.toHexString().toLowerCase()) return 6  // USDC.e
  if (tokenHex == USDT.toHexString().toLowerCase()) return 6          // USDT
  if (tokenHex == DAI.toHexString().toLowerCase()) return 18          // DAI
  if (tokenHex == WETH.toHexString().toLowerCase()) return 18         // WETH
  if (tokenHex == FRAX.toHexString().toLowerCase()) return 18         // FRAX
  if (tokenHex == LUSD.toHexString().toLowerCase()) return 18         // LUSD
  if (tokenHex == DOLA.toHexString().toLowerCase()) return 18         // DOLA
  if (tokenHex == BOLD.toHexString().toLowerCase()) return 18         // BOLD
  if (tokenHex == SDAI.toHexString().toLowerCase()) return 18         // sDAI
  
  // Default to 18 decimals for unknown tokens
  log.warning("TOKEN_UTILS: Unknown token decimals for {}, defaulting to 18", [tokenHex])
  return 18
}

// Centralized function to get token symbol
export function getTokenSymbol(tokenAddress: Address): string {
  const tokenHex = tokenAddress.toHexString().toLowerCase()
  
  // Use constants instead of hardcoded addresses
  if (tokenHex == USDC_NATIVE.toHexString().toLowerCase()) return "USDC"
  if (tokenHex == USDC_BRIDGED.toHexString().toLowerCase()) return "USDC.e"
  if (tokenHex == USDT.toHexString().toLowerCase()) return "USDT"
  if (tokenHex == DAI.toHexString().toLowerCase()) return "DAI"
  if (tokenHex == WETH.toHexString().toLowerCase()) return "WETH"
  if (tokenHex == FRAX.toHexString().toLowerCase()) return "FRAX"
  if (tokenHex == LUSD.toHexString().toLowerCase()) return "LUSD"
  if (tokenHex == DOLA.toHexString().toLowerCase()) return "DOLA"
  if (tokenHex == BOLD.toHexString().toLowerCase()) return "BOLD"
  if (tokenHex == SDAI.toHexString().toLowerCase()) return "sDAI"
  
  // Return the address as fallback for unknown tokens
  log.warning("TOKEN_UTILS: Unknown token symbol for {}, using address", [tokenHex])
  return tokenHex
}
