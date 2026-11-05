import { assert, describe, test, clearStore, afterEach, createMockedFunction } from "matchstick-as/assembly/index"
import { Address, BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { FundingBalance, TokenBalance, AgentPortfolio } from "../generated/schema"
import { getTokenPriceUSD } from "../src/priceDiscovery"
import { getVelodromePrice, getVelodromeV2Price } from "../src/priceAdapters"
import { calculatePortfolioMetrics, ensureAgentPortfolio } from "../src/helpers"
import { USDC_NATIVE, BOLD, AERO, DAI, USDC_USD_FEED } from "../src/constants"
import { mockUsdcUsd, mockEthUsd, seedService, seedTokenPrice } from "./fixtures"
import { OPERATOR_SAFE, AGENT_INSTANCE, SERVICE_SAFE, BLOCK_NUMBER, BLOCK_TIMESTAMP } from "./test-helpers"
import { createRegisterInstanceEvent } from "./mapping-utils"


function mockUsdcFeed(answer: i64, updatedAt: BigInt = BLOCK_TIMESTAMP): void {
  createMockedFunction(USDC_USD_FEED, "latestRoundData", "latestRoundData():(uint80,int256,uint256,uint256,uint80)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
      ethereum.Value.fromSignedBigInt(BigInt.fromI64(answer)),
      ethereum.Value.fromUnsignedBigInt(updatedAt),
      ethereum.Value.fromUnsignedBigInt(updatedAt),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))
    ])
}

function revertUsdcFeed(): void {
  createMockedFunction(USDC_USD_FEED, "latestRoundData", "latestRoundData():(uint80,int256,uint256,uint256,uint80)")
    .withArgs([])
    .reverts()
}

