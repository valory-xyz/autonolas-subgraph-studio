import { Address, BigInt } from "@graphprotocol/graph-ts"
import {
  ETH_USD_FEED,
  USDC_USD_FEED,
  USDC_NATIVE,
  WETH,
  AERO,
  BOLD,
  MSUSD,
  FRXUSD,
  EUSD,
  AXLUSDC,
  NEW_AERO,
  USDT,
  DAI,
  USDE,
  USDS,
  USDT_USD_FEED,
  DAI_USD_FEED,
  USDE_USD_FEED,
  USDS_USD_FEED
} from "./constants"

// Token configurations with Chainlink-first approach (Base mainnet).
//
// NOTE: USDC + WETH price off Base Chainlink feeds. The whitelisted stablecoins
// (BOLD/msUSD/frxUSD/eUSD/axlUSDC) reference the USDC/USD feed so each has a
// non-empty price source and resolves to ~$1 (confirmed fine by Divya). AERO prices
// off the Aerodrome AERO/USDC volatile pool (CL gauge reward token). OLAS is not
// tracked (Basius holds none).
export const TOKENS = new Map<string, TokenConfig>()

export class TokenConfig {
  address: Address
  symbol: string
  decimals: i32
  priceSources: PriceSourceConfig[]

  constructor(
    address: Address,
    symbol: string,
    decimals: i32,
    priceSources: PriceSourceConfig[]
  ) {
    this.address = address
    this.symbol = symbol
    this.decimals = decimals
    this.priceSources = priceSources
  }
}

export class PriceSourceConfig {
  address: Address
  sourceType: string
  priority: i32
  pairToken: Address | null
  fee: i32
  confidence: i32  // Expected confidence level (0-100)

  constructor(
    address: Address,
    sourceType: string,
    priority: i32,
    confidence: i32 = 95,
    pairToken: Address | null = null,
    fee: i32 = 0
  ) {
    this.address = address
    this.sourceType = sourceType
    this.priority = priority
    this.confidence = confidence
    this.pairToken = pairToken
    this.fee = fee
  }
}

// Chainlink feed addresses on Base mainnet
const CHAINLINK_FEEDS = new Map<string, string>()
CHAINLINK_FEEDS.set("ETH_USD", ETH_USD_FEED.toHexString())
CHAINLINK_FEEDS.set("USDC_USD", USDC_USD_FEED.toHexString())
CHAINLINK_FEEDS.set("USDT_USD", USDT_USD_FEED.toHexString())
CHAINLINK_FEEDS.set("DAI_USD", DAI_USD_FEED.toHexString())
CHAINLINK_FEEDS.set("USDE_USD", USDE_USD_FEED.toHexString())
CHAINLINK_FEEDS.set("USDS_USD", USDS_USD_FEED.toHexString())

export function getTokenConfig(address: Address): TokenConfig | null {
  let key = address.toHexString().toLowerCase()
  if (TOKENS.has(key)) {
    let config = TOKENS.get(key)
    return config ? config : null
  }
  return null
}

export function getChainlinkFeed(feedName: string): string | null {
  let feed = CHAINLINK_FEEDS.get(feedName)
  return feed ? feed : null
}

function getChainlinkFeedSafe(feedName: string): string {
  let feed = CHAINLINK_FEEDS.get(feedName)
  if (!feed) {
    // This should never happen if feeds are properly configured
    throw new Error("Chainlink feed not found: " + feedName)
  }
  return feed
}

// Helper: a stablecoin that references the USDC/USD feed (~$1) until a real
// Base pool is wired up. Kept non-empty so PriceUpdate creation never indexes
// into an empty priceSources array.
function usdcReferencedStable(address: Address, symbol: string, decimals: i32): TokenConfig {
  return new TokenConfig(address, symbol, decimals, [
    new PriceSourceConfig(
      Address.fromString(getChainlinkFeedSafe("USDC_USD")),
      "chainlink_reference",
      1,
      90
    )
  ])
}

// A stablecoin priced off its own Chainlink feed, with an Aero USDC pool as the
// priority-2 fallback when the feed gives no valid price (stale, out of range). Neither
// source assumes $1, so a depeg shows. No pool → feed only.
function chainlinkStable(
  address: Address,
  symbol: string,
  decimals: i32,
  feedName: string,
  fallbackPool: Address | null
): TokenConfig {
  const sources = [
    new PriceSourceConfig(Address.fromString(getChainlinkFeedSafe(feedName)), "chainlink", 1, 95)
  ]
  if (fallbackPool !== null) {
    sources.push(new PriceSourceConfig(fallbackPool, "velodrome_slipstream", 2, 80, USDC_NATIVE))
  }
  return new TokenConfig(address, symbol, decimals, sources)
}

