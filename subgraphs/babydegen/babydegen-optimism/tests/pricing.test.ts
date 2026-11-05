import { assert, describe, test, clearStore, afterEach, createMockedFunction } from "matchstick-as/assembly/index"
import { Address, BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { FundingBalance, TokenBalance, AgentPortfolio } from "../generated/schema"
import { getTokenPriceUSD } from "../src/priceDiscovery"
import { getVelodromeV2Price } from "../src/priceAdapters"
import { calculatePortfolioMetrics, ensureAgentPortfolio } from "../src/helpers"
import { calculateUninvestedValue } from "../src/tokenBalances"
import { USDT, DOLA, SDAI, BOLD, BOLD_V2, FRAX, LUSD, VELO, WBTC, SUSD, USDS, OUSDT, USDC_NATIVE, USDC_USD_FEED, USDT_USD_FEED, DAI_USD_FEED, WBTC_USD_FEED, SUSD_USD_FEED } from "../src/constants"
import { processERC20Transfer } from "../src/tokenBalances"
import { mockUsdcUsd, mockEthUsd, seedService, seedTokenPrice, seedAddressType, seededAddressType, newTransfer, newReceipt } from "./fixtures"
import { OPERATOR_SAFE, AGENT_INSTANCE, SERVICE_SAFE, BLOCK_NUMBER, BLOCK_TIMESTAMP } from "./test-helpers"
import { createRegisterInstanceEvent } from "./mapping-utils"

const DOLA_USDC_POOL = Address.fromString("0x6c5019d345ec05004a7e7b0623a91a0d9b8d590d")
const SDAI_USDC_CL_POOL = Address.fromString("0x131525f3fa23d65dc2b1eb8b6483a28c43b06916")
const LUSD_USDC_POOL = Address.fromString("0x4f3da11c5cadf644ae023dbad01008a934c993e2")
const BOLD_LUSD_POOL = Address.fromString("0xfe09d5156c4d4ac3b57b192608a8423401bac186")
const BOLD_USDC_POOL = Address.fromString("0xf5ce76b51a4d7f0242bb02b830a73abfa9792157")
const VELO_USDC_POOL = Address.fromString("0xa0A215dE234276CAc1b844fD58901351a50fec8A")
const OTHER_POOL = Address.fromString("0x00000000000000000000000000000000000000c1")
const ONE_18 = BigInt.fromString("1000000000000000000")

function mockUsdcFeedAt(answer: i64): void {
  mockFeedAt(USDC_USD_FEED, answer)
}

function mockFeedAt(feed: Address, answer: i64, updatedAt: BigInt = BLOCK_TIMESTAMP): void {
  createMockedFunction(feed, "latestRoundData", "latestRoundData():(uint80,int256,uint256,uint256,uint80)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
      ethereum.Value.fromSignedBigInt(BigInt.fromI64(answer)),
      ethereum.Value.fromUnsignedBigInt(updatedAt),
      ethereum.Value.fromUnsignedBigInt(updatedAt),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))
    ])
}

function mockUsdtFeed(answer: i64): void {
  mockFeedAt(USDT_USD_FEED, answer)
}

function revertUsdtFeed(): void {
  createMockedFunction(USDT_USD_FEED, "latestRoundData", "latestRoundData():(uint80,int256,uint256,uint256,uint80)")
    .withArgs([])
    .reverts()
}

// An imbalanced stable pool: reserves say $0.755, the pool's own quote for 1 DOLA is $0.994053
function mockImbalancedStablePool(pool: Address, token: Address, pairToken: Address, oneToken: BigInt, quote: i64): void {
  mockUsdcUsd()
  createMockedFunction(pool, "token0", "token0():(address)").withArgs([]).returns([ethereum.Value.fromAddress(pairToken)])
  createMockedFunction(pool, "token1", "token1():(address)").withArgs([]).returns([ethereum.Value.fromAddress(token)])
  createMockedFunction(pool, "getReserves", "getReserves():(uint256,uint256,uint256)").withArgs([]).returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI64(755000000)),
    ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000000")),
    ethereum.Value.fromUnsignedBigInt(BigInt.zero())
  ])
  createMockedFunction(pool, "stable", "stable():(bool)").withArgs([]).returns([ethereum.Value.fromBoolean(true)])
  createMockedFunction(pool, "getAmountOut", "getAmountOut(uint256,address):(uint256)")
    .withArgs([ethereum.Value.fromUnsignedBigInt(oneToken), ethereum.Value.fromAddress(token)])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI64(quote))])
}

