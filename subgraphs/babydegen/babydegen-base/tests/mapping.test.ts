import {
  assert,
  describe,
  test,
  clearStore,
  afterEach,
  createMockedFunction
} from "matchstick-as/assembly/index"
import { Address, BigInt, BigDecimal, Bytes, ethereum } from "@graphprotocol/graph-ts"
import {
  handleRegisterInstance,
  handleCreateMultisigWithAgents
} from "../src/serviceRegistry"
import { getTokenConfig, TokenConfig } from "../src/tokenConfig"
import { getVelodromeV2Price } from "../src/priceAdapters"
import { calculatePositionROI, initializePositionIncome } from "../src/roiCalculation"
import { refreshVeloV2Position, getVeloV2PositionId } from "../src/veloV2Shared"
import { refreshAllActivePositions } from "../src/helpers"
import { AgentSwapBuffer, SwapTransaction } from "../generated/schema"
import { handleVeloV2Bootstrap } from "../src/veloV2Bootstrap"
import { handleVeloV2Transfer, handleVeloV2Burn, handleVeloV2Mint, handleAeroV2Mint } from "../src/veloV2Pool"
import { ProtocolPosition, Service, V2PoolVenue } from "../generated/schema"
import { handleNFTTransfer, handleAeroIncreaseLiquidity, handleDecreaseLiquidity, handleIncreaseLiquidity } from "../src/veloNFTManager"
import { refreshVeloCLPosition, clVenueForManager } from "../src/veloCLShared"
import { handleAeroV2PoolCreated } from "../src/veloV2Factory"
import { handleAeroGaugeCreated } from "../src/aeroGaugeManager"
import { getTokenPriceUSD } from "../src/priceDiscovery"
import {
  USDC_NATIVE,
  WETH,
  AERO,
  BOLD,
  VELO_VOTER,
  VELO_V2_SUGAR,
  VELO_V2_FACTORY,
  VELO_MANAGER,
  VELO_FACTORY,
  AERO_PROTOCOL_AERO,
  USDT,
  DAI,
  USDE,
  USDS,
  USDT_USD_FEED,
  DAI_USD_FEED,
  USDS_USD_FEED,
  USDE_USD_FEED,
  AERO_NFT_MANAGER,
  AERO_CL_FACTORY,
  AERO_V2_STABLE_FACTORY,
  AERO_V2_VOLATILE_FACTORY
} from "../src/constants"
import {
  createRegisterInstanceEvent,
  createCreateMultisigWithAgentsEvent,
  createV2TransferEvent,
  createV2MintEvent,
  createNFTTransferEvent,
  createAeroIncreaseLiquidityEvent,
  createAeroV2PoolCreatedEvent,
  createGaugeCreatedEvent,
  createAeroV2MintEvent,
  createV2BurnEvent,
  createDecreaseLiquidityEvent,
  createIncreaseLiquidityEvent
} from "./mapping-utils"
import {
  OPERATOR_SAFE,
  AGENT_INSTANCE,
  SERVICE_SAFE,
  SERVICE_ID,
  SERVICE_ID_2,
  BASIUS_AGENT_ID,
  NON_BASIUS_AGENT_ID,
  BLOCK_NUMBER,
  BLOCK_TIMESTAMP,
  TX_HASH,
  ETH_USD_FEED,
  ETH_PRICE_RAW
} from "./test-helpers"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mock the Chainlink ETH/USD latestRoundData call so that
 * ensureAgentPortfolio -> getEthUsd -> fetchFeedUsd works without reverting.
 *
 * latestRoundData() returns (uint80 roundId, int256 answer, uint256 startedAt,
 *                            uint256 updatedAt, uint80 answeredInRound)
 */
function mockChainlinkEthUsd(): void {
  createMockedFunction(
    ETH_USD_FEED,
    "latestRoundData",
    "latestRoundData():(uint80,int256,uint256,uint256,uint80)"
  )
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),   // roundId
      ethereum.Value.fromSignedBigInt(ETH_PRICE_RAW),         // answer ($2000)
      ethereum.Value.fromUnsignedBigInt(BLOCK_TIMESTAMP),     // startedAt
      ethereum.Value.fromUnsignedBigInt(BLOCK_TIMESTAMP),     // updatedAt
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))    // answeredInRound
    ])
}

/**
 * Creates a RegisterInstance event with default block metadata, fires the
 * handler, and returns the event for further inspection if needed.
 */
function registerService(
  serviceId: BigInt = SERVICE_ID,
  agentId: BigInt = BASIUS_AGENT_ID
): void {
  let event = createRegisterInstanceEvent(
    OPERATOR_SAFE,
    serviceId,
    AGENT_INSTANCE,
    agentId
  )
  event.block.number = BLOCK_NUMBER
  event.block.timestamp = BLOCK_TIMESTAMP
  event.transaction.hash = TX_HASH
  handleRegisterInstance(event)
}

// ---------------------------------------------------------------------------
// Tests — handleRegisterInstance
// ---------------------------------------------------------------------------

describe("handleRegisterInstance", () => {
  afterEach(() => {
    clearStore()
  })

  test("creates ServiceRegistration entity with correct fields", () => {
    registerService()

    assert.entityCount("ServiceRegistration", 1)

    // ServiceRegistration ID is Bytes.fromUTF8(serviceId.toString())
    let id = Bytes.fromUTF8(SERVICE_ID.toString())

    assert.fieldEquals(
      "ServiceRegistration",
      id.toHexString(),
      "serviceId",
      SERVICE_ID.toString()
    )
    assert.fieldEquals(
      "ServiceRegistration",
      id.toHexString(),
      "operatorSafe",
      OPERATOR_SAFE.toHexString()
    )
    assert.fieldEquals(
      "ServiceRegistration",
      id.toHexString(),
      "registrationBlock",
      BLOCK_NUMBER.toString()
    )
    assert.fieldEquals(
      "ServiceRegistration",
      id.toHexString(),
      "registrationTimestamp",
      BLOCK_TIMESTAMP.toString()
    )
    assert.fieldEquals(
      "ServiceRegistration",
      id.toHexString(),
      "registrationTxHash",
      TX_HASH.toHexString()
    )
  })

  test("ignores non-Basius agent IDs", () => {
    // Filtering is by agentId; a non-Basius agent id must be skipped.
    registerService(SERVICE_ID, NON_BASIUS_AGENT_ID)

    assert.entityCount("ServiceRegistration", 0)
  })

  test("tracks every service running agentId 115 (multi-service)", () => {
    // Two DIFFERENT service IDs, both on agentId 115 → both tracked.
    registerService(SERVICE_ID, BASIUS_AGENT_ID)
    registerService(SERVICE_ID_2, BASIUS_AGENT_ID)

    assert.entityCount("ServiceRegistration", 2)
  })

  test("overwrites registration for same service ID", () => {
    // First registration
    registerService()

    // Second registration with a different block number
    let event = createRegisterInstanceEvent(
      OPERATOR_SAFE,
      SERVICE_ID,
      AGENT_INSTANCE,
      BASIUS_AGENT_ID
    )
    let newBlock = BigInt.fromI32(136700000)
    event.block.number = newBlock
    event.block.timestamp = BLOCK_TIMESTAMP
    event.transaction.hash = TX_HASH
    handleRegisterInstance(event)

    // Still only one entity — it was overwritten
    assert.entityCount("ServiceRegistration", 1)

    let id = Bytes.fromUTF8(SERVICE_ID.toString())
    assert.fieldEquals(
      "ServiceRegistration",
      id.toHexString(),
      "registrationBlock",
      newBlock.toString()
    )
  })
})

// ---------------------------------------------------------------------------
// Tests — handleCreateMultisigWithAgents
// ---------------------------------------------------------------------------