// Initialize token configurations
function initializeTokens(): void {

  // USDC - Chainlink USDC/USD (primary funding/valuation asset)
  TOKENS.set(USDC_NATIVE.toHexString().toLowerCase(), new TokenConfig(
    USDC_NATIVE,
    "USDC",
    6,
    [
      new PriceSourceConfig(
        Address.fromString(getChainlinkFeedSafe("USDC_USD")),
        "chainlink",
        1,
        99
      )
    ]
  ))

  // WETH - Chainlink ETH/USD
  TOKENS.set(WETH.toHexString().toLowerCase(), new TokenConfig(
    WETH,
    "WETH",
    18,
    [
      new PriceSourceConfig(
        Address.fromString(getChainlinkFeedSafe("ETH_USD")),
        "chainlink",
        1,
        99
      )
    ]
  ))

  // Whitelisted stablecoins — confirmed (Divya): $1 via the USDC feed is fine; Basius
  // holds no meaningful balances of these, so the fidelity loss is negligible.
  TOKENS.set(BOLD.toHexString().toLowerCase(), usdcReferencedStable(BOLD, "BOLD", 18))
  TOKENS.set(MSUSD.toHexString().toLowerCase(), usdcReferencedStable(MSUSD, "msUSD", 18))
  TOKENS.set(FRXUSD.toHexString().toLowerCase(), usdcReferencedStable(FRXUSD, "frxUSD", 18))
  TOKENS.set(EUSD.toHexString().toLowerCase(), usdcReferencedStable(EUSD, "eUSD", 18))
  TOKENS.set(AXLUSDC.toHexString().toLowerCase(), usdcReferencedStable(AXLUSDC, "axlUSDC", 6))

  // AERO — Aerodrome reward token (CL gauge rewards). Priced off the Aerodrome v2
  // AERO/USDC *volatile* pool (AERO is not a stablecoin, so the volatile pool, not the
  // stable one). Mirrors how babydegen-optimism prices VELO via velodrome_v2.
  // OLAS is intentionally not tracked here (Basius holds none; not a trading asset).
  TOKENS.set(AERO.toHexString().toLowerCase(), new TokenConfig(
    AERO,
    "AERO",
    18,
    [
      new PriceSourceConfig(
        Address.fromString("0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d"), // Aerodrome AERO/USDC volatile
        "velodrome_v2",
        1,
        85,
        USDC_NATIVE // pair token
      )
    ]
  ))

  // AERO of Aero (the merged protocol) — Aero CL/v2 gauge reward token. Priced off the Aero v2
  // AERO/USDC volatile pool, the deepest AERO/USDC pool on Base when this was added.
  TOKENS.set(NEW_AERO.toHexString().toLowerCase(), new TokenConfig(
    NEW_AERO,
    "AERO",
    18,
    [
      new PriceSourceConfig(
        Address.fromString("0xF634058dC94e6BF8e828E27621320C423bC8B18E"), // Aero v2 AERO/USDC volatile
        "velodrome_v2",
        1,
        85,
        USDC_NATIVE // pair token
      )
    ]
  ))

  // optimus#412 stablecoins. USDT falls back to the Aero CL tickSpacing-1 USDC/USDT pool.
  // DAI, USDe and USDS are feed-only: the CL adapter's decimal adjustment is inverted for
  // 18-vs-6-decimal pairs, so a pool fallback would price them at ~1e-24.
  TOKENS.set(USDT.toHexString().toLowerCase(), chainlinkStable(USDT, "USDT", 6, "USDT_USD",
    Address.fromString("0xD448990883e3Bf9cDD8ebCA368A3ECF9D629aAf7"))) // Aero USDC/USDT CL
  TOKENS.set(DAI.toHexString().toLowerCase(), chainlinkStable(DAI, "DAI", 18, "DAI_USD", null))
  TOKENS.set(USDE.toHexString().toLowerCase(), chainlinkStable(USDE, "USDe", 18, "USDE_USD", null))
  TOKENS.set(USDS.toHexString().toLowerCase(), chainlinkStable(USDS, "USDS", 18, "USDS_USD", null))
}

// Call initialization
initializeTokens()