describe("stablecoin pricing", () => {
  afterEach(() => {
    clearStore()
  })

  test("a price below the old $0.95 floor is kept and marks the stablecoin depegged", () => {
    mockUsdtFeed(90000000)
    assert.stringEquals(getTokenPriceUSD(USDT, BLOCK_TIMESTAMP).toString(), "0.9")
    assert.fieldEquals("Token", USDT.toHexString(), "depegged", "true")
    assert.fieldEquals("Token", USDT.toHexString(), "priceStale", "false")
  })

  test("depegged starts just below $0.98", () => {
    mockUsdtFeed(97999999)
    getTokenPriceUSD(USDT, BLOCK_TIMESTAMP)
    assert.fieldEquals("Token", USDT.toHexString(), "depegged", "true")
  })

  test("a stablecoin at exactly $0.98 is not depegged", () => {
    mockUsdtFeed(98000000)
    getTokenPriceUSD(USDT, BLOCK_TIMESTAMP)
    assert.fieldEquals("Token", USDT.toHexString(), "depegged", "false")
  })

  test("the depeg flag clears when the price recovers", () => {
    mockUsdtFeed(90000000)
    getTokenPriceUSD(USDT, BLOCK_TIMESTAMP)
    mockUsdtFeed(100000000)
    getTokenPriceUSD(USDT, BLOCK_TIMESTAMP, true)
    assert.fieldEquals("Token", USDT.toHexString(), "depegged", "false")
  })

  test("a stablecoin at $0.99 is not depegged", () => {
    mockUsdtFeed(99000000)
    assert.stringEquals(getTokenPriceUSD(USDT, BLOCK_TIMESTAMP).toString(), "0.99")
    assert.fieldEquals("Token", USDT.toHexString(), "depegged", "false")
  })

  test("with no valid price the last valid one is kept, marked stale", () => {
    mockUsdtFeed(97000000)
    getTokenPriceUSD(USDT, BLOCK_TIMESTAMP)
    revertUsdtFeed()
    assert.stringEquals(getTokenPriceUSD(USDT, BLOCK_TIMESTAMP, true).toString(), "0.97")
    assert.fieldEquals("Token", USDT.toHexString(), "priceStale", "true")
  })

  test("a fresh valid price replaces a stale one", () => {
    mockUsdtFeed(97000000)
    getTokenPriceUSD(USDT, BLOCK_TIMESTAMP)
    revertUsdtFeed()
    getTokenPriceUSD(USDT, BLOCK_TIMESTAMP, true)
    mockUsdtFeed(100000000)
    assert.stringEquals(getTokenPriceUSD(USDT, BLOCK_TIMESTAMP, true).toString(), "1")
    assert.fieldEquals("Token", USDT.toHexString(), "priceStale", "false")
  })

  test("a stablecoin never priced is unpriced, not $1", () => {
    revertUsdtFeed()
    assert.stringEquals(getTokenPriceUSD(USDT, BLOCK_TIMESTAMP).toString(), "0")
  })

  test("a stable pool prices from its quote, not its reserve ratio", () => {
    mockImbalancedStablePool(DOLA_USDC_POOL, DOLA, USDC_NATIVE, BigInt.fromString("1000000000000000000"), 994053)
    assert.stringEquals(getVelodromeV2Price(DOLA, DOLA_USDC_POOL, USDC_NATIVE).toString(), "0.994053")
  })

  test("DOLA is unpriced when its pool cannot be read", () => {
    createMockedFunction(DOLA_USDC_POOL, "token0", "token0():(address)").withArgs([]).reverts()
    createMockedFunction(DOLA_USDC_POOL, "token1", "token1():(address)").withArgs([]).reverts()
    createMockedFunction(DOLA_USDC_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)").withArgs([]).reverts()
    assert.stringEquals(getTokenPriceUSD(DOLA, BLOCK_TIMESTAMP).toString(), "0")
  })

  test("DOLA quoted at $0.40 has no floor and is marked depegged", () => {
    mockImbalancedStablePool(DOLA_USDC_POOL, DOLA, USDC_NATIVE, ONE_18, 400000)
    assert.stringEquals(getTokenPriceUSD(DOLA, BLOCK_TIMESTAMP).toString(), "0.4")
    assert.fieldEquals("Token", DOLA.toHexString(), "depegged", "true")
  })

  test("a token that is not a stablecoin is never marked depegged", () => {
    mockUsdcUsd()
    // USDC token0, VELO token1: 50,000 USDC vs 1,000,000 VELO → $0.05
    createMockedFunction(VELO_USDC_POOL, "token0", "token0():(address)").withArgs([]).returns([ethereum.Value.fromAddress(USDC_NATIVE)])
    createMockedFunction(VELO_USDC_POOL, "token1", "token1():(address)").withArgs([]).returns([ethereum.Value.fromAddress(VELO)])
    createMockedFunction(VELO_USDC_POOL, "stable", "stable():(bool)").withArgs([]).returns([ethereum.Value.fromBoolean(false)])
    createMockedFunction(VELO_USDC_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)").withArgs([]).returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI64(50000000000)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
    assert.stringEquals(getTokenPriceUSD(VELO, BLOCK_TIMESTAMP).toString(), "0.05")
    assert.fieldEquals("Token", VELO.toHexString(), "depegged", "false")
  })
})

