import { assert, describe, test, clearStore, afterEach, createMockedFunction } from "matchstick-as/assembly/index"
import { Address, BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { FundingBalance, TokenBalance, AgentPortfolio } from "../generated/schema"
import { getTokenPriceUSD } from "../src/priceDiscovery"
import { getVelodromeV2Price } from "../src/priceAdapters"
import { calculatePortfolioMetrics, ensureAgentPortfolio } from "../src/helpers"
import { calculateUninvestedValue } from "../src/tokenBalances"
import { USDT, DOLA, SDAI, BOLD, FRAX, USDC_NATIVE } from "../src/constants"
import { mockEthUsd, seedService, seedTokenPrice } from "./fixtures"
import { OPERATOR_SAFE, AGENT_INSTANCE, SERVICE_SAFE, BLOCK_NUMBER, BLOCK_TIMESTAMP } from "./test-helpers"
import { createRegisterInstanceEvent } from "./mapping-utils"

const USDT_USD_FEED = Address.fromString("0xECef79E109e997bCA29c1c0897ec9d7b03647F5E")
const DOLA_USDC_POOL = Address.fromString("0x6c5019d345ec05004a7e7b0623a91a0d9b8d590d")

function mockUsdtFeed(answer: i64): void {
  createMockedFunction(USDT_USD_FEED, "latestRoundData", "latestRoundData():(uint80,int256,uint256,uint256,uint80)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
      ethereum.Value.fromSignedBigInt(BigInt.fromI64(answer)),
      ethereum.Value.fromUnsignedBigInt(BLOCK_TIMESTAMP),
      ethereum.Value.fromUnsignedBigInt(BLOCK_TIMESTAMP),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))
    ])
}

function revertUsdtFeed(): void {
  createMockedFunction(USDT_USD_FEED, "latestRoundData", "latestRoundData():(uint80,int256,uint256,uint256,uint80)")
    .withArgs([])
    .reverts()
}

// An imbalanced stable pool: reserves say $0.755, the pool's own quote for 1 DOLA is $0.994053
function mockImbalancedStablePool(pool: Address, token: Address, pairToken: Address, oneToken: BigInt, quote: i64): void {
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

  test("a price below $0.95 is kept and marks the stablecoin depegged", () => {
    mockUsdtFeed(90000000)
    assert.stringEquals(getTokenPriceUSD(USDT, BLOCK_TIMESTAMP).toString(), "0.9")
    assert.fieldEquals("Token", USDT.toHexString(), "depegged", "true")
    assert.fieldEquals("Token", USDT.toHexString(), "priceStale", "false")
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

  test("DOLA is priced from its pool, not hardcoded to $1", () => {
    createMockedFunction(DOLA_USDC_POOL, "token0", "token0():(address)").withArgs([]).reverts()
    createMockedFunction(DOLA_USDC_POOL, "token1", "token1():(address)").withArgs([]).reverts()
    createMockedFunction(DOLA_USDC_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)").withArgs([]).reverts()
    assert.stringEquals(getTokenPriceUSD(DOLA, BLOCK_TIMESTAMP).toString(), "0")
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
