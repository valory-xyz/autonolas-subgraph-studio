import { Address, BigInt } from "@graphprotocol/graph-ts"

// =============================================================================
// MATHEMATICAL CONSTANTS
// =============================================================================

// Q96 constant used in concentrated-liquidity (Slipstream / Uniswap V3) math (2^96)
export const Q96 = BigInt.fromString("79228162514264337593543950336")

// =============================================================================
// NETWORK-SPECIFIC CONSTANTS FOR BASE (Aerodrome)
// =============================================================================
//
// Basius is the babydegen agent on Base. It trades exclusively on Aerodrome
// (a Velodrome fork: Slipstream CL + v2 stable/volatile pools). The handler
// files keep their `velo*` names; only the addresses + the consumer-facing
// `protocol` strings differ. See CLAUDE.md for the velo->aerodrome mapping.

// ---- Tokens tracked for portfolio valuation (Base mainnet) ------------------
export const USDC_NATIVE = Address.fromString("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") // Native USDC on Base (primary funding/valuation asset)
export const WETH = Address.fromString("0x4200000000000000000000000000000000000006") // WETH on Base
export const OLAS = Address.fromString("0x54330d28ca3357F294334BDC454a032e7f353416") // OLAS on Base
export const AERO = Address.fromString("0x940181a94A35A4569E4529A3CDfB74e38FD98631") // AERO (Aerodrome reward token) on Base

// Whitelisted stablecoins (Base) — priced via $1 fallback until pools confirmed
export const BOLD = Address.fromString("0x03569Cc076654F82679C4BA2124D64774781b01d") // BOLD
export const MSUSD = Address.fromString("0x526728DBc96689597F85ae4cd716d4f7fCCBAE9d") // msUSD
export const FRXUSD = Address.fromString("0xe5020A6D073a794B6e7F05678707dE47986Fb0B6") // frxUSD
export const EUSD = Address.fromString("0xCfA3Ef56d303AE4fAabA0592388F19d7C3399FB4") // eUSD
export const AXLUSDC = Address.fromString("0xEB466342C4d449BC9f53A865D5Cb90586f405215") // axlUSDC

// ---- Chainlink price feeds (Base mainnet) -----------------------------------
// Base DOES have Chainlink feeds (unlike the Mode port), so keep Chainlink primary.
// Both verified on-chain (live, 8 decimals, "ETH / USD" / "USDC / USD").
export const ETH_USD_FEED = Address.fromString("0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70")
export const USDC_USD_FEED = Address.fromString("0x7e860098F58bBFC8648a4311b374B1D669a2bc6B")

// ---- Aerodrome (Velodrome-fork) protocol addresses (Base mainnet) -----------
// CL = Slipstream; "VELO_*" names retained for code-compat with the velo* handlers.
export const VELO_NFT_MANAGER = Address.fromString("0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53") // Aerodrome Slipstream NFPM (CL positions)
export const VELO_MANAGER = Address.fromString("0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53")     // alias of the Slipstream NFPM
export const VELO_FACTORY = Address.fromString("0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef")     // Aerodrome Slipstream (CL) factory
export const VELO_V2_FACTORY = Address.fromString("0x420DD381b31aEf6683db6B902084cB0FFECe40Da")  // Aerodrome v2 PoolFactory (Divya-confirmed)
export const VELO_V2_SUGAR = Address.fromString("0x69dD9db6d8f8E7d83887A704f447b1a584b599A1")     // Aerodrome LpSugar v3 (pool discovery / bootstrap)

// ---- Olas service configuration (Base) --------------------------------------
// Canonical ServiceRegistryL2 on Base = 0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE (set in subgraph.yaml).
// Basius = canonical agentId 115. We filter RegisterInstance by agentId and track EVERY
// Basius service (currently 607/610/611/612 on Base, each with its own multisig), mirroring
// babydegen-optimism's OPTIMUS_AGENT_ID filter. NB: agentId 115 — NOT service id 115, which
// is an unrelated 2025 service on the generic agent 9.
export const BASIUS_AGENT_ID = BigInt.fromI32(115)

// PROTOCOL NAME CONSTANTS (consumer-facing `ProtocolPosition.protocol` values)
export const PROTOCOL_VELODROME_V2 = "aerodrome-v2"
export const PROTOCOL_VELODROME_V3 = "aerodrome-cl"

// Excluded service IDs — none currently; kept for parity with the optimism filter.
export const EXCLUDED_SERVICE_IDS: BigInt[] = []

// Whitelisted tokens array (for uninvested-balance valuation / iteration)
export const WHITELISTED_TOKENS: string[] = [
  USDC_NATIVE.toHexString(),
  WETH.toHexString(),
  OLAS.toHexString(),
  AERO.toHexString(),
  BOLD.toHexString(),
  MSUSD.toHexString(),
  FRXUSD.toHexString(),
  EUSD.toHexString(),
  AXLUSDC.toHexString()
]

// Stablecoin addresses (for $1 price fallbacks)
export const STABLECOINS: string[] = [
  USDC_NATIVE.toHexString(),
  BOLD.toHexString(),
  MSUSD.toHexString(),
  FRXUSD.toHexString(),
  EUSD.toHexString(),
  AXLUSDC.toHexString()
]

// Critical stablecoins (for emergency fallbacks)
export const CRITICAL_STABLECOINS: string[] = [
  USDC_NATIVE.toHexString(),
  BOLD.toHexString(),
  MSUSD.toHexString(),
  FRXUSD.toHexString(),
  EUSD.toHexString(),
  AXLUSDC.toHexString()
]