describe("pool pair legs", () => {
  afterEach(() => {
    clearStore()
  })

  test("a pool's USDC leg is priced from the USDC feed, not $1", () => {
    mockImbalancedStablePool(DOLA_USDC_POOL, DOLA, USDC_NATIVE, ONE_18, 994053)
    mockUsdcFeedAt(90000000)
    assert.stringEquals(getVelodromeV2Price(DOLA, DOLA_USDC_POOL, USDC_NATIVE).toString(), "0.8946477")
  })

  test("LUSD as a pair leg is priced from its own USDC pool", () => {
    mockImbalancedStablePool(LUSD_USDC_POOL, LUSD, USDC_NATIVE, ONE_18, 900000)
    mockImbalancedStablePool(BOLD_LUSD_POOL, BOLD, LUSD, ONE_18, 1000000000000000000)
    assert.stringEquals(getVelodromeV2Price(BOLD, BOLD_LUSD_POOL, LUSD).toString(), "0.9")
  })

  test("a priority-2 pool is not averaged in while the priority-1 pool prices", () => {
    // BOLD/USDC (priority 1) at $1; BOLD/LUSD (priority 2) at $0.90 because LUSD trades at $0.90
    mockImbalancedStablePool(BOLD_USDC_POOL, BOLD, USDC_NATIVE, ONE_18, 1000000)
    mockImbalancedStablePool(LUSD_USDC_POOL, LUSD, USDC_NATIVE, ONE_18, 900000)
    mockImbalancedStablePool(BOLD_LUSD_POOL, BOLD, LUSD, ONE_18, 1000000000000000000)
    assert.stringEquals(getTokenPriceUSD(BOLD, BLOCK_TIMESTAMP).toString(), "1")
    assert.fieldEquals("Token", BOLD.toHexString(), "depegged", "false")
  })

  test("the priority-2 pool prices when the priority-1 pool gives no price", () => {
    createMockedFunction(BOLD_USDC_POOL, "token0", "token0():(address)").withArgs([]).reverts()
    createMockedFunction(BOLD_USDC_POOL, "token1", "token1():(address)").withArgs([]).reverts()
    createMockedFunction(BOLD_USDC_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)").withArgs([]).reverts()
    mockImbalancedStablePool(LUSD_USDC_POOL, LUSD, USDC_NATIVE, ONE_18, 900000)
    mockImbalancedStablePool(BOLD_LUSD_POOL, BOLD, LUSD, ONE_18, 1000000000000000000)
    assert.stringEquals(getTokenPriceUSD(BOLD, BLOCK_TIMESTAMP).toString(), "0.9")
  })

  test("a pair token with no feed gives no pool price", () => {
    // USDS has no feed and no pool of its own
    mockImbalancedStablePool(OTHER_POOL, DOLA, USDS, ONE_18, 994053000000000000)
    assert.stringEquals(getVelodromeV2Price(DOLA, OTHER_POOL, USDS).toString(), "0")
  })

  test("sDAI is priced through its USDC/sDAI Slipstream pool (6- vs 18-decimal tokens)", () => {
    mockUsdcUsd()
    // USDC token0 (6 dec), sDAI token1 (18 dec); sqrtPrice 800,000 → 0.64 sDAI per USDC → $1.5625
    createMockedFunction(SDAI_USDC_CL_POOL, "slot0", "slot0():(uint160,int24,uint16,uint16,uint16,bool)")
      .withArgs([])
      .returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("63382530011411470074835160268800000")),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromBoolean(true)
      ])
    createMockedFunction(SDAI_USDC_CL_POOL, "token0", "token0():(address)").withArgs([]).returns([ethereum.Value.fromAddress(USDC_NATIVE)])
    createMockedFunction(SDAI_USDC_CL_POOL, "token1", "token1():(address)").withArgs([]).returns([ethereum.Value.fromAddress(SDAI)])
    assert.stringEquals(getTokenPriceUSD(SDAI, BLOCK_TIMESTAMP).toString(), "1.5625")
  })
})