describe("handleCreateMultisigWithAgents", () => {
  afterEach(() => {
    clearStore()
  })

  test("does nothing when no prior ServiceRegistration exists", () => {
    // Fire CreateMultisigWithAgents without a preceding RegisterInstance
    mockChainlinkEthUsd()

    let event = createCreateMultisigWithAgentsEvent(SERVICE_ID, SERVICE_SAFE)
    event.block.number = BLOCK_NUMBER
    event.block.timestamp = BLOCK_TIMESTAMP
    event.transaction.hash = TX_HASH
    handleCreateMultisigWithAgents(event)

    // No Service entity should be created
    assert.entityCount("Service", 0)
  })

  test("does nothing for services whose RegisterInstance had a non-Basius agentId", () => {
    mockChainlinkEthUsd()

    // RegisterInstance is skipped (non-Basius agentId) → no ServiceRegistration,
    // so CreateMultisigWithAgents has nothing to promote.
    registerService(SERVICE_ID, NON_BASIUS_AGENT_ID)
    assert.entityCount("ServiceRegistration", 0)

    let event = createCreateMultisigWithAgentsEvent(SERVICE_ID, SERVICE_SAFE)
    event.block.number = BLOCK_NUMBER
    event.block.timestamp = BLOCK_TIMESTAMP
    event.transaction.hash = TX_HASH
    handleCreateMultisigWithAgents(event)

    assert.entityCount("Service", 0)
  })

  test("creates Service entity with correct fields after RegisterInstance", () => {
    mockChainlinkEthUsd()

    // Step 1: Register the service (creates ServiceRegistration)
    registerService()
    assert.entityCount("ServiceRegistration", 1)

    // Step 2: Create multisig (creates Service)
    let multisigTimestamp = BigInt.fromI32(1700001000)
    let multisigBlock = BigInt.fromI32(136601000)
    let multisigTxHash = Bytes.fromHexString(
      "0x1111111111111111111111111111111111111111111111111111111111111111"
    )

    let event = createCreateMultisigWithAgentsEvent(SERVICE_ID, SERVICE_SAFE)
    event.block.number = multisigBlock
    event.block.timestamp = multisigTimestamp
    event.transaction.hash = multisigTxHash
    handleCreateMultisigWithAgents(event)

    assert.entityCount("Service", 1)

    // Service ID is the multisig address (as Bytes)
    let serviceEntityId = SERVICE_SAFE.toHexString()

    assert.fieldEquals(
      "Service",
      serviceEntityId,
      "serviceId",
      SERVICE_ID.toString()
    )
    assert.fieldEquals(
      "Service",
      serviceEntityId,
      "operatorSafe",
      OPERATOR_SAFE.toHexString()
    )
    assert.fieldEquals(
      "Service",
      serviceEntityId,
      "serviceSafe",
      SERVICE_SAFE.toHexString()
    )
    assert.fieldEquals("Service", serviceEntityId, "isActive", "true")
    assert.fieldEquals("Service", serviceEntityId, "agentInstances", "[" + AGENT_INSTANCE.toHexString() + "]")

    // Registration metadata should come from the ServiceRegistration entity
    assert.fieldEquals(
      "Service",
      serviceEntityId,
      "latestRegistrationBlock",
      BLOCK_NUMBER.toString()
    )
    assert.fieldEquals(
      "Service",
      serviceEntityId,
      "latestRegistrationTimestamp",
      BLOCK_TIMESTAMP.toString()
    )
    assert.fieldEquals(
      "Service",
      serviceEntityId,
      "latestRegistrationTxHash",
      TX_HASH.toHexString()
    )

    // Multisig metadata should come from the CreateMultisigWithAgents event
    assert.fieldEquals(
      "Service",
      serviceEntityId,
      "latestMultisigBlock",
      multisigBlock.toString()
    )
    assert.fieldEquals(
      "Service",
      serviceEntityId,
      "latestMultisigTimestamp",
      multisigTimestamp.toString()
    )
    assert.fieldEquals(
      "Service",
      serviceEntityId,
      "latestMultisigTxHash",
      multisigTxHash.toHexString()
    )
  })

  test("creates ServiceIndex entity pointing to the service safe", () => {
    mockChainlinkEthUsd()

    registerService()

    let event = createCreateMultisigWithAgentsEvent(SERVICE_ID, SERVICE_SAFE)
    event.block.number = BLOCK_NUMBER
    event.block.timestamp = BLOCK_TIMESTAMP
    event.transaction.hash = TX_HASH
    handleCreateMultisigWithAgents(event)

    assert.entityCount("ServiceIndex", 1)

    let indexId = Bytes.fromUTF8(SERVICE_ID.toString())
    assert.fieldEquals(
      "ServiceIndex",
      indexId.toHexString(),
      "serviceId",
      SERVICE_ID.toString()
    )
    assert.fieldEquals(
      "ServiceIndex",
      indexId.toHexString(),
      "currentServiceSafe",
      SERVICE_SAFE.toHexString()
    )
  })

  test("registers service in ServiceRegistry singleton for snapshots", () => {
    mockChainlinkEthUsd()

    registerService()

    let event = createCreateMultisigWithAgentsEvent(SERVICE_ID, SERVICE_SAFE)
    event.block.number = BLOCK_NUMBER
    event.block.timestamp = BLOCK_TIMESTAMP
    event.transaction.hash = TX_HASH
    handleCreateMultisigWithAgents(event)

    let registryId = Bytes.fromUTF8("registry")
    assert.entityCount("ServiceRegistry", 1)
    assert.fieldEquals(
      "ServiceRegistry",
      registryId.toHexString(),
      "serviceAddresses",
      "[" + SERVICE_SAFE.toHexString() + "]"
    )
  })

  test("creates AgentPortfolio entity for new service", () => {
    mockChainlinkEthUsd()

    registerService()

    let event = createCreateMultisigWithAgentsEvent(SERVICE_ID, SERVICE_SAFE)
    event.block.number = BLOCK_NUMBER
    event.block.timestamp = BLOCK_TIMESTAMP
    event.transaction.hash = TX_HASH
    handleCreateMultisigWithAgents(event)

    assert.entityCount("AgentPortfolio", 1)

    let portfolioId = SERVICE_SAFE.toHexString()
    assert.fieldEquals(
      "AgentPortfolio",
      portfolioId,
      "service",
      SERVICE_SAFE.toHexString()
    )
    // firstTradingTimestamp should be set to the block timestamp since
    // no prior funding exists (the handler uses it as fallback)
    assert.fieldEquals(
      "AgentPortfolio",
      portfolioId,
      "firstTradingTimestamp",
      BLOCK_TIMESTAMP.toString()
    )
  })
})

// ---------------------------------------------------------------------------
// Base token configuration — Aerodrome AERO pricing, OLAS dropped, stables ~$1
// ---------------------------------------------------------------------------
describe("Base token config (tokenConfig.ts)", () => {
  test("USDC and WETH price off Chainlink", () => {
    const usdc = changetype<TokenConfig>(getTokenConfig(USDC_NATIVE))
    assert.stringEquals("USDC", usdc.symbol)
    assert.i32Equals(6, usdc.decimals)
    assert.stringEquals("chainlink", usdc.priceSources[0].sourceType)

    const weth = changetype<TokenConfig>(getTokenConfig(WETH))
    assert.i32Equals(18, weth.decimals)
    assert.stringEquals("chainlink", weth.priceSources[0].sourceType)
  })

  test("AERO prices off the Aerodrome AERO/USDC volatile pool (velodrome_v2 adapter)", () => {
    const aero = changetype<TokenConfig>(getTokenConfig(AERO))
    assert.stringEquals("AERO", aero.symbol)
    assert.i32Equals(18, aero.decimals)

    const src = aero.priceSources[0]
    assert.stringEquals("velodrome_v2", src.sourceType)
    // pool address (lowercased hex) — the AERO/USDC volatile pool
    assert.stringEquals(
      "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d",
      src.address.toHexString()
    )
    // pair token is USDC (the numeraire for the volatile pool)
    assert.stringEquals(
      USDC_NATIVE.toHexString(),
      changetype<Address>(src.pairToken).toHexString()
    )
  })

  test("whitelisted stables resolve to ~$1 via the USDC reference feed", () => {
    const bold = changetype<TokenConfig>(getTokenConfig(BOLD))
    assert.stringEquals("chainlink_reference", bold.priceSources[0].sourceType)
  })

  test("OLAS is not tracked (dropped — Basius holds none)", () => {
    // OLAS on Base: 0x54330d28ca3357F294334BDC454a032e7f353416
    const olas = getTokenConfig(
      Address.fromString("0x54330d28ca3357F294334BDC454a032e7f353416")
    )
    assert.assertNull(olas)
  })
})

// ---------------------------------------------------------------------------
// AERO price resolution — velodrome_v2 adapter reading the mocked AERO/USDC pool
// ---------------------------------------------------------------------------
describe("getVelodromeV2Price — AERO/USDC volatile pool", () => {
  afterEach(() => {
    clearStore()
  })

  test("derives AERO ≈ $1.30 from reserves (AERO token0 18dec, USDC token1 6dec)", () => {
    const POOL = Address.fromString("0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d")

    createMockedFunction(POOL, "token0", "token0():(address)")
      .withArgs([])
      .returns([ethereum.Value.fromAddress(AERO)])
    createMockedFunction(POOL, "token1", "token1():(address)")
      .withArgs([])
      .returns([ethereum.Value.fromAddress(USDC_NATIVE)])
    // 1,000,000 AERO (1e24) vs 1,300,000 USDC (1.3e12) → price = 1.3 USDC/AERO × $1
    // A volatile pool: priced from its reserves
    createMockedFunction(POOL, "stable", "stable():(bool)").withArgs([]).returns([ethereum.Value.fromBoolean(false)])
    createMockedFunction(POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
      .withArgs([])
      .returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000000000")),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1300000000000")),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero())
      ])

    const price = getVelodromeV2Price(AERO, POOL, USDC_NATIVE)
    assert.assertTrue(price.gt(BigDecimal.fromString("1.29")))
    assert.assertTrue(price.lt(BigDecimal.fromString("1.31")))
  })

  test("returns 0 (graceful) when the pool reverts", () => {
    const POOL = Address.fromString("0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d")
    // token0() reverts → try_token0().reverted → adapter returns 0, no crash.
    createMockedFunction(POOL, "token0", "token0():(address)").withArgs([]).reverts()
    createMockedFunction(POOL, "token1", "token1():(address)").withArgs([]).reverts()
    const price = getVelodromeV2Price(AERO, POOL, USDC_NATIVE)
    assert.stringEquals("0", price.toString())
  })
})

// ---------------------------------------------------------------------------
// Position ROI math (roiCalculation.ts)
// ---------------------------------------------------------------------------
function makeClosedPosition(
  idStr: string,
  entryUSD: string,
  costsUSD: string,
  exitUSD: string
): ProtocolPosition {
  const p = new ProtocolPosition(Bytes.fromUTF8(idStr))
  p.agent = SERVICE_SAFE
  p.protocol = "aerodrome-cl"
  p.pool = SERVICE_SAFE
  p.isActive = false
  p.usdCurrent = BigDecimal.zero()
  p.usdCurrentWithRewards = BigDecimal.zero()
  p.amount0USD = BigDecimal.zero()
  p.amount1USD = BigDecimal.zero()
  p.tokenId = BigInt.zero()
  p.tickLower = 0
  p.tickUpper = 0
  p.entryTxHash = TX_HASH
  p.entryTimestamp = BLOCK_TIMESTAMP
  p.entryAmount0 = BigDecimal.zero()
  p.entryAmount0USD = BigDecimal.zero()
  p.entryAmount1 = BigDecimal.zero()
  p.entryAmount1USD = BigDecimal.zero()
  p.entryAmountUSD = BigDecimal.fromString(entryUSD)
  p.totalCostsUSD = BigDecimal.fromString(costsUSD)
  p.swapSlippageUSD = BigDecimal.zero()
  p.investmentUSD = BigDecimal.zero()
  p.grossGainUSD = BigDecimal.zero()
  p.netGainUSD = BigDecimal.zero()
  p.positionROI = BigDecimal.zero()
  p.exitAmountUSD = BigDecimal.fromString(exitUSD)
  initializePositionIncome(p)
  p.save()
  return p
}

