import { Address, BigInt } from "@graphprotocol/graph-ts"
import { ETH_USD_FEED, USDC_USD_FEED, USDT_USD_FEED, DAI_USD_FEED, USDC_NATIVE, WETH, DAI, USDT, USDC_BRIDGED, USDT0, OUSDT, USDGLO } from "./constants"

// Token configurations with Chainlink-first approach
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

// Chainlink feed addresses on Optimism mainnet
const CHAINLINK_FEEDS = new Map<string, string>()
CHAINLINK_FEEDS.set("ETH_USD", ETH_USD_FEED.toHexString())
CHAINLINK_FEEDS.set("USDC_USD", USDC_USD_FEED.toHexString())
CHAINLINK_FEEDS.set("USDT_USD", USDT_USD_FEED.toHexString())
CHAINLINK_FEEDS.set("DAI_USD", DAI_USD_FEED.toHexString())

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

// Initialize token configurations
function initializeTokens(): void {
  
  // USDC - Simplified: Chainlink only as it's consistently $1
  TOKENS.set(USDC_NATIVE.toHexString().toLowerCase(), new TokenConfig(
    USDC_NATIVE,
    "USDC",
    6,
    [
      // Priority 1: Chainlink USDC/USD (highest confidence)
      new PriceSourceConfig(
        Address.fromString(getChainlinkFeedSafe("USDC_USD")),
        "chainlink",
        1,
        99
      )
      // Removed secondary sources - stablecoin close to $1, don't need to track pools closely
    ]
  ))

  // WETH - Chainlink only as per test script
  TOKENS.set(WETH.toHexString().toLowerCase(), new TokenConfig(
    WETH,
    "WETH",
    18,
    [
      // Priority 1: Chainlink ETH/USD
      new PriceSourceConfig(
        Address.fromString(getChainlinkFeedSafe("ETH_USD")),
        "chainlink",
        1,
        99
      )
    ]
  ))

  // DAI - Simplified: Chainlink only as it's consistently close to $1
  TOKENS.set("0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", new TokenConfig(
    Address.fromString("0xda10009cbd5d07dd0cecc66161fc93d7c9000da1"),
    "DAI",
    18,
    [
      // Priority 1: Chainlink DAI/USD
      new PriceSourceConfig(
        Address.fromString(getChainlinkFeedSafe("DAI_USD")),
        "chainlink",
        1,
        99
      )
      // Removed secondary sources - stablecoin close to $1, don't need to track pools closely
    ]
  ))

  // USDT - Simplified: Chainlink only as it's consistently close to $1
  TOKENS.set("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", new TokenConfig(
    Address.fromString("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58"),
    "USDT",
    6,
    [
      // Priority 1: Chainlink USDT/USD
      new PriceSourceConfig(
        Address.fromString(getChainlinkFeedSafe("USDT_USD")),
        "chainlink",
        1,
        99
      )
      // Removed secondary sources - stablecoin close to $1, don't need to track pools closely
    ]
  ))

  // USDC.e - Simplified: Use USDC Chainlink reference as it's consistently close to $1
  TOKENS.set("0x7f5c764cbc14f9669b88837ca1490cca17c31607", new TokenConfig(
    Address.fromString("0x7f5c764cbc14f9669b88837ca1490cca17c31607"),
    "USDC.e",
    6,
    [
      // Priority 1: Reference USDC Chainlink (should be ~1:1)
      new PriceSourceConfig(
        Address.fromString(getChainlinkFeedSafe("USDC_USD")),
        "chainlink_reference",
        1,
        95 // Increased confidence since it's a stablecoin
      )
      // Removed secondary sources - stablecoin close to $1, don't need to track pools closely
    ]
  ))

  // DOLA - Track using DEX pools as price can vary from $1
  TOKENS.set("0x8ae125e8653821e851f12a49f7765db9a9ce7384", new TokenConfig(
    Address.fromString("0x8ae125e8653821e851f12a49f7765db9a9ce7384"),
    "DOLA",
    18,
    [
      // Only use DOLA/USDC pool - no MAI pair available
      new PriceSourceConfig(
        Address.fromString("0x6c5019d345ec05004a7e7b0623a91a0d9b8d590d"),
        "velodrome_v2",
        1,
        80, // Keeping original confidence
        Address.fromString("0x0b2c639c533813f4aa9d7837caf62653d097ff85") // USDC
      )
    ]
  ))

  // BOLD - Maintain both sources as we should monitor BOLD/LUSD
  TOKENS.set("0x087c440f251ff6cfe62b86dde1be558b95b4bb9b", new TokenConfig(
    Address.fromString("0x087c440f251ff6cfe62b86dde1be558b95b4bb9b"),
    "BOLD",
    18,
    [
      // Priority 1: Velodrome BOLD/USDC (highest TVL)
      new PriceSourceConfig(
        Address.fromString("0xf5ce76b51a4d7f0242bb02b830a73abfa9792157"),
        "velodrome_v2",
        1,
        85, // Original confidence
        Address.fromString("0x0b2c639c533813f4aa9d7837caf62653d097ff85") // USDC
      ),
      // Priority 2: Velodrome BOLD/LUSD
      new PriceSourceConfig(
        Address.fromString("0xfe09d5156c4d4ac3b57b192608a8423401bac186"),
        "velodrome_v2",
        2,
        80, // Original confidence
        Address.fromString("0xc40f949f8a4e094d1b49a23ea9241d289b7b2819") // LUSD
      )
    ]
  ))

  // LUSD - Use Velodrome V2 for monitoring as it's near $1 but should be tracked
  TOKENS.set("0xc40f949f8a4e094d1b49a23ea9241d289b7b2819", new TokenConfig(
    Address.fromString("0xc40f949f8a4e094d1b49a23ea9241d289b7b2819"),
    "LUSD",
    18,
    [
      // Priority 1: Velodrome V2 USDC/LUSD (active pool)
      new PriceSourceConfig(
        Address.fromString("0x4f3da11c5cadf644ae023dbad01008a934c993e2"),
        "velodrome_v2",
        1,
        85, // Original confidence
        Address.fromString("0x0b2c639c533813f4aa9d7837caf62653d097ff85") // USDC
      )
    ]
  ))

  // FRAX - Updated to use new Velodrome V2 pool as per test script
  TOKENS.set("0x2e3d870790dc77a83dd1d18184acc7439a53f475", new TokenConfig(
    Address.fromString("0x2e3d870790dc77a83dd1d18184acc7439a53f475"),
    "FRAX",
    18,
    [
      // Using new Velodrome V2 FRAX/USDC pool
      new PriceSourceConfig(
        Address.fromString("0x8542DD4744edEa38b8a9306268b08F4D26d38581"), // New Velodrome V2 FRAX/USDC
        "velodrome_v2",
        1,
        80,
        Address.fromString("0x0b2c639c533813f4aa9d7837caf62653d097ff85") // USDC
      )
    ]
  ))

  // sDAI - Velodrome SlipStream only
  TOKENS.set("0x2218a117083f5b482b0bb821d27056ba9c04b1d3", new TokenConfig(
    Address.fromString("0x2218a117083f5b482b0bb821d27056ba9c04b1d3"),
    "sDAI",
    18,
    [
      // Only use Velodrome SlipStream USDC/sDAI pool
      new PriceSourceConfig(
        Address.fromString("0x131525f3fa23d65dc2b1eb8b6483a28c43b06916"),
        "velodrome_slipstream",
        1,
        80,
        Address.fromString("0x0b2c639c533813f4aa9d7837caf62653d097ff85") // USDC
      )
    ]
  ))

  // USDT0 - Use Velodrome Slipstream pool for price discovery
  TOKENS.set("0x01bff41798a0bcf287b996046ca68b395dbc1071", new TokenConfig(
    USDT0,
    "USDT0",
    6,
    [
      // Priority 1: Velodrome Slipstream (V3/CL) pool
      new PriceSourceConfig(
        Address.fromString("0x4da46c6aFe7322B66efEfdA1F702605cBE08E0bD"),
        "velodrome_slipstream",
        1,
        80,
        Address.fromString("0x0b2c639c533813f4aa9d7837caf62653d097ff85") // USDC as pair token
      )
    ]
  ))

  // oUSDT - Use Velodrome Slipstream pool for price discovery
  TOKENS.set("0x1217bfe6c773eec6cc4a38b5dc45b92292b6e189", new TokenConfig(
    OUSDT,
    "oUSDT",
    6,
    [
      // Priority 1: Velodrome Slipstream (V3/CL) pool
      new PriceSourceConfig(
        Address.fromString("0x5483484F876218908cA435F08222751f7F7B2A3B"),
        "velodrome_slipstream",
        1,
        80,
        Address.fromString("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58") // USDT as pair token
      )
    ]
  ))

  // USDGLO - Use Velodrome V2 StableV2 sAMM for price discovery
  TOKENS.set("0x4f604735c1cf31399c6e711d5962b2b3e0225ad3", new TokenConfig(
    USDGLO,
    "USDGLO",
    18,
    [
      // Priority 1: Velodrome V2 StableV2 sAMM pool
      new PriceSourceConfig(
        Address.fromString("0xE25F3642Bd1FCeD37D35D0b38019B2A2F58ca1dc"),
        "velodrome_v2",
        1,
        80,
        Address.fromString("0x0b2c639c533813f4aa9d7837caf62653d097ff85") // USDC as pair token
      )
    ]
  ))

  // Note: These tokens now use pool-based price discovery similar to DOLA
  // Pool addresses provided for accurate price tracking
}

// Call initialization
initializeTokens()
