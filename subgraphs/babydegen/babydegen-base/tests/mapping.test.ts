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
import { calculatePositionROI } from "../src/roiCalculation"
import { ProtocolPosition } from "../generated/schema"
import { USDC_NATIVE, WETH, AERO, BOLD } from "../src/constants"
import {
  createRegisterInstanceEvent,
  createCreateMultisigWithAgentsEvent
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