describe("calculatePositionROI", () => {
  afterEach(() => {
    clearStore()
  })

  test("gain: entry 100, exit 150 → ROI 50%", () => {
    const pos = makeClosedPosition("pos-gain", "100", "0", "150")
    const roi = calculatePositionROI(pos)
    assert.stringEquals("50", roi.toString())
    assert.fieldEquals("ProtocolPosition", pos.id.toHexString(), "netGainUSD", "50")
    assert.fieldEquals("ProtocolPosition", pos.id.toHexString(), "investmentUSD", "100")
  })

  test("loss: entry 200, exit 150 → ROI -25%", () => {
    const pos = makeClosedPosition("pos-loss", "200", "0", "150")
    const roi = calculatePositionROI(pos)
    assert.stringEquals("-25", roi.toString())
  })

  test("costs count against ROI: entry 100, costs 20, exit 150 → ROI 25%", () => {
    const pos = makeClosedPosition("pos-costs", "100", "20", "150")
    const roi = calculatePositionROI(pos)
    // investment = 100 + 20 = 120; netGain = 150 - 120 = 30; ROI = 25%
    assert.stringEquals("25", roi.toString())
    assert.fieldEquals("ProtocolPosition", pos.id.toHexString(), "investmentUSD", "120")
  })
})

// ---------------------------------------------------------------------------
// Aerodrome V2 gauge-staked positions (veloV2Shared.ts)
//
// When a Basius agent stakes its V2 LP into a gauge, the LP ERC20 leaves the safe
// (pool.balanceOf(safe) -> 0). Before the fix this marked the position closed/zero;
// now we resolve the pool's gauge via the Voter and count gauge.balanceOf(safe) as
// the staked LP, plus gauge.earned(safe) as claimable AERO. See AERO-REWARDS-PLAN.md §7.
// ---------------------------------------------------------------------------
const V2_POOL = Address.fromString("0x7a034374c89c463dd65d8c9bcfe63bcbced41f4f")
const V2_GAUGE = Address.fromString("0x793f22ab88dc91793e5ce6adbd7e733b0bd4733e")
// Two non-whitelisted dummy tokens → getTokenPriceUSD returns 0 with no chain calls,
// so usdCurrent is 0 and the test isolates the gauge/staking behavior.
const DUMMY0 = Address.fromString("0x00000000000000000000000000000000000000a0")
const DUMMY1 = Address.fromString("0x00000000000000000000000000000000000000b0")

function createService(safe: Address): void {
  const s = new Service(safe)
  s.serviceId = SERVICE_ID
  s.operatorSafe = OPERATOR_SAFE
  s.serviceSafe = safe
  s.latestRegistrationBlock = BLOCK_NUMBER
  s.latestRegistrationTimestamp = BLOCK_TIMESTAMP
  s.latestRegistrationTxHash = TX_HASH
  s.latestMultisigBlock = BLOCK_NUMBER
  s.latestMultisigTimestamp = BLOCK_TIMESTAMP
  s.latestMultisigTxHash = TX_HASH
  s.isActive = true
  s.createdAt = BLOCK_TIMESTAMP
  s.updatedAt = BLOCK_TIMESTAMP
  s.positionIds = []
  s.agentInstances = [AGENT_INSTANCE]
  s.save()
}

// Pre-create an existing V2 position so refreshVeloV2Position takes the "existing" path
// (no token0/stable metadata fetch) and just refreshes current state.
function makeOpenV2Position(token0: Address, token1: Address): Bytes {
  const id = getVeloV2PositionId(SERVICE_SAFE, V2_POOL)
  const p = new ProtocolPosition(id)
  p.agent = SERVICE_SAFE
  p.service = SERVICE_SAFE
  p.protocol = "aerodrome-v2"
  p.pool = V2_POOL
  p.token0 = token0
  p.token1 = token1
  p.isActive = true
  p.tokenId = BigInt.zero()
  p.tickLower = 0
  p.tickUpper = 0
  p.tickSpacing = 0
  p.usdCurrent = BigDecimal.zero()
  p.usdCurrentWithRewards = BigDecimal.zero()
  p.amount0USD = BigDecimal.zero()
  p.amount1USD = BigDecimal.zero()
  p.entryTxHash = TX_HASH
  p.entryTimestamp = BLOCK_TIMESTAMP // non-zero → skip the new-position entry/swap block
  p.entryAmount0 = BigDecimal.zero()
  p.entryAmount0USD = BigDecimal.zero()
  p.entryAmount1 = BigDecimal.zero()
  p.entryAmount1USD = BigDecimal.zero()
  p.entryAmountUSD = BigDecimal.fromString("100")
  p.totalCostsUSD = BigDecimal.zero()
  p.swapSlippageUSD = BigDecimal.zero()
  p.investmentUSD = BigDecimal.fromString("100")
  p.grossGainUSD = BigDecimal.zero()
  p.netGainUSD = BigDecimal.zero()
  p.positionROI = BigDecimal.zero()
  initializePositionIncome(p)
  p.save()
  return id
}

function mockV2PoolState(): void {
  // LP has left the safe (staked) → balanceOf(safe) == 0
  createMockedFunction(V2_POOL, "balanceOf", "balanceOf(address):(uint256)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.zero())])
  createMockedFunction(V2_POOL, "totalSupply", "totalSupply():(uint256)")
    .withArgs([])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000"))])
  createMockedFunction(V2_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
  // Voter resolves the pool's gauge
  createMockedFunction(VELO_VOTER, "gauges", "gauges(address):(address)")
    .withArgs([ethereum.Value.fromAddress(V2_POOL)])
    .returns([ethereum.Value.fromAddress(V2_GAUGE)])
  // Gauge holds the staked LP for the safe
  createMockedFunction(V2_GAUGE, "balanceOf", "balanceOf(address):(uint256)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("500"))])
}

// AERO/USDC velodrome_v2 source from tokenConfig.ts. Must match the AERO price-source pool
// there — if tokenConfig changes the source, update this address (see review nit #6).
const AERO_PRICE_POOL = Address.fromString("0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d")

function mockAeroUsdcPool(): void {
  // On-chain ordering (verified): USDC (0x8335…) < AERO (0x9401…), so USDC is token0. Mock it
  // that way so the test exercises the same getVelodromeV2Price branch production hits.
  createMockedFunction(AERO_PRICE_POOL, "token0", "token0():(address)")
    .withArgs([])
    .returns([ethereum.Value.fromAddress(USDC_NATIVE)])
  createMockedFunction(AERO_PRICE_POOL, "token1", "token1():(address)")
    .withArgs([])
    .returns([ethereum.Value.fromAddress(AERO)])
  // reserve0 = 1.3e12 USDC (1.3M @6dec), reserve1 = 1e24 AERO (1M @18dec) → AERO ≈ $1.30
  // A volatile pool: priced from its reserves
  createMockedFunction(AERO_PRICE_POOL, "stable", "stable():(bool)").withArgs([]).returns([ethereum.Value.fromBoolean(false)])
  createMockedFunction(AERO_PRICE_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1300000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
}

function mockV2PoolStateNoGauge(gaugeAddr: Address): void {
  createMockedFunction(V2_POOL, "balanceOf", "balanceOf(address):(uint256)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.zero())])
  createMockedFunction(V2_POOL, "totalSupply", "totalSupply():(uint256)")
    .withArgs([])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000"))])
  createMockedFunction(V2_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
  createMockedFunction(VELO_VOTER, "gauges", "gauges(address):(address)")
    .withArgs([ethereum.Value.fromAddress(V2_POOL)])
    .returns([ethereum.Value.fromAddress(gaugeAddr)])
}

function v2Block(): ethereum.Block {
  const ev = createRegisterInstanceEvent(OPERATOR_SAFE, SERVICE_ID, AGENT_INSTANCE, BASIUS_AGENT_ID)
  ev.block.number = BLOCK_NUMBER
  ev.block.timestamp = BLOCK_TIMESTAMP
  return ev.block
}

describe("Aerodrome V2 gauge-staked positions", () => {
  afterEach(() => {
    clearStore()
  })

  test("staked position (LP left the safe) stays active, valued by gauge balance", () => {
    createService(SERVICE_SAFE)
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    mockV2PoolState()
    // No claimable rewards this refresh → reward block is skipped (no AERO pricing needed)
    createMockedFunction(V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .reverts()

    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    // Despite pool.balanceOf(safe) == 0, the position is NOT closed: the gauge holds 500 LP.
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "liquidity", "500")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableRewardUSD", "0")
  })

  test("claimable AERO gauge rewards fold into usdCurrentWithRewards", () => {
    createService(SERVICE_SAFE)
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    mockV2PoolState()
    mockAeroUsdcPool()
    // 2 AERO claimable (2e18 wei)
    createMockedFunction(V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("2000000000000000000"))])

    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    // claimableReward = 2e18 / 1e18 = 2 AERO; AERO ≈ $1.30 → rewardUSD ≈ $2.60.
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
    const pos = ProtocolPosition.load(id)!
    assert.assertTrue(pos.claimableRewardUSD!.gt(BigDecimal.fromString("2.59")))
    assert.assertTrue(pos.claimableRewardUSD!.lt(BigDecimal.fromString("2.61")))
    // usdCurrent is 0 (dummy tokens), so usdCurrentWithRewards == rewardUSD ≈ 2.60.
    assert.assertTrue(pos.usdCurrentWithRewards.gt(BigDecimal.fromString("2.59")))
    assert.assertTrue(pos.usdCurrentWithRewards.lt(BigDecimal.fromString("2.61")))
  })

  test("pool with no gauge (Voter returns 0x0) → position closes cleanly", () => {
    createService(SERVICE_SAFE)
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    // Voter returns the zero address → pool has no gauge; no gauge calls are made.
    mockV2PoolStateNoGauge(Address.zero())

    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    // No in-wallet LP and no gauge → genuinely closed.
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "false")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "liquidity", "0")
  })

  test("cached gauge (rewardsContract set) skips the Voter lookup", () => {
    createService(SERVICE_SAFE)
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    // Pre-cache the gauge on the position. Voter.gauges is intentionally NOT mocked, so if the
    // code ignored the cache and called it, matchstick would throw and fail this test.
    const seed = ProtocolPosition.load(id)!
    seed.rewardsContract = V2_GAUGE
    seed.save()

    createMockedFunction(V2_POOL, "balanceOf", "balanceOf(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.zero())])
    createMockedFunction(V2_POOL, "totalSupply", "totalSupply():(uint256)")
      .withArgs([]).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000"))])
    createMockedFunction(V2_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
      .withArgs([]).returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000")),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000")),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero())
      ])
    createMockedFunction(V2_GAUGE, "balanceOf", "balanceOf(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("500"))])
    createMockedFunction(V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)]).reverts()

    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    // Used the cached gauge (no Voter call); staked LP counted → position stays active.
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "liquidity", "500")
  })

  test("genuinely exited staked position (pool & gauge balance 0) closes and clears rewards", () => {
    createService(SERVICE_SAFE)
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    // Pre-seed stale reward fields to prove the close-out path clears them.
    const seed = ProtocolPosition.load(id)!
    seed.claimableReward = BigDecimal.fromString("5")
    seed.claimableRewardUSD = BigDecimal.fromString("6")
    seed.usdCurrentWithRewards = BigDecimal.fromString("6")
    seed.save()

    mockV2PoolStateNoGauge(V2_GAUGE)
    // Nothing staked, and earned reverts → reward block skipped; userBalance = 0.
    createMockedFunction(V2_GAUGE, "balanceOf", "balanceOf(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.zero())])
    createMockedFunction(V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)]).reverts()

    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "false")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "liquidity", "0")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "0")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableRewardUSD", "0")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "usdCurrentWithRewards", "0")
  })
})

