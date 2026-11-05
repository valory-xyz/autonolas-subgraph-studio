import { Address, BigDecimal, BigInt, log } from "@graphprotocol/graph-ts"
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
  SDAI,
  VELO,
  USDT0,
  OUSDT,
  USDGLO,
  BOLD_V2,
  USDS,
  XAERO,
  WBTC,
  SUSD
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
  if (tokenHex == VELO.toHexString().toLowerCase()) return 18         // VELO
  if (tokenHex == USDT0.toHexString().toLowerCase()) return 6         // USDT0
  if (tokenHex == OUSDT.toHexString().toLowerCase()) return 6         // oUSDT
  if (tokenHex == USDGLO.toHexString().toLowerCase()) return 18       // USDGLO
  if (tokenHex == BOLD_V2.toHexString().toLowerCase()) return 18      // BOLD (agent's)
  if (tokenHex == USDS.toHexString().toLowerCase()) return 18         // USDS
  if (tokenHex == XAERO.toHexString().toLowerCase()) return 18        // xAERO
  if (tokenHex == WBTC.toHexString().toLowerCase()) return 8          // WBTC
  if (tokenHex == SUSD.toHexString().toLowerCase()) return 18         // sUSD
  
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
  if (tokenHex == VELO.toHexString().toLowerCase()) return "VELO"
  if (tokenHex == USDT0.toHexString().toLowerCase()) return "USDT0"
  if (tokenHex == OUSDT.toHexString().toLowerCase()) return "oUSDT"
  if (tokenHex == USDGLO.toHexString().toLowerCase()) return "USDGLO"
  if (tokenHex == BOLD_V2.toHexString().toLowerCase()) return "BOLD"
  if (tokenHex == USDS.toHexString().toLowerCase()) return "USDS"
  if (tokenHex == XAERO.toHexString().toLowerCase()) return "xAERO"
  if (tokenHex == WBTC.toHexString().toLowerCase()) return "WBTC"
  if (tokenHex == SUSD.toHexString().toLowerCase()) return "sUSD"
  
  // Return the address as fallback for unknown tokens
  log.warning("TOKEN_UTILS: Unknown token symbol for {}, using address", [tokenHex])
  return tokenHex
}

// A raw token amount in whole tokens, by the token's decimals
export function convertTokenAmount(amount: BigInt, tokenAddress: Address): BigDecimal {
  return amount.toBigDecimal().div(BigDecimal.fromString("1e" + getTokenDecimals(tokenAddress).toString()))
}
