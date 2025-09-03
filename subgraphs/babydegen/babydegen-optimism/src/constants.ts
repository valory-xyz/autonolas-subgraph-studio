import { Address, BigInt } from "@graphprotocol/graph-ts"

// =============================================================================
// MATHEMATICAL CONSTANTS
// =============================================================================

// Q96 constant used in Uniswap V3 math (2^96)
export const Q96 = BigInt.fromString("79228162514264337593543950336")

// =============================================================================
// NETWORK-SPECIFIC CONSTANTS FOR OPTIMISM
// =============================================================================

// Token addresses (Optimism mainnet)
export const USDC_NATIVE = Address.fromString("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85") // Native USDC on Optimism
export const USDC_BRIDGED = Address.fromString("0x7F5c764cBc14f9669B88837ca1490cCa17c31607") // USDC.e (Bridged) on Optimism
export const USDT = Address.fromString("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58") // USDT
export const DAI = Address.fromString("0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1") // DAI
export const LUSD = Address.fromString("0xc40F949F8a4e094D1b49a23ea9241D289B7b2819") // LUSD
export const WETH = Address.fromString("0x4200000000000000000000000000000000000006") // WETH
export const WBTC = Address.fromString("0x68f180fcCe6836688e9084f035309E29Bf0A2095") // WBTC
export const SUSD = Address.fromString("0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9") // sUSD
export const FRAX = Address.fromString("0x2e3d870790dc77a83dd1d18184acc7439a53f475") // FRAX
export const DOLA = Address.fromString("0x8ae125e8653821e851f12a49f7765db9a9ce7384") // DOLA
export const BOLD = Address.fromString("0x087c440f251ff6cfe62b86dde1be558b95b4bb9b") // BOLD
export const SDAI = Address.fromString("0x2218a117083f5b482b0bb821d27056ba9c04b1d3") // sDAI
export const USDT0 = Address.fromString("0x01bff41798a0bcf287b996046ca68b395dbc1071") // USDT0
export const OUSDT = Address.fromString("0x1217bfe6c773eec6cc4a38b5dc45b92292b6e189") // oUSDT
export const USDGLO = Address.fromString("0x4f604735c1cf31399c6e711d5962b2b3e0225ad3") // USDGLO

// Chainlink price feeds (Optimism mainnet)
export const ETH_USD_FEED = Address.fromString("0x13e3Ee699D1909E989722E753853AE30b17e08c5")
export const USDC_USD_FEED = Address.fromString("0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3")
export const USDT_USD_FEED = Address.fromString("0xECef79E109e997bCA29c1c0897ec9d7b03647F5E")
export const DAI_USD_FEED = Address.fromString("0x8dBa75e83DA73cc766A7e5a0ee71F656BAb470d6")

// DeFi protocol addresses
export const VELO_NFT_MANAGER = Address.fromString("0x416b433906b1B72FA758e166e239c43d68dC6F29")
export const VELO_V2_SUGAR = Address.fromString("0xA64db2D254f07977609def75c3A7db3eDc72EE1D")
export const VELO_V2_FACTORY = Address.fromString("0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a")

// Velodrome CL (Concentrated Liquidity) addresses
export const VELO_MANAGER = Address.fromString("0x416b433906b1B72FA758e166e239c43d68dC6F29") // Velodrome CL NFT Position Manager
export const VELO_FACTORY = Address.fromString("0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F") // Velodrome CL Factory (NOT V2 Factory!)

// Uniswap V3 addresses (Optimism mainnet)
export const UNI_V3_MANAGER = Address.fromString("0xC36442b4a4522E871399CD717aBDD847Ab11FE88") // Uniswap V3 NFT Position Manager
export const UNI_V3_FACTORY = Address.fromString("0x1F98431c8aD98523631AE4a59f267346ea31F984") // Uniswap V3 Factory

// OLAS-related addresses
export const OLAS_TOKEN = Address.fromString("0xFC2E6e6BCbd49ccf3A5f029c79984372DcBFE527")
export const STAKING_FACTORY = Address.fromString("0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8")

// Service configuration
export const OPTIMUS_AGENT_ID = BigInt.fromI32(40)

// Excluded service IDs - these are testing agents
export const EXCLUDED_SERVICE_IDS: BigInt[] = [
  BigInt.fromI32(29),
  BigInt.fromI32(37),
  BigInt.fromI32(56),
  BigInt.fromI32(58)
]

// Whitelisted tokens array (for easy iteration)
export const WHITELISTED_TOKENS: string[] = [
  USDC_NATIVE.toHexString(),
  USDC_BRIDGED.toHexString(),  // USDC.e - Added to fix uninvested value calculation
  LUSD.toHexString(),
  WETH.toHexString(),
  USDT.toHexString(),
  WBTC.toHexString(),
  SUSD.toHexString(),
  DAI.toHexString(),
  DOLA.toHexString(),
  USDT0.toHexString(),
  OUSDT.toHexString(),
  USDGLO.toHexString()
]

// Stablecoin addresses (for price fallbacks)
export const STABLECOINS: string[] = [
  USDC_NATIVE.toHexString(),
  USDC_BRIDGED.toHexString(),
  USDT.toHexString(),
  DAI.toHexString(),
  LUSD.toHexString(),
  DOLA.toHexString(),  // DOLA is a stablecoin pegged to USD
  USDT0.toHexString(),
  OUSDT.toHexString(),
  USDGLO.toHexString()
]

// Critical stablecoins (for emergency fallbacks)
export const CRITICAL_STABLECOINS: string[] = [
  USDC_NATIVE.toHexString(),
  USDT.toHexString(),
  DAI.toHexString(),
  LUSD.toHexString(),
  DOLA.toHexString(),  // Add DOLA to critical stablecoins for fallback
  USDT0.toHexString(),
  OUSDT.toHexString(),
  SDAI.toHexString(),
  USDGLO.toHexString()
]