// ---------------------------------------------------------------------------
// V2 bootstrap pagination (veloV2Bootstrap.ts)
//
// LpSugar forSwaps(limit, offset) walks RAW factory pool indices but returns a
// FILTERED page (zero-reserve pools dropped), so a page shorter than `limit`
// does NOT mean the end of the list. The loop must page up to the factory's
// allPoolsLength() bound.
// ---------------------------------------------------------------------------

// Unique per-test pool addresses: the bootstrap's discoveredPools cache is
// module-level and survives clearStore(), so reusing an address across tests
// would silently skip template creation.
const BOOT_POOL_PAGE1 = Address.fromString("0x00000000000000000000000000000000000000c1")
const BOOT_POOL_PAGE2 = Address.fromString("0x00000000000000000000000000000000000000c2")
const BOOT_POOL_CL = Address.fromString("0x00000000000000000000000000000000000000c3")
const BOOT_POOL_NON_WL = Address.fromString("0x00000000000000000000000000000000000000c4")

// forSwaps returns (address lp, int24 type, address token0, address token1,
// address factory, uint256 pool_fee)[]
function sugarPoolTuple(lp: Address, poolType: i32, token0: Address, token1: Address): ethereum.Tuple {
  const t = new ethereum.Tuple()
  t.push(ethereum.Value.fromAddress(lp))
  t.push(ethereum.Value.fromI32(poolType))
  t.push(ethereum.Value.fromAddress(token0))
  t.push(ethereum.Value.fromAddress(token1))
  t.push(ethereum.Value.fromAddress(VELO_V2_FACTORY))
  t.push(ethereum.Value.fromUnsignedBigInt(BigInt.zero()))
  return t
}

function mockForSwapsPage(offset: i32, pools: Array<ethereum.Tuple>): void {
  createMockedFunction(
    VELO_V2_SUGAR,
    "forSwaps",
    "forSwaps(uint256,uint256):((address,int24,address,address,address,uint256)[])"
  )
    .withArgs([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(500)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(offset))
    ])
    .returns([ethereum.Value.fromTupleArray(pools)])
}

function mockAllPoolsLength(count: i32): void {
  createMockedFunction(VELO_V2_FACTORY, "allPoolsLength", "allPoolsLength():(uint256)")
    .withArgs([])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(count))])
}

describe("handleVeloV2Bootstrap pagination", () => {
  afterEach(() => {
    clearStore()
  })

  test("aborts without calling forSwaps when allPoolsLength reverts", () => {
    createMockedFunction(VELO_V2_FACTORY, "allPoolsLength", "allPoolsLength():(uint256)")
      .withArgs([])
      .reverts()
    // forSwaps is intentionally NOT mocked: if the bootstrap called it anyway,
    // matchstick would throw on the unmocked call and fail this test.
    handleVeloV2Bootstrap(v2Block())

    assert.dataSourceCount("VeloV2Pool", 0)
  })

  test("continues past a short page up to allPoolsLength (filtered pages)", () => {
    mockAllPoolsLength(1000)
    // Page 1 returns 1 entry (< limit 500) — filtered, NOT the end of the list.
    mockForSwapsPage(0, [sugarPoolTuple(BOOT_POOL_PAGE1, 0, USDC_NATIVE, BOLD)])
    // Page 2 holds a whitelisted v2 pool, a CL pool (positive type = tickSpacing,
    // must be skipped) and a pool with a non-whitelisted token (must be skipped).
    mockForSwapsPage(500, [
      sugarPoolTuple(BOOT_POOL_PAGE2, -1, USDC_NATIVE, WETH),
      sugarPoolTuple(BOOT_POOL_CL, 100, USDC_NATIVE, WETH),
      sugarPoolTuple(BOOT_POOL_NON_WL, 0, DUMMY0, USDC_NATIVE)
    ])

    handleVeloV2Bootstrap(v2Block())

    // The regression: the old loop stopped after the short first page, so the
    // second-page pool never got a template.
    assert.dataSourceExists("VeloV2Pool", BOOT_POOL_PAGE2.toHexString())
    assert.dataSourceExists("VeloV2Pool", BOOT_POOL_PAGE1.toHexString())
    assert.dataSourceCount("VeloV2Pool", 2)
  })
})

// ---------------------------------------------------------------------------
// V2 pending-mint entry amounts (veloV2Pool.ts)
//
// Transfer(0x0 → safe) creates the position and stores a PendingMintPosition;
// the Mint event in the same tx then applies the real entry amounts. The
// pending record must carry the same position id the position was created
// under (getVeloV2PositionId), otherwise the Mint data is silently dropped.
// ---------------------------------------------------------------------------
const MINT_POOL = Address.fromString("0x00000000000000000000000000000000000000d1")
const ROUTER = Address.fromString("0x00000000000000000000000000000000000000d2")

// token0 = AERO (priced ~$1.30 via mockAeroUsdcPool) so the mint records a
// non-zero entryAmountUSD; a $0 entry would keep the backfill fallback firing
// on every refresh and mask the Mint override this test asserts.
function mockMintPoolState(): void {
  createMockedFunction(MINT_POOL, "token0", "token0():(address)")
    .withArgs([])
    .returns([ethereum.Value.fromAddress(AERO)])
  createMockedFunction(MINT_POOL, "token1", "token1():(address)")
    .withArgs([])
    .returns([ethereum.Value.fromAddress(DUMMY1)])
  createMockedFunction(MINT_POOL, "stable", "stable():(bool)")
    .withArgs([])
    .returns([ethereum.Value.fromBoolean(false)])
  createMockedFunction(MINT_POOL, "balanceOf", "balanceOf(address):(uint256)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(500))])
  createMockedFunction(MINT_POOL, "totalSupply", "totalSupply():(uint256)")
    .withArgs([])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000))])
  // 2 token0 / 4 token1 (18 dec) in reserves → current amounts 1 / 2 at 50% share
  createMockedFunction(MINT_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("2000000000000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("4000000000000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
  // No gauge for this pool → no gauge calls
  createMockedFunction(VELO_VOTER, "gauges", "gauges(address):(address)")
    .withArgs([ethereum.Value.fromAddress(MINT_POOL)])
    .returns([ethereum.Value.fromAddress(Address.zero())])
}

describe("handleVeloV2Transfer + handleVeloV2Mint entry amounts", () => {
  afterEach(() => {
    clearStore()
  })

  test("pending position id matches the position, so Mint sets entry amounts", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockMintPoolState()
    mockAeroUsdcPool()

    // 1. LP mint transfer: creates the position + the pending record
    const transfer = createV2TransferEvent(MINT_POOL, Address.zero(), SERVICE_SAFE, BigInt.fromI32(500))
    transfer.block.number = BLOCK_NUMBER
    transfer.block.timestamp = BLOCK_TIMESTAMP
    transfer.transaction.hash = TX_HASH
    handleVeloV2Transfer(transfer)

    const positionId = getVeloV2PositionId(SERVICE_SAFE, MINT_POOL)
    assert.stringEquals(SERVICE_SAFE.toHex() + "-aerodrome-v2-" + MINT_POOL.toHex(), positionId.toString())
    assert.fieldEquals("ProtocolPosition", positionId.toHexString(), "protocol", "aerodrome-v2")
    const pendingId = TX_HASH.toHexString() + "-" + MINT_POOL.toHexString()
    // The regression: the pending record used to carry a "-velodromev2-" id
    // that matches no ProtocolPosition, so the Mint amounts were dropped.
    assert.fieldEquals("PendingMintPosition", pendingId, "positionId", positionId.toHexString())

    // 2. Mint event in the same tx applies the event amounts as entry amounts
    const mint = createV2MintEvent(
      MINT_POOL,
      ROUTER,
      BigInt.fromString("2000000000000000000"), // 2 token0
      BigInt.fromString("6000000000000000000")  // 6 token1
    )
    mint.block.number = BLOCK_NUMBER
    mint.block.timestamp = BLOCK_TIMESTAMP
    mint.transaction.hash = TX_HASH
    handleVeloV2Mint(mint)

    // Entry amounts come from the Mint event (2/6), not from the current pool
    // share (1/2) that the creation-time fallback recorded.
    assert.fieldEquals("ProtocolPosition", positionId.toHexString(), "entryAmount0", "2")
    assert.fieldEquals("ProtocolPosition", positionId.toHexString(), "entryAmount1", "6")
    // Pending record is consumed
    assert.entityCount("PendingMintPosition", 0)
    // Legacy pool, no V2PoolVenue row: the fee comes from stable() (mocked false)
    assert.fieldEquals("ProtocolPosition", positionId.toHexString(), "fee", "30")
  })
})