function seedBalance(safe: Address, token: Address, symbol: string, usd: string): void {
  let b = new TokenBalance(Bytes.fromUTF8(safe.toHexString() + "-" + token.toHexString()))
  b.service = safe
  b.token = token
  b.symbol = symbol
  b.decimals = 18
  b.balance = BigDecimal.fromString(usd)
  b.balanceUSD = BigDecimal.fromString(usd)
  b.lastUpdated = BLOCK_TIMESTAMP
  b.lastBlock = BLOCK_NUMBER
  b.save()
}

describe("portfolio value", () => {
  afterEach(() => {
    clearStore()
  })

  test("sDAI, BOLD and FRAX balances count in uninvested value", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    seedBalance(SERVICE_SAFE, SDAI, "sDAI", "50")
    seedBalance(SERVICE_SAFE, BOLD, "BOLD", "20")
    seedBalance(SERVICE_SAFE, FRAX, "FRAX", "5")
    assert.stringEquals(calculateUninvestedValue(SERVICE_SAFE).toString(), "75")
  })

  test("ETH-adjusted metrics equal the unadjusted ones after ETH doubles", () => {
    mockEthUsd() // $2000 now
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    seedTokenPrice(USDC_NATIVE, "USDC", 6, "1")
    seedBalance(SERVICE_SAFE, USDC_NATIVE, "USDC", "110")
    let fb = new FundingBalance(SERVICE_SAFE)
    fb.service = SERVICE_SAFE
    fb.totalInUsd = BigDecimal.fromString("100")
    fb.totalOutUsd = BigDecimal.zero()
    fb.totalWithdrawnUsd = BigDecimal.zero()
    fb.netUsd = BigDecimal.fromString("100")
    fb.firstInTimestamp = BLOCK_TIMESTAMP
    fb.lastChangeTs = BLOCK_TIMESTAMP
    fb.fundingInTxs = []
    fb.fundingOutTxs = []
    fb.save()
    let portfolio = ensureAgentPortfolio(SERVICE_SAFE, BLOCK_TIMESTAMP)
    portfolio.firstFundingEthPrice = BigDecimal.fromString("1000") // ETH was $1000 at first funding
    portfolio.firstTradingTimestamp = BLOCK_TIMESTAMP.minus(BigInt.fromI32(86400 * 10))
    portfolio.save()

    let event = createRegisterInstanceEvent(OPERATOR_SAFE, BigInt.fromI32(1), AGENT_INSTANCE, BigInt.fromI32(40))
    event.block.number = BLOCK_NUMBER
    event.block.timestamp = BLOCK_TIMESTAMP
    calculatePortfolioMetrics(SERVICE_SAFE, event.block)

    let p = AgentPortfolio.load(SERVICE_SAFE)!
    assert.stringEquals(p.unrealisedPnL.toString(), "10")
    assert.stringEquals(p.ethAdjustedUnrealisedPnL.toString(), p.unrealisedPnL.toString())
    assert.stringEquals(p.ethAdjustedProjectedUnrealisedPnL.toString(), p.projectedUnrealisedPnL.toString())
    assert.stringEquals(p.ethAdjustedRoi.toString(), p.roi.toString())
    assert.stringEquals(p.ethAdjustedApr.toString(), p.apr.toString())
  })
})