// An imbalanced stable pool: reserves say $0.755, the pool's own quote for 1 BOLD is $0.994053
const STABLE_POOL = Address.fromString("0x00000000000000000000000000000000000000c0")
const AERO_USDC_POOL = Address.fromString("0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d")

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
    mockUsdcFeed(90000000)
    assert.stringEquals(getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP).toString(), "0.9")
    assert.fieldEquals("Token", USDC_NATIVE.toHexString(), "depegged", "true")
    assert.fieldEquals("Token", USDC_NATIVE.toHexString(), "priceStale", "false")
  })

  test("depegged starts just below $0.98", () => {
    mockUsdcFeed(97999999)
    getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP)
    assert.fieldEquals("Token", USDC_NATIVE.toHexString(), "depegged", "true")
  })

  test("a stablecoin at exactly $0.98 is not depegged", () => {
    mockUsdcFeed(98000000)
    getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP)
    assert.fieldEquals("Token", USDC_NATIVE.toHexString(), "depegged", "false")
  })

  test("the depeg flag clears when the price recovers", () => {
    mockUsdcFeed(90000000)
    getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP)
    mockUsdcFeed(100000000)
    getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP, true)
    assert.fieldEquals("Token", USDC_NATIVE.toHexString(), "depegged", "false")
  })

  test("a stablecoin at $0.99 is not depegged", () => {
    mockUsdcFeed(99000000)
    assert.stringEquals(getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP).toString(), "0.99")
    assert.fieldEquals("Token", USDC_NATIVE.toHexString(), "depegged", "false")
  })

  test("with no valid price the last valid one is kept, marked stale", () => {
    mockUsdcFeed(97000000)
    getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP)
    revertUsdcFeed()
    assert.stringEquals(getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP, true).toString(), "0.97")
    assert.fieldEquals("Token", USDC_NATIVE.toHexString(), "priceStale", "true")
  })

  test("a fresh valid price replaces a stale one", () => {
    mockUsdcFeed(97000000)
    getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP)
    revertUsdcFeed()
    getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP, true)
    mockUsdcFeed(100000000)
    assert.stringEquals(getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP, true).toString(), "1")
    assert.fieldEquals("Token", USDC_NATIVE.toHexString(), "priceStale", "false")
  })

  test("a stablecoin never priced is unpriced, not $1", () => {
    revertUsdcFeed()
    assert.stringEquals(getTokenPriceUSD(USDC_NATIVE, BLOCK_TIMESTAMP).toString(), "0")
  })

  test("a stable pool prices from its quote, not its reserve ratio", () => {
    mockImbalancedStablePool(STABLE_POOL, BOLD, USDC_NATIVE, BigInt.fromString("1000000000000000000"), 994053)
    assert.stringEquals(getVelodromeV2Price(BOLD, STABLE_POOL, USDC_NATIVE, BLOCK_TIMESTAMP).toString(), "0.994053")
  })

  test("a pool's USDC leg is priced from the USDC feed, not $1", () => {
    mockImbalancedStablePool(STABLE_POOL, BOLD, USDC_NATIVE, BigInt.fromString("1000000000000000000"), 994053)
    mockUsdcFeed(90000000)
    assert.stringEquals(getVelodromeV2Price(BOLD, STABLE_POOL, USDC_NATIVE, BLOCK_TIMESTAMP).toString(), "0.8946477")
  })

  test("a pair token with no feed gives no pool price", () => {
    mockImbalancedStablePool(STABLE_POOL, AERO, BOLD, BigInt.fromString("1000000000000000000"), 994053000000000000)
    assert.stringEquals(getVelodromeV2Price(AERO, STABLE_POOL, BOLD, BLOCK_TIMESTAMP).toString(), "0")
  })

  test("a CL pool of 6- and 18-decimal tokens is priced with the decimals the right way round", () => {
    mockUsdcUsd()
    const pool = Address.fromString("0x00000000000000000000000000000000000000c2")
    // USDC token0 (6 dec), DAI token1 (18 dec); sqrtPrice 800,000 → 0.64 DAI per USDC → $1.5625
    createMockedFunction(pool, "slot0", "slot0():(uint160,int24,uint16,uint16,uint16,bool)")
      .withArgs([])
      .returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("63382530011411470074835160268800000")),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromBoolean(true)
      ])
    createMockedFunction(pool, "token0", "token0():(address)").withArgs([]).returns([ethereum.Value.fromAddress(USDC_NATIVE)])
    createMockedFunction(pool, "token1", "token1():(address)").withArgs([]).returns([ethereum.Value.fromAddress(DAI)])
    assert.stringEquals(getVelodromePrice(DAI, pool, USDC_NATIVE, BLOCK_TIMESTAMP).toString(), "1.5625")
  })

  test("a token that is not a stablecoin is never marked depegged", () => {
    mockUsdcUsd()
    // AERO token0, USDC token1: 1,000,000 AERO vs 600,000 USDC → $0.60
    createMockedFunction(AERO_USDC_POOL, "token0", "token0():(address)").withArgs([]).returns([ethereum.Value.fromAddress(AERO)])
    createMockedFunction(AERO_USDC_POOL, "token1", "token1():(address)").withArgs([]).returns([ethereum.Value.fromAddress(USDC_NATIVE)])
    createMockedFunction(AERO_USDC_POOL, "stable", "stable():(bool)").withArgs([]).returns([ethereum.Value.fromBoolean(false)])
    createMockedFunction(AERO_USDC_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)").withArgs([]).returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI64(600000000000)),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
    assert.stringEquals(getTokenPriceUSD(AERO, BLOCK_TIMESTAMP).toString(), "0.6")
    assert.fieldEquals("Token", AERO.toHexString(), "depegged", "false")
  })

  test("BOLD is not given $1 when its reference feed fails", () => {
    revertUsdcFeed()
    assert.stringEquals(getTokenPriceUSD(BOLD, BLOCK_TIMESTAMP).toString(), "0")
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

    let event = createRegisterInstanceEvent(OPERATOR_SAFE, BigInt.fromI32(1), AGENT_INSTANCE, BigInt.fromI32(115))
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

describe("pair-leg pricing", () => {
  afterEach(() => {
    clearStore()
  })

  test("a stable pool whose getAmountOut reverts gives no price", () => {
    mockImbalancedStablePool(STABLE_POOL, BOLD, USDC_NATIVE, BigInt.fromString("1000000000000000000"), 994053)
    createMockedFunction(STABLE_POOL, "getAmountOut", "getAmountOut(uint256,address):(uint256)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000")), ethereum.Value.fromAddress(BOLD)])
      .reverts()
    assert.stringEquals(getVelodromeV2Price(BOLD, STABLE_POOL, USDC_NATIVE, BLOCK_TIMESTAMP).toString(), "0")
  })

  test("a pair-leg feed is judged stale against the block", () => {
    mockUsdcUsd()
    // AERO token0, USDC token1: 1,000,000 AERO vs 600,000 USDC → $0.60
    createMockedFunction(AERO_USDC_POOL, "token0", "token0():(address)").withArgs([]).returns([ethereum.Value.fromAddress(AERO)])
    createMockedFunction(AERO_USDC_POOL, "token1", "token1():(address)").withArgs([]).returns([ethereum.Value.fromAddress(USDC_NATIVE)])
    createMockedFunction(AERO_USDC_POOL, "stable", "stable():(bool)").withArgs([]).returns([ethereum.Value.fromBoolean(false)])
    // The USDC feed is 90001s older than the block; the pool's own last-trade time (0) is no clock
    createMockedFunction(AERO_USDC_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)").withArgs([]).returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI64(600000000000)),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
    mockUsdcFeed(100000000, BLOCK_TIMESTAMP.minus(BigInt.fromI32(90001)))
    assert.stringEquals(getTokenPriceUSD(AERO, BLOCK_TIMESTAMP).toString(), "0")
  })

  test("a stablecoin above $1.50 is rejected, whatever its symbol", () => {
    // BOLD is referenced to the USDC/USD feed
    mockUsdcFeed(160000000)
    assert.stringEquals(getTokenPriceUSD(BOLD, BLOCK_TIMESTAMP).toString(), "0")
  })
})