// ---------------------------------------------------------------------------
// V2 entry-amount fallback (veloV2Shared.ts)
//
// entryTimestamp is always set at position creation, so the fallback that
// backfills missing entry amounts must key off entryAmountUSD alone.
// ---------------------------------------------------------------------------
function mockV2PoolInWallet(): void {
  createMockedFunction(V2_POOL, "balanceOf", "balanceOf(address):(uint256)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(500))])
  createMockedFunction(V2_POOL, "totalSupply", "totalSupply():(uint256)")
    .withArgs([])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000))])
  createMockedFunction(V2_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("2000000000000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("4000000000000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
  createMockedFunction(VELO_VOTER, "gauges", "gauges(address):(address)")
    .withArgs([ethereum.Value.fromAddress(V2_POOL)])
    .returns([ethereum.Value.fromAddress(Address.zero())])
}

describe("refreshVeloV2Position entry-amount fallback", () => {
  afterEach(() => {
    clearStore()
  })

  test("backfills entry amounts when entryAmountUSD is 0 despite entryTimestamp set", () => {
    createService(SERVICE_SAFE)
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    // Simulate a position whose Mint data was never applied: entry amounts are
    // zero but entryTimestamp is set (as creation always does).
    const seed = ProtocolPosition.load(id)!
    seed.entryAmountUSD = BigDecimal.zero()
    seed.save()
    mockV2PoolInWallet()

    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    // Fallback fires: entry amounts = current amounts (50% share of 2/4 reserves)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount0", "1")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount1", "2")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
  })

  test("does not overwrite entry amounts that were already recorded", () => {
    createService(SERVICE_SAFE)
    // makeOpenV2Position records entryAmountUSD = 100 and entryAmount0 = 0
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    mockV2PoolInWallet()

    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    // Fallback must NOT fire: recorded entry data stays untouched.
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmountUSD", "100")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount0", "0")
  })

  // SwapTransaction is @entity(immutable: true). The buffer-driven swap
  // association path used to re-save it, which crashes block indexing with
  // "immutable entity ... only allows inserts, not Overwrite" the moment a
  // backfilled position finds a matching swap in its window.
  test("backfill fallback with a matching buffered swap does not overwrite the immutable SwapTransaction", () => {
    createService(SERVICE_SAFE)
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    const seed = ProtocolPosition.load(id)!
    seed.entryAmountUSD = BigDecimal.zero()
    seed.save()
    mockV2PoolInWallet()

    // A LiFi swap the position should associate with.
    const swapId = Bytes.fromHexString(
      "0x54e99012bbbe4c61a28c3f54aaf16efda2d5a0e8ab1be3d4662452d92ca3b5902d313136"
    )
    const swap = new SwapTransaction(swapId)
    swap.agent = SERVICE_SAFE
    swap.transactionId = TX_HASH
    swap.txHash = TX_HASH
    swap.timestamp = BLOCK_TIMESTAMP
    swap.block = BLOCK_NUMBER
    swap.fromAssetId = USDC_NATIVE
    swap.toAssetId = WETH
    swap.fromAmount = BigInt.fromI32(8000000)
    swap.toAmount = BigInt.fromString("7988031101223343132")
    swap.fromAmountUSD = BigDecimal.fromString("7.99768")
    swap.toAmountUSD = BigDecimal.fromString("7.98571")
    swap.expectedToAmountUSD = BigDecimal.fromString("7.99768")
    swap.slippageUSD = BigDecimal.fromString("0.01197")
    swap.slippagePercentage = BigDecimal.fromString("0.14961")
    swap.isAssociated = false
    swap.expiresAt = BLOCK_TIMESTAMP.plus(BigInt.fromI32(1200))
    swap.save()

    // Seed the agent's swap buffer with one entry for this swap in bucket0. Row
    // format matches createSwapDataString: "<ts>,<swapId>,<slippage>,<expiresAt>,<swapId>".
    const buffer = new AgentSwapBuffer(SERVICE_SAFE)
    buffer.agent = SERVICE_SAFE
    buffer.bucket0Swaps =
      BLOCK_TIMESTAMP.toString() + "," + swapId.toHexString() + ",0.01197," +
      BLOCK_TIMESTAMP.plus(BigInt.fromI32(1200)).toString() + "," + swapId.toHexString()
    buffer.bucket1Swaps = ""
    buffer.bucket2Swaps = ""
    buffer.bucket3Swaps = ""
    buffer.totalSlippageUSD = BigDecimal.fromString("0.01197")
    buffer.lastUpdated = BLOCK_TIMESTAMP
    buffer.currentBucketIndex = BigInt.zero()
    buffer.save()

    // Before the fix this call reverted the whole block on the immutable
    // overwrite. It must now complete and apply the associated slippage to the
    // position's cost basis.
    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "swapSlippageUSD", "0.01197")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount0", "1")
    // The stored swap is untouched (immutable): isAssociated remains its
    // insert-time value, which is the property the schema enforces.
    assert.fieldEquals("SwapTransaction", swapId.toHexString(), "isAssociated", "false")
  })
})

// ---------------------------------------------------------------------------
// Aero (merged protocol) — CL positions, v2 pools, gauge rewards, new tokens
// ---------------------------------------------------------------------------
const AERO_TOKEN_ID = BigInt.fromI32(42)
const AERO_CL_POOL = Address.fromString("0x00000000000000000000000000000000000000e1")
const AERO_CL_GAUGE = Address.fromString("0x00000000000000000000000000000000000000e2")
const AERO_V2_POOL = Address.fromString("0x00000000000000000000000000000000000000e3")
const AERO_V2_GAUGE = Address.fromString("0x00000000000000000000000000000000000000e4")
// Aero v2 AERO/USDC volatile pool that prices AERO_PROTOCOL_AERO (tokenConfig.ts)
const AERO_PROTOCOL_AERO_PRICE_POOL = Address.fromString("0xF634058dC94e6BF8e828E27621320C423bC8B18E")
const USDT_FALLBACK_POOL = Address.fromString("0xD448990883e3Bf9cDD8ebCA368A3ECF9D629aAf7")

function aeroBlock(): ethereum.Block {
  return v2Block()
}