describe("WBTC and sUSD", () => {
  afterEach(() => {
    clearStore()
  })

  test("WBTC from the user's EOA is funding, valued at its feed", () => {
    mockEthUsd()
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    const user = Address.fromString("0x00000000000000000000000000000000000000e0")
    seedAddressType(user, false, false)
    mockFeedAt(WBTC_USD_FEED, 8000000000000) // $80,000
    processERC20Transfer(newTransfer(WBTC, user, SERVICE_SAFE, BigInt.fromI64(50000000), 1, newReceipt([])), seededAddressType)
    assert.fieldEquals("FundingBalance", SERVICE_SAFE.toHexString(), "totalInUsd", "40000")
  })

  test("WBTC above the generic $100,000 cap is still priced", () => {
    mockFeedAt(WBTC_USD_FEED, 15000000000000) // $150,000
    assert.stringEquals(getTokenPriceUSD(WBTC, BLOCK_TIMESTAMP).toString(), "150000")
  })

  test("sUSD priced below $0.98 by its feed is marked depegged", () => {
    mockFeedAt(SUSD_USD_FEED, 37625494) // its on-chain answer, $0.37625494
    assert.stringEquals(getTokenPriceUSD(SUSD, BLOCK_TIMESTAMP).toString(), "0.37625494")
    assert.fieldEquals("Token", SUSD.toHexString(), "depegged", "true")
  })
})

describe("pair-leg pricing", () => {
  afterEach(() => {
    clearStore()
  })

  test("a pool's USDT leg is priced from the USDT feed", () => {
    // oUSDT (token0) / USDT (token1), both 6 decimals, at par
    const pool = Address.fromString("0x5483484F876218908cA435F08222751f7F7B2A3B")
    createMockedFunction(pool, "slot0", "slot0():(uint160,int24,uint16,uint16,uint16,bool)")
      .withArgs([])
      .returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("79228162514264337593543950336")),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromBoolean(true)
      ])
    createMockedFunction(pool, "token0", "token0():(address)").withArgs([]).returns([ethereum.Value.fromAddress(OUSDT)])
    createMockedFunction(pool, "token1", "token1():(address)").withArgs([]).returns([ethereum.Value.fromAddress(USDT)])
    mockFeedAt(USDT_USD_FEED, 90000000)
    mockFeedAt(DAI_USD_FEED, 80000000)
    assert.stringEquals(getTokenPriceUSD(OUSDT, BLOCK_TIMESTAMP).toString(), "0.9")
  })

  test("a stable pool whose getAmountOut reverts gives no price", () => {
    mockImbalancedStablePool(DOLA_USDC_POOL, DOLA, USDC_NATIVE, ONE_18, 994053)
    createMockedFunction(DOLA_USDC_POOL, "getAmountOut", "getAmountOut(uint256,address):(uint256)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(ONE_18), ethereum.Value.fromAddress(DOLA)])
      .reverts()
    assert.stringEquals(getVelodromeV2Price(DOLA, DOLA_USDC_POOL, USDC_NATIVE).toString(), "0")
  })

  test("a pair-leg feed is judged stale against the block, with the 90000s limit", () => {
    mockImbalancedStablePool(DOLA_USDC_POOL, DOLA, USDC_NATIVE, ONE_18, 994053)
    // 86500s old: past a bare 24h, inside the grace
    mockFeedAt(USDC_USD_FEED, 100000000, BLOCK_TIMESTAMP.minus(BigInt.fromI32(86500)))
    assert.stringEquals(getTokenPriceUSD(DOLA, BLOCK_TIMESTAMP, true).toString(), "0.994053")
    clearStore()
    mockFeedAt(USDC_USD_FEED, 100000000, BLOCK_TIMESTAMP.minus(BigInt.fromI32(90001)))
    assert.stringEquals(getTokenPriceUSD(DOLA, BLOCK_TIMESTAMP, true).toString(), "0")
  })

  test("a stablecoin above $1.50 is rejected, whatever its symbol", () => {
    mockImbalancedStablePool(Address.fromString("0x8828B7792499A7d86E931DF56E3D37C428d12d2b"), BOLD_V2, USDC_NATIVE, ONE_18, 1600000)
    assert.stringEquals(getTokenPriceUSD(BOLD_V2, BLOCK_TIMESTAMP).toString(), "0")
  })
})
