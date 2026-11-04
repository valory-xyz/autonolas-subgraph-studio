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
// Basius is the babydegen agent on Base. It trades on Aerodrome (a Velodrome
// fork: Slipstream CL + v2 stable/volatile pools) and, since optimus v0.13.10,
// on Aero (the merged protocol; see the Aero section below). The handler files
// keep their `velo*` names; only the addresses + the consumer-facing `protocol`
// strings differ. See CLAUDE.md for the velo->aerodrome mapping.

// ---- Tokens tracked for portfolio valuation (Base mainnet) ------------------
export const USDC_NATIVE = Address.fromString("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") // Native USDC on Base (primary funding/valuation asset)
export const WETH = Address.fromString("0x4200000000000000000000000000000000000006") // WETH on Base
export const AERO = Address.fromString("0x940181a94A35A4569E4529A3CDfB74e38FD98631") // AERO (Aerodrome reward token) on Base
export const AERO_PROTOCOL_AERO = Address.fromString("0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee") // AERO of Aero (the merged protocol) — Aero gauge reward token

// Whitelisted stablecoins (Base) — priced via $1 fallback until pools confirmed
export const BOLD = Address.fromString("0x03569Cc076654F82679C4BA2124D64774781b01d") // BOLD
export const MSUSD = Address.fromString("0x526728DBc96689597F85ae4cd716d4f7fCCBAE9d") // msUSD
export const FRXUSD = Address.fromString("0xe5020A6D073a794B6e7F05678707dE47986Fb0B6") // frxUSD
export const EUSD = Address.fromString("0xCfA3Ef56d303AE4fAabA0592388F19d7C3399FB4") // eUSD
export const AXLUSDC = Address.fromString("0xEB466342C4d449BC9f53A865D5Cb90586f405215") // axlUSDC

// Chainlink-priced stablecoins — their own feed, never $1; only USDT has a pool fallback (tokenConfig.ts)
export const USDT = Address.fromString("0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2") // USDT
export const DAI = Address.fromString("0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb") // DAI
export const USDE = Address.fromString("0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34") // USDe
export const USDS = Address.fromString("0x820C137fa70C8691f0e44Dc420a5e53c168921Dc") // USDS

// ---- Chainlink price feeds (Base mainnet) -----------------------------------
// Base DOES have Chainlink feeds (unlike the Mode port), so keep Chainlink primary.
// Both verified on-chain (live, 8 decimals, "ETH / USD" / "USDC / USD").
export const ETH_USD_FEED = Address.fromString("0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70")
export const USDC_USD_FEED = Address.fromString("0x7e860098F58bBFC8648a4311b374B1D669a2bc6B")
// Verified on-chain: live, 8 decimals, "USDT / USD" / "DAI / USD" / "USDe / USD" / "USDS / USD"
export const USDT_USD_FEED = Address.fromString("0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9")
export const DAI_USD_FEED = Address.fromString("0x591e79239a7d679378eC8c847e5038150364C78F")
export const USDE_USD_FEED = Address.fromString("0x790181e93e9F4Eedb5b864860C12e4d2CffFe73B")
export const USDS_USD_FEED = Address.fromString("0x2330aaE3bca5F05169d5f4597964D44522F62930")

// ---- Aerodrome (Velodrome-fork) protocol addresses (Base mainnet) -----------
// CL = Slipstream; "VELO_*" names retained for code-compat with the velo* handlers.
export const VELO_NFT_MANAGER = Address.fromString("0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53") // Aerodrome Slipstream NFPM (CL positions)
export const VELO_MANAGER = Address.fromString("0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53")     // alias of the Slipstream NFPM
export const VELO_FACTORY = Address.fromString("0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef")     // Aerodrome Slipstream (CL) factory
export const VELO_V2_FACTORY = Address.fromString("0x420DD381b31aEf6683db6B902084cB0FFECe40Da")  // Aerodrome v2 PoolFactory (Divya-confirmed)
export const VELO_V2_SUGAR = Address.fromString("0x69dD9db6d8f8E7d83887A704f447b1a584b599A1")     // Aerodrome LpSugar v3 (pool discovery / bootstrap)
export const VELO_VOTER = Address.fromString("0x16613524e02ad97eDfeF371bC883F2F5d6C480A5")        // Aerodrome Voter — pool->gauge lookup (gauges(pool)); verified on-chain

// ---- Aero (merged Velodrome/Aerodrome, live 2026-10-22) — Base mainnet ------
// Same addresses as on Optimism except the CL factory, read from AERO_NFT_MANAGER.factory().
export const AERO_NFT_MANAGER = Address.fromString("0x4857DB576eE0e45F10525eC59527BfD10beeC60b")
export const AERO_CL_FACTORY = Address.fromString("0x9CB220581b91b0C83223012FE69688b92aD07a76")
export const AERO_V2_STABLE_FACTORY = Address.fromString("0x78589E876edcEbdce72ee3436ab3c9AD3a7cEF2D")
export const AERO_V2_VOLATILE_FACTORY = Address.fromString("0x8E6a9FCd1d638CC760Ffba397605Fe3355dE76D2")
export const AERO_GAUGE_MANAGER = Address.fromString("0xbF234b32c5e58868243A4a14831626f3EdE7b183")        // GaugeCreated → Aero v2 pool->gauge map

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
export const PROTOCOL_AERO_CL = "aero-cl"
export const PROTOCOL_AERO_V2 = "aero-v2"

// Gauge reward token of a Velodrome-family venue: Aero's gauges pay Aero's AERO, the legacy Aerodrome ones legacy AERO.
export function rewardTokenFor(protocol: string): Address {
  return protocol == PROTOCOL_AERO_CL || protocol == PROTOCOL_AERO_V2 ? AERO_PROTOCOL_AERO : AERO
}

// Excluded service IDs — none currently; kept for parity with the optimism filter.
export const EXCLUDED_SERVICE_IDS: BigInt[] = []

// Whitelisted tokens array (for uninvested-balance valuation / iteration)
export const WHITELISTED_TOKENS: string[] = [
  USDC_NATIVE.toHexString(),
  WETH.toHexString(),
  AERO.toHexString(),
  BOLD.toHexString(),
  MSUSD.toHexString(),
  FRXUSD.toHexString(),
  EUSD.toHexString(),
  AXLUSDC.toHexString(),
  AERO_PROTOCOL_AERO.toHexString(),
  USDT.toHexString(),
  DAI.toHexString(),
  USDE.toHexString(),
  USDS.toHexString()
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