// AERO_PROTOCOL_AERO (0x3f5b…) sorts before USDC (0x8335…), so it is token0 on-chain.
// 1M AERO vs 600k USDC → AERO ≈ $0.60.
function mockAeroProtocolAeroUsdcPool(): void {
  createMockedFunction(AERO_PROTOCOL_AERO_PRICE_POOL, "token0", "token0():(address)")
    .withArgs([]).returns([ethereum.Value.fromAddress(AERO_PROTOCOL_AERO)])
  createMockedFunction(AERO_PROTOCOL_AERO_PRICE_POOL, "token1", "token1():(address)")
    .withArgs([]).returns([ethereum.Value.fromAddress(USDC_NATIVE)])
  createMockedFunction(AERO_PROTOCOL_AERO_PRICE_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
    .withArgs([]).returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("600000000000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
  // Aero v2 pools have no stable(), so the adapter reads the reserve ratio
  createMockedFunction(AERO_PROTOCOL_AERO_PRICE_POOL, "stable", "stable():(bool)").withArgs([]).reverts()
}

// positions(tokenId) of one NFPM: DUMMY0/DUMMY1, tickSpacing 1, ticks -10..10.
function mockCLPositions(manager: Address, liquidity: BigInt): void {
  createMockedFunction(
    manager,
    "positions",
    "positions(uint256):(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)"
  )
    .withArgs([ethereum.Value.fromUnsignedBigInt(AERO_TOKEN_ID)])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
      ethereum.Value.fromAddress(Address.zero()),
      ethereum.Value.fromAddress(DUMMY0),
      ethereum.Value.fromAddress(DUMMY1),
      ethereum.Value.fromI32(1),
      ethereum.Value.fromI32(-10),
      ethereum.Value.fromI32(10),
      ethereum.Value.fromUnsignedBigInt(liquidity),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
}

// A CL position on one venue's own contracts: its NFPM, its factory's getPool, the pool's slot0
// (price 1) and gauge(). Only that venue is mocked, so a venue mix-up misses a mock and fails.
function mockCLVenuePosition(manager: Address, factory: Address, pool: Address, gauge: Address): void {
  mockCLPositions(manager, BigInt.fromString("1000000000000000000"))
  createMockedFunction(factory, "getPool", "getPool(address,address,int24):(address)")
    .withArgs([
      ethereum.Value.fromAddress(DUMMY0),
      ethereum.Value.fromAddress(DUMMY1),
      ethereum.Value.fromI32(1)
    ])
    .returns([ethereum.Value.fromAddress(pool)])
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
  createMockedFunction(pool, "gauge", "gauge():(address)")
    .withArgs([]).returns([ethereum.Value.fromAddress(gauge)])
}

function mockAeroCLPosition(): void {
  mockCLVenuePosition(AERO_NFT_MANAGER, AERO_CL_FACTORY, AERO_CL_POOL, AERO_CL_GAUGE)
}

function mockAeroCLStaked(staked: boolean): void {
  createMockedFunction(AERO_CL_GAUGE, "stakedContains", "stakedContains(address,uint256):(bool)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE), ethereum.Value.fromUnsignedBigInt(AERO_TOKEN_ID)])
    .returns([ethereum.Value.fromBoolean(staked)])
}

function mockAeroCLEarned(amount: BigInt): void {
  const tokenIds: Array<BigInt> = [AERO_TOKEN_ID]
  createMockedFunction(AERO_CL_GAUGE, "earned", "earned(address,uint256[]):(uint256)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE), ethereum.Value.fromUnsignedBigIntArray(tokenIds)])
    .returns([ethereum.Value.fromUnsignedBigInt(amount)])
}

function openAeroCLPosition(): Bytes {
  mockAeroProtocolAeroUsdcPool() // the reward token is priced even when nothing is earned
  const mint = createNFTTransferEvent(AERO_NFT_MANAGER, Address.zero(), SERVICE_SAFE, AERO_TOKEN_ID)
  mint.block = aeroBlock()
  mint.transaction.hash = TX_HASH
  handleNFTTransfer(mint)

  const inc = createAeroIncreaseLiquidityEvent(
    AERO_NFT_MANAGER,
    AERO_TOKEN_ID,
    BigInt.fromString("1000000000000000000"),
    BigInt.fromString("1000000000000000000"), // 1 token0
    BigInt.fromString("2000000000000000000"), // 2 token1
    -10,
    10
  )
  inc.block = aeroBlock()
  inc.transaction.hash = TX_HASH
  handleAeroIncreaseLiquidity(inc)

  return Bytes.fromUTF8(SERVICE_SAFE.toHex() + "-aero-cl-42")
}

describe("Aero CL positions (AeroNFTManager)", () => {
  afterEach(() => {
    clearStore()
  })

  test("the emitting NFPM picks the venue", () => {
    assert.stringEquals("aero-cl", clVenueForManager(AERO_NFT_MANAGER).protocol)
    assert.stringEquals("aerodrome-cl", clVenueForManager(VELO_MANAGER).protocol)
  })

  test("mint + 6-arg IncreaseLiquidity creates an aero-cl position with its own mapping", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)

    const id = openAeroCLPosition()

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "protocol", "aero-cl")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "pool", AERO_CL_POOL.toHexString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    // Entry amounts come from the Aero IncreaseLiquidity event
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount0", "1")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount1", "2")
    // The mapping is keyed by the Aero label, so a Slipstream NFT with the same id can't collide
    assert.entityCount("NFTPositionMapping", 1)
    assert.fieldEquals("NFTPositionMapping", Bytes.fromUTF8("aero-cl-42").toHexString(), "positionId", id.toHexString())
    // Unstaked NFT: no rewards, and earned(address,uint256[]) (which would revert) is not called
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "0")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", AERO_CL_GAUGE.toHexString())
  })

  test("staked position reads earned(agent, [tokenId]) and prices Aero's AERO", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    const id = openAeroCLPosition()

    mockAeroCLStaked(true)
    mockAeroCLEarned(BigInt.fromString("2000000000000000000"))

    refreshVeloCLPosition(id, AERO_TOKEN_ID, aeroBlock(), TX_HASH, false)

    // 2 AERO × ≈$0.60 → ≈$1.20
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
    const pos = ProtocolPosition.load(id)!
    assert.assertTrue(pos.claimableRewardUSD!.gt(BigDecimal.fromString("1.19")))
    assert.assertTrue(pos.claimableRewardUSD!.lt(BigDecimal.fromString("1.21")))
  })

  test("a full-exit DecreaseLiquidity from the Aero NFPM closes the aero-cl position", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    const id = openAeroCLPosition()

    // All liquidity removed: positions() now reports 0. Only the Aero NFPM is mocked, so the
    // exit must read the position through the venue of the emitting manager.
    mockCLPositions(AERO_NFT_MANAGER, BigInt.zero())
    const dec = createDecreaseLiquidityEvent(
      AERO_NFT_MANAGER,
      AERO_TOKEN_ID,
      BigInt.fromString("1000000000000000000"),
      BigInt.fromString("1000000000000000000"),
      BigInt.fromString("3000000000000000000")
    )
    dec.block = aeroBlock()
    dec.transaction.hash = TX_HASH
    handleDecreaseLiquidity(dec)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "false")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "exitAmount1", "3")
  })

  test("a burn from the Aero NFPM closes the aero-cl position", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    const id = openAeroCLPosition()

    const burn = createNFTTransferEvent(AERO_NFT_MANAGER, SERVICE_SAFE, Address.zero(), AERO_TOKEN_ID)
    burn.block = aeroBlock()
    burn.transaction.hash = TX_HASH
    handleNFTTransfer(burn)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "false")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "exitTxHash", TX_HASH.toHexString())
  })

  test("a reverting stakedContains records 0 without calling earned", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    createMockedFunction(AERO_CL_GAUGE, "stakedContains", "stakedContains(address,uint256):(bool)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE), ethereum.Value.fromUnsignedBigInt(AERO_TOKEN_ID)])
      .reverts()

    // earned(address,uint256[]) is not mocked: calling it would fail the test
    const id = openAeroCLPosition()

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "0")
  })

  test("a pool with no gauge yet is not cached, and its gauge is picked up once created", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockCLVenuePosition(AERO_NFT_MANAGER, AERO_CL_FACTORY, AERO_CL_POOL, Address.zero())
    const id = openAeroCLPosition()

    assert.assertTrue(!ProtocolPosition.load(id)!.rewardsContract)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "0")

    createMockedFunction(AERO_CL_POOL, "gauge", "gauge():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(AERO_CL_GAUGE)])
    mockAeroCLStaked(true)
    mockAeroCLEarned(BigInt.fromString("2000000000000000000"))
    refreshVeloCLPosition(id, AERO_TOKEN_ID, aeroBlock(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", AERO_CL_GAUGE.toHexString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
  })

  test("a reverting gauge() is not cached, and the refresh still closes the position", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    createMockedFunction(AERO_CL_POOL, "gauge", "gauge():(address)").withArgs([]).reverts()
    const id = openAeroCLPosition()

    assert.assertTrue(!ProtocolPosition.load(id)!.rewardsContract)

    mockCLPositions(AERO_NFT_MANAGER, BigInt.zero())
    refreshVeloCLPosition(id, AERO_TOKEN_ID, aeroBlock(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "false")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "0")
    assert.assertTrue(!ProtocolPosition.load(id)!.rewardsContract)
  })

  test("an aero-cl gauge is re-read each refresh, so a replaced gauge is followed", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    const id = openAeroCLPosition()
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", AERO_CL_GAUGE.toHexString())

    const NEW_CL_GAUGE = Address.fromString("0x00000000000000000000000000000000000000e6")
    createMockedFunction(AERO_CL_POOL, "gauge", "gauge():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(NEW_CL_GAUGE)])
    createMockedFunction(NEW_CL_GAUGE, "stakedContains", "stakedContains(address,uint256):(bool)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE), ethereum.Value.fromUnsignedBigInt(AERO_TOKEN_ID)])
      .returns([ethereum.Value.fromBoolean(false)])
    refreshVeloCLPosition(id, AERO_TOKEN_ID, aeroBlock(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", NEW_CL_GAUGE.toHexString())
  })

  test("an aero-cl gauge() revert falls back to the gauge already known", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    const id = openAeroCLPosition()

    createMockedFunction(AERO_CL_POOL, "gauge", "gauge():(address)").withArgs([]).reverts()
    mockAeroCLStaked(true)
    mockAeroCLEarned(BigInt.fromString("2000000000000000000"))
    refreshVeloCLPosition(id, AERO_TOKEN_ID, aeroBlock(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", AERO_CL_GAUGE.toHexString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
  })

  test("a staked position whose earned() reverts records 0", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    const id = openAeroCLPosition()

    mockAeroCLStaked(true)
    const tokenIds: Array<BigInt> = [AERO_TOKEN_ID]
    createMockedFunction(AERO_CL_GAUGE, "earned", "earned(address,uint256[]):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE), ethereum.Value.fromUnsignedBigIntArray(tokenIds)])
      .reverts()
    refreshVeloCLPosition(id, AERO_TOKEN_ID, aeroBlock(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "0")
  })

  test("the same tokenId on both NFPMs gives two positions", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    mockLegacyCLPosition()
    mockAeroUsdcPool()

    const aeroId = openAeroCLPosition()
    const legacyId = openLegacyCLPosition()

    assert.entityCount("ProtocolPosition", 2)
    assert.fieldEquals("ProtocolPosition", aeroId.toHexString(), "protocol", "aero-cl")
    assert.fieldEquals("ProtocolPosition", legacyId.toHexString(), "protocol", "aerodrome-cl")
  })
})

const LEGACY_CL_POOL = Address.fromString("0x00000000000000000000000000000000000000f1")
const LEGACY_CL_GAUGE = Address.fromString("0x00000000000000000000000000000000000000f2")

// The legacy venue mocked on its own contracts only: VELO_MANAGER / VELO_FACTORY / the legacy
// gauge's earned(address,uint256). A venue with a swapped manager, factory or reward token misses
// these mocks (or prices the wrong token) and fails the test.
function mockLegacyCLPosition(): void {
  mockCLVenuePosition(VELO_MANAGER, VELO_FACTORY, LEGACY_CL_POOL, LEGACY_CL_GAUGE)
  createMockedFunction(LEGACY_CL_GAUGE, "earned", "earned(address,uint256):(uint256)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE), ethereum.Value.fromUnsignedBigInt(AERO_TOKEN_ID)])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("2000000000000000000"))])
}

function openLegacyCLPosition(): Bytes {
  const mint = createNFTTransferEvent(VELO_MANAGER, Address.zero(), SERVICE_SAFE, AERO_TOKEN_ID)
  mint.block = aeroBlock()
  mint.transaction.hash = TX_HASH
  handleNFTTransfer(mint)
  const inc = createIncreaseLiquidityEvent(
    VELO_MANAGER,
    AERO_TOKEN_ID,
    BigInt.fromString("1000000000000000000"),
    BigInt.fromString("1000000000000000000"),
    BigInt.fromString("2000000000000000000")
  )
  inc.block = aeroBlock()
  inc.transaction.hash = TX_HASH
  handleIncreaseLiquidity(inc)

  return Bytes.fromUTF8(SERVICE_SAFE.toHex() + "-aerodrome-cl-42")
}

describe("Legacy CL venue after the CLVenue refactor", () => {
  afterEach(() => {
    clearStore()
  })

  test("mint + 4-arg IncreaseLiquidity through the legacy NFPM keeps its label, mapping and reward token", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockLegacyCLPosition()
    mockAeroUsdcPool() // legacy AERO at ≈$1.30

    const id = openLegacyCLPosition()
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "protocol", "aerodrome-cl")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "pool", LEGACY_CL_POOL.toHexString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount0", "1")
    assert.fieldEquals("NFTPositionMapping", Bytes.fromUTF8("aerodrome-cl-42").toHexString(), "positionId", id.toHexString())
    // 2 legacy AERO × ≈$1.30
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
    const pos = ProtocolPosition.load(id)!
    assert.assertTrue(pos.claimableRewardUSD!.gt(BigDecimal.fromString("2.59")))
    assert.assertTrue(pos.claimableRewardUSD!.lt(BigDecimal.fromString("2.61")))
  })

  test("a legacy CL gauge stays cached when the pool reports another one", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockLegacyCLPosition()
    mockAeroUsdcPool()
    const id = openLegacyCLPosition()

    createMockedFunction(LEGACY_CL_POOL, "gauge", "gauge():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(DUMMY1)])
    // Reading the other gauge would record 5 rewards instead of the cached gauge's 2
    createMockedFunction(DUMMY1, "earned", "earned(address,uint256):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE), ethereum.Value.fromUnsignedBigInt(AERO_TOKEN_ID)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("5000000000000000000"))])
    refreshVeloCLPosition(id, AERO_TOKEN_ID, aeroBlock(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", LEGACY_CL_GAUGE.toHexString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
  })

  test("a legacy pool whose gauge() reverts still closes the position", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockLegacyCLPosition()
    mockAeroUsdcPool()
    createMockedFunction(LEGACY_CL_POOL, "gauge", "gauge():(address)").withArgs([]).reverts()
    const id = openLegacyCLPosition()
    assert.assertTrue(!ProtocolPosition.load(id)!.rewardsContract)

    mockCLPositions(VELO_MANAGER, BigInt.zero())
    refreshVeloCLPosition(id, AERO_TOKEN_ID, aeroBlock(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "false")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "0")
  })
})

function saveAeroV2Venue(stable: boolean): void {
  const venue = new V2PoolVenue(AERO_V2_POOL)
  venue.protocol = "aero-v2"
  venue.stable = stable
  venue.save()
}

function mockAeroV2PoolState(pool: Address, gauge: Address): void {
  createMockedFunction(pool, "balanceOf", "balanceOf(address):(uint256)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.zero())])
  createMockedFunction(pool, "totalSupply", "totalSupply():(uint256)")
    .withArgs([]).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000"))])
  createMockedFunction(pool, "getReserves", "getReserves():(uint256,uint256,uint256)")
    .withArgs([]).returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000")),
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    ])
  createMockedFunction(pool, "token0", "token0():(address)")
    .withArgs([]).returns([ethereum.Value.fromAddress(DUMMY0)])
  createMockedFunction(pool, "token1", "token1():(address)")
    .withArgs([]).returns([ethereum.Value.fromAddress(DUMMY1)])
  // Aero v2 pools have no stable()
  createMockedFunction(pool, "stable", "stable():(bool)").withArgs([]).reverts()
  createMockedFunction(gauge, "balanceOf", "balanceOf(address):(uint256)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("500"))])
}

describe("Aero v2 pools (factories + GaugeManager)", () => {
  afterEach(() => {
    clearStore()
  })

  test("PoolCreated from an Aero factory records the venue and starts the AeroV2Pool template", () => {
    const ev = createAeroV2PoolCreatedEvent(AERO_V2_STABLE_FACTORY, USDC_NATIVE, USDT, AERO_V2_POOL)
    handleAeroV2PoolCreated(ev)

    assert.fieldEquals("V2PoolVenue", AERO_V2_POOL.toHexString(), "protocol", "aero-v2")
    assert.fieldEquals("V2PoolVenue", AERO_V2_POOL.toHexString(), "stable", "true")
    assert.dataSourceCount("AeroV2Pool", 1)
  })

  test("PoolCreated from the volatile factory records stable = false", () => {
    const ev = createAeroV2PoolCreatedEvent(AERO_V2_VOLATILE_FACTORY, USDC_NATIVE, USDT, AERO_V2_POOL)
    handleAeroV2PoolCreated(ev)

    assert.fieldEquals("V2PoolVenue", AERO_V2_POOL.toHexString(), "stable", "false")
  })

  test("PoolCreated for a non-whitelisted pair is ignored", () => {
    const ev = createAeroV2PoolCreatedEvent(AERO_V2_STABLE_FACTORY, DUMMY0, DUMMY1, AERO_V2_POOL)
    handleAeroV2PoolCreated(ev)

    assert.entityCount("V2PoolVenue", 0)
  })

  test("GaugeCreated feeds the aero-v2 gauge lookup; staked LP and AERO rewards are counted", () => {
    createService(SERVICE_SAFE)
    saveAeroV2Venue(false)
    handleAeroGaugeCreated(createGaugeCreatedEvent(AERO_V2_POOL, AERO_V2_GAUGE))
    mockAeroV2PoolState(AERO_V2_POOL, AERO_V2_GAUGE)
    mockAeroProtocolAeroUsdcPool()
    createMockedFunction(AERO_V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("2000000000000000000"))])

    // VELO_VOTER.gauges is deliberately not mocked: the aero-v2 path must not call it.
    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, aeroBlock(), TX_HASH, false)

    const id = getVeloV2PositionId(SERVICE_SAFE, AERO_V2_POOL)
    assert.stringEquals(
      SERVICE_SAFE.toHex() + "-aero-v2-" + AERO_V2_POOL.toHex(),
      id.toString()
    )
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "protocol", "aero-v2")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "liquidity", "500")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", AERO_V2_GAUGE.toHexString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
    const pos = ProtocolPosition.load(id)!
    assert.assertTrue(pos.claimableRewardUSD!.gt(BigDecimal.fromString("1.19")))
    assert.assertTrue(pos.claimableRewardUSD!.lt(BigDecimal.fromString("1.21")))
  })

  test("an Aero v2 pool with no gauge yet is valued from LP alone, without the Voter", () => {
    createService(SERVICE_SAFE)
    saveAeroV2Venue(false)
    mockAeroV2PoolState(AERO_V2_POOL, AERO_V2_GAUGE)
    createMockedFunction(AERO_V2_POOL, "balanceOf", "balanceOf(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("500"))])

    // No GaugeCreated, and VELO_VOTER.gauges is not mocked: falling through to it fails the test
    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, aeroBlock(), TX_HASH, false)

    const id = getVeloV2PositionId(SERVICE_SAFE, AERO_V2_POOL)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "liquidity", "500")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "0")
    assert.assertTrue(!ProtocolPosition.load(id)!.rewardsContract)
  })

  test("a Burn from an Aero v2 pool closes the aero-v2 position", () => {
    createService(SERVICE_SAFE)
    saveAeroV2Venue(false)
    mockAeroV2PoolState(AERO_V2_POOL, AERO_V2_GAUGE)
    createMockedFunction(AERO_V2_POOL, "balanceOf", "balanceOf(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(500))])
    const transfer = createV2TransferEvent(AERO_V2_POOL, Address.zero(), SERVICE_SAFE, BigInt.fromI32(500))
    transfer.block = aeroBlock()
    transfer.transaction.hash = TX_HASH
    handleVeloV2Transfer(transfer)
    const id = Bytes.fromUTF8(SERVICE_SAFE.toHex() + "-aero-v2-" + AERO_V2_POOL.toHex())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")

    // All LP burned: the safe holds none and there is no gauge to hold it
    createMockedFunction(AERO_V2_POOL, "balanceOf", "balanceOf(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.zero())])
    const burn = createV2BurnEvent(
      AERO_V2_POOL,
      ROUTER,
      SERVICE_SAFE,
      BigInt.fromString("1000000000000000000"),
      BigInt.fromString("3000000000000000000")
    )
    burn.block = aeroBlock()
    burn.transaction.hash = TX_HASH
    handleVeloV2Burn(burn)

    assert.entityCount("ProtocolPosition", 1)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "false")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "exitAmount0", "1")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "exitAmount1", "3")
  })

  test("a later GaugeCreated for the same pool replaces the gauge", () => {
    createService(SERVICE_SAFE)
    saveAeroV2Venue(false)
    handleAeroGaugeCreated(createGaugeCreatedEvent(AERO_V2_POOL, AERO_V2_GAUGE))
    mockAeroV2PoolState(AERO_V2_POOL, AERO_V2_GAUGE)
    createMockedFunction(AERO_V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)]).reverts()
    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, aeroBlock(), TX_HASH, false)

    const NEW_GAUGE = Address.fromString("0x00000000000000000000000000000000000000e5")
    handleAeroGaugeCreated(createGaugeCreatedEvent(AERO_V2_POOL, NEW_GAUGE))
    mockAeroV2PoolState(AERO_V2_POOL, NEW_GAUGE)
    createMockedFunction(NEW_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)]).reverts()
    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, aeroBlock(), TX_HASH, false)

    const id = getVeloV2PositionId(SERVICE_SAFE, AERO_V2_POOL)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", NEW_GAUGE.toHexString())
  })

  test("Aero's 4-arg Mint sets entry amounts", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroUsdcPool()
    saveAeroV2Venue(false)
    // token0 = legacy AERO (priced ~$1.30) so entryAmountUSD is non-zero, as in the legacy Mint test
    createMockedFunction(AERO_V2_POOL, "token0", "token0():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(AERO)])
    createMockedFunction(AERO_V2_POOL, "token1", "token1():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(DUMMY1)])
    createMockedFunction(AERO_V2_POOL, "stable", "stable():(bool)").withArgs([]).reverts()
    createMockedFunction(AERO_V2_POOL, "balanceOf", "balanceOf(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(500))])
    createMockedFunction(AERO_V2_POOL, "totalSupply", "totalSupply():(uint256)")
      .withArgs([]).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000))])
    createMockedFunction(AERO_V2_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
      .withArgs([]).returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("2000000000000000000")),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("4000000000000000000")),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero())
      ])

    const transfer = createV2TransferEvent(AERO_V2_POOL, Address.zero(), SERVICE_SAFE, BigInt.fromI32(500))
    transfer.block = aeroBlock()
    transfer.transaction.hash = TX_HASH
    handleVeloV2Transfer(transfer)

    const mint = createAeroV2MintEvent(
      AERO_V2_POOL,
      ROUTER,
      SERVICE_SAFE,
      BigInt.fromString("2000000000000000000"),
      BigInt.fromString("6000000000000000000")
    )
    mint.block = aeroBlock()
    mint.transaction.hash = TX_HASH
    handleAeroV2Mint(mint)

    const id = getVeloV2PositionId(SERVICE_SAFE, AERO_V2_POOL)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "protocol", "aero-v2")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount0", "2")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount1", "6")
    assert.entityCount("PendingMintPosition", 0)
    // Aero v2 pools have no stable() (mocked to revert); the fee comes from the venue row
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "fee", "30")
  })

  test("a stable Aero v2 venue gives fee 5", () => {
    createService(SERVICE_SAFE)
    saveAeroV2Venue(true)
    handleAeroGaugeCreated(createGaugeCreatedEvent(AERO_V2_POOL, AERO_V2_GAUGE))
    mockAeroV2PoolState(AERO_V2_POOL, AERO_V2_GAUGE)
    createMockedFunction(AERO_V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)]).reverts()

    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, aeroBlock(), TX_HASH, false)

    // stable() is mocked to revert, so 5 can only come from the venue row
    const id = getVeloV2PositionId(SERVICE_SAFE, AERO_V2_POOL)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "fee", "5")
  })
})

function mockStableFeed(feed: Address, answer: BigInt, updatedAt: BigInt): void {
  createMockedFunction(feed, "latestRoundData", "latestRoundData():(uint80,int256,uint256,uint256,uint80)")
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
      ethereum.Value.fromSignedBigInt(answer),
      ethereum.Value.fromUnsignedBigInt(updatedAt),
      ethereum.Value.fromUnsignedBigInt(updatedAt),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))
    ])
}

describe("Chainlink-priced stablecoins (feed first, pool fallback)", () => {
  afterEach(() => {
    clearStore()
  })

  test("new stables price off their own feed, never the $1 USDC reference", () => {
    const tokens: Address[] = [USDT, DAI, USDE, USDS]
    for (let i = 0; i < tokens.length; i++) {
      const cfg = changetype<TokenConfig>(getTokenConfig(tokens[i]))
      assert.stringEquals("chainlink", cfg.priceSources[0].sourceType)
      assert.i32Equals(1, cfg.priceSources[0].priority)
    }
    // USDT falls back to its Aero CL pool vs USDC; DAI, USDe and USDS are feed-only
    const usdt = changetype<TokenConfig>(getTokenConfig(USDT))
    assert.stringEquals("velodrome_slipstream", usdt.priceSources[1].sourceType)
    assert.i32Equals(2, usdt.priceSources[1].priority)
    const feedOnly: Address[] = [DAI, USDE, USDS]
    for (let i = 0; i < feedOnly.length; i++) {
      assert.i32Equals(1, changetype<TokenConfig>(getTokenConfig(feedOnly[i])).priceSources.length)
    }
  })

  test("a valid feed price is used and the fallback pool is not read", () => {
    // $0.998 from the feed; USDT_FALLBACK_POOL is not mocked, so reading it would fail the test
    mockStableFeed(USDT_USD_FEED, BigInt.fromI32(99800000), BLOCK_TIMESTAMP)
    const price = getTokenPriceUSD(USDT, BLOCK_TIMESTAMP, true)
    assert.stringEquals("0.998", price.toString())
  })

  test("a reverting feed falls back to the Aero USDC/USDT pool", () => {
    createMockedFunction(USDT_USD_FEED, "latestRoundData", "latestRoundData():(uint80,int256,uint256,uint256,uint80)")
      .withArgs([]).reverts()
    // USDC (0x8335…) is token0, USDT (0xfde4…) token1; sqrtPriceX96 = 2^96 → 1 USDT = 1 USDC
    createMockedFunction(USDT_FALLBACK_POOL, "slot0", "slot0():(uint160,int24,uint16,uint16,uint16,bool)")
      .withArgs([])
      .returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("79228162514264337593543950336")),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromI32(0),
        ethereum.Value.fromBoolean(true)
      ])
    createMockedFunction(USDT_FALLBACK_POOL, "token0", "token0():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(USDC_NATIVE)])
    createMockedFunction(USDT_FALLBACK_POOL, "token1", "token1():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(USDT)])

    const price = getTokenPriceUSD(USDT, BLOCK_TIMESTAMP, true)
    assert.stringEquals("1", price.toString())
    // The PriceUpdate is attributed to the pool that priced it, not the (failed) feed
    const updateId = USDT.concat(Bytes.fromUTF8(BLOCK_TIMESTAMP.toString()))
    assert.fieldEquals("PriceUpdate", updateId.toHexString(), "source", USDT_FALLBACK_POOL.toHexString())
  })

  test("a USDe depeg reported by its feed is kept", () => {
    mockStableFeed(USDE_USD_FEED, BigInt.fromI32(93000000), BLOCK_TIMESTAMP) // $0.93
    assert.stringEquals("0.93", getTokenPriceUSD(USDE, BLOCK_TIMESTAMP, true).toString())
  })

  test("a USDT or DAI depeg reported by its own feed is kept", () => {
    // $0.93; USDT's fallback pool is not mocked, so a rejected feed fails the test
    mockStableFeed(USDT_USD_FEED, BigInt.fromI32(93000000), BLOCK_TIMESTAMP)
    assert.stringEquals("0.93", getTokenPriceUSD(USDT, BLOCK_TIMESTAMP, true).toString())
    mockStableFeed(DAI_USD_FEED, BigInt.fromI32(93000000), BLOCK_TIMESTAMP)
    assert.stringEquals("0.93", getTokenPriceUSD(DAI, BLOCK_TIMESTAMP, true).toString())
  })

  test("a deep depeg has no floor: a $0.40 feed price is kept", () => {
    mockStableFeed(USDE_USD_FEED, BigInt.fromI32(40000000), BLOCK_TIMESTAMP) // $0.40
    assert.stringEquals("0.4", getTokenPriceUSD(USDE, BLOCK_TIMESTAMP, true).toString())
  })

  test("USDT, DAI, USDe and USDS priced below $0.98 are marked depegged", () => {
    const tokens: Address[] = [USDT, DAI, USDE, USDS]
    const feeds: Address[] = [USDT_USD_FEED, DAI_USD_FEED, USDE_USD_FEED, USDS_USD_FEED]
    for (let i = 0; i < tokens.length; i++) {
      mockStableFeed(feeds[i], BigInt.fromI32(97900000), BLOCK_TIMESTAMP) // $0.979
      getTokenPriceUSD(tokens[i], BLOCK_TIMESTAMP, true)
      assert.fieldEquals("Token", tokens[i].toHexString(), "depegged", "true")
    }
  })

  test("USDT, DAI, USDe and USDS at $0.98 are not depegged", () => {
    const tokens: Address[] = [USDT, DAI, USDE, USDS]
    const feeds: Address[] = [USDT_USD_FEED, DAI_USD_FEED, USDE_USD_FEED, USDS_USD_FEED]
    for (let i = 0; i < tokens.length; i++) {
      mockStableFeed(feeds[i], BigInt.fromI32(98000000), BLOCK_TIMESTAMP) // $0.98
      getTokenPriceUSD(tokens[i], BLOCK_TIMESTAMP, true)
      assert.fieldEquals("Token", tokens[i].toHexString(), "depegged", "false")
    }
  })

  test("a 24h-heartbeat feed just past 86400s old is still accepted", () => {
    // updatedAt 86500s before the block: over a bare 24h threshold, inside the 90000s grace
    mockStableFeed(USDS_USD_FEED, BigInt.fromI32(99900000), BLOCK_TIMESTAMP.minus(BigInt.fromI32(86500)))
    assert.stringEquals("0.999", getTokenPriceUSD(USDS, BLOCK_TIMESTAMP, true).toString())
  })

  test("a feed answer exactly 90000s old is still accepted", () => {
    mockStableFeed(USDS_USD_FEED, BigInt.fromI32(99900000), BLOCK_TIMESTAMP.minus(BigInt.fromI32(90000)))
    assert.stringEquals("0.999", getTokenPriceUSD(USDS, BLOCK_TIMESTAMP, true).toString())
  })

  test("a feed answer older than 90000s is rejected", () => {
    mockStableFeed(USDS_USD_FEED, BigInt.fromI32(99900000), BLOCK_TIMESTAMP.minus(BigInt.fromI32(90001)))
    assert.stringEquals("0", getTokenPriceUSD(USDS, BLOCK_TIMESTAMP, true).toString())
  })

  test("Aero's AERO is tracked alongside the legacy AERO", () => {
    const cfg = changetype<TokenConfig>(getTokenConfig(AERO_PROTOCOL_AERO))
    assert.stringEquals("velodrome_v2", cfg.priceSources[0].sourceType)
    assert.stringEquals(AERO_PROTOCOL_AERO_PRICE_POOL.toHexString(), cfg.priceSources[0].address.toHexString())
    assert.assertNotNull(getTokenConfig(AERO))
  })
})

describe("refreshAllActivePositions dispatch (snapshot refresh)", () => {
  afterEach(() => {
    clearStore()
  })

  test("refreshes active aero-cl and aero-v2 positions", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()

    // aero-cl, opened unstaked so its reward starts at 0
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    const clId = openAeroCLPosition()

    // aero-v2, opened while earned() reverts so its reward starts at 0
    saveAeroV2Venue(false)
    handleAeroGaugeCreated(createGaugeCreatedEvent(AERO_V2_POOL, AERO_V2_GAUGE))
    mockAeroV2PoolState(AERO_V2_POOL, AERO_V2_GAUGE)
    createMockedFunction(AERO_V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)]).reverts()
    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, aeroBlock(), TX_HASH, false)
    const v2Id = getVeloV2PositionId(SERVICE_SAFE, AERO_V2_POOL)
    assert.fieldEquals("ProtocolPosition", clId.toHexString(), "claimableReward", "0")
    assert.fieldEquals("ProtocolPosition", v2Id.toHexString(), "claimableReward", "0")

    // Both now have 2 AERO claimable; only the snapshot refresh can pick that up
    mockAeroCLStaked(true)
    mockAeroCLEarned(BigInt.fromString("2000000000000000000"))
    createMockedFunction(AERO_V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("2000000000000000000"))])

    refreshAllActivePositions(SERVICE_SAFE, aeroBlock(), false)

    assert.fieldEquals("ProtocolPosition", clId.toHexString(), "claimableReward", "2")
    assert.fieldEquals("ProtocolPosition", v2Id.toHexString(), "claimableReward", "2")
  })
})
