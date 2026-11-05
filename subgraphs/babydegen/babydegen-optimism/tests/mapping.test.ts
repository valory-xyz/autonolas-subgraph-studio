import {
  assert,
  describe,
  test,
  clearStore,
  afterEach,
  createMockedFunction
} from "matchstick-as/assembly/index"
import { newMockEvent } from "matchstick-as/assembly/index"
import { Address, BigInt, BigDecimal, Bytes, ethereum } from "@graphprotocol/graph-ts"
import {
  handleRegisterInstance,
  handleCreateMultisigWithAgents
} from "../src/serviceRegistry"
import { refreshVeloV2Position, getVeloV2PositionId } from "../src/veloV2Shared"
import { refreshAllActivePositions } from "../src/helpers"
import { ProtocolPosition, Service, V2PoolVenue } from "../generated/schema"
import { handleNFTTransfer, handleAeroIncreaseLiquidity, handleDecreaseLiquidity, handleIncreaseLiquidity, handleCollect } from "../src/veloNFTManager"
import { Collect } from "../generated/VeloNFTManager/VelodromePositionNFTManager"
import { refreshVeloCLPosition, clVenueForManager } from "../src/veloCLShared"
import { handleVeloV2Transfer, handleVeloV2Burn, handleAeroV2Mint } from "../src/veloV2Pool"
import { handleAeroV2PoolCreated } from "../src/veloV2Factory"
import { handleAeroGaugeCreated } from "../src/aeroGaugeManager"
import { getTokenConfig, TokenConfig } from "../src/tokenConfig"
import { getTokenPriceUSD } from "../src/priceDiscovery"
import { calculatePositionROI, initializePositionIncome } from "../src/roiCalculation"
import {
  VELO,
  VELO_VOTER,
  VELO_MANAGER,
  VELO_FACTORY,
  BOLD,
  BOLD_V2,
  USDS,
  XAERO,
  AERO_NFT_MANAGER,
  AERO_CL_FACTORY,
  AERO_V2_STABLE_FACTORY,
  AERO_V2_VOLATILE_FACTORY,
  WHITELISTED_TOKENS
} from "../src/constants"
import { mockUsdcUsd, seedPosition, seedAddressType, seededAddressType, newTransfer, newReceipt } from "./fixtures"
import { processERC20Transfer } from "../src/tokenBalances"
import { PROTOCOL_VELODROME_V3 } from "../src/constants"
import { ClaimableRewardBeforeBlock } from "../generated/schema"
import {
  createRegisterInstanceEvent,
  createCreateMultisigWithAgentsEvent,
  createV2TransferEvent,
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
  EXCLUDED_SERVICE_ID,
  OPTIMUS_AGENT_ID,
  NON_OPTIMUS_AGENT_ID,
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
  agentId: BigInt = OPTIMUS_AGENT_ID
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

  test("ignores non-Optimus agent IDs", () => {
    registerService(SERVICE_ID, NON_OPTIMUS_AGENT_ID)

    assert.entityCount("ServiceRegistration", 0)
  })

  test("ignores excluded service IDs", () => {
    // Service ID 29 is in the EXCLUDED_SERVICE_IDS list
    registerService(EXCLUDED_SERVICE_ID, OPTIMUS_AGENT_ID)

    assert.entityCount("ServiceRegistration", 0)
  })

  test("overwrites registration for same service ID", () => {
    // First registration
    registerService()

    // Second registration with a different block number
    let event = createRegisterInstanceEvent(
      OPERATOR_SAFE,
      SERVICE_ID,
      AGENT_INSTANCE,
      OPTIMUS_AGENT_ID
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

  test("a later RegisterInstance adds its agent EOA to the existing Service", () => {
    mockChainlinkEthUsd()
    registerService()
    let multisig = createCreateMultisigWithAgentsEvent(SERVICE_ID, SERVICE_SAFE)
    multisig.block.number = BLOCK_NUMBER
    multisig.block.timestamp = BLOCK_TIMESTAMP
    handleCreateMultisigWithAgents(multisig)
    let second = Address.fromString("0x00000000000000000000000000000000000000a2")
    let reRegistration = createRegisterInstanceEvent(OPERATOR_SAFE, SERVICE_ID, second, OPTIMUS_AGENT_ID)
    reRegistration.block.number = BLOCK_NUMBER
    reRegistration.block.timestamp = BLOCK_TIMESTAMP
    handleRegisterInstance(reRegistration)

    assert.fieldEquals("Service", SERVICE_SAFE.toHexString(), "agentInstances",
      "[" + AGENT_INSTANCE.toHexString() + ", " + second.toHexString() + "]")
  })

  test("a multisig re-created for an existing Service takes the registration's agent EOAs", () => {
    mockChainlinkEthUsd()
    registerService()
    createService(SERVICE_SAFE)
    let existing = Service.load(SERVICE_SAFE)!
    existing.agentInstances = []
    existing.save()
    let multisig = createCreateMultisigWithAgentsEvent(SERVICE_ID, SERVICE_SAFE)
    multisig.block.number = BLOCK_NUMBER
    multisig.block.timestamp = BLOCK_TIMESTAMP
    handleCreateMultisigWithAgents(multisig)

    assert.fieldEquals("Service", SERVICE_SAFE.toHexString(), "agentInstances", "[" + AGENT_INSTANCE.toHexString() + "]")
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

  test("does nothing for excluded service IDs", () => {
    mockChainlinkEthUsd()

    // Register first (will be skipped because excluded)
    registerService(EXCLUDED_SERVICE_ID, OPTIMUS_AGENT_ID)
    assert.entityCount("ServiceRegistration", 0)

    let event = createCreateMultisigWithAgentsEvent(
      EXCLUDED_SERVICE_ID,
      SERVICE_SAFE
    )
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
// Velodrome V2 gauge-staked positions (veloV2Shared.ts)
//
// When an Optimus agent stakes its V2 LP into a gauge, the LP ERC20 leaves the
// safe (pool.balanceOf(safe) -> 0). Before the fix this marked the position
// closed/zero; now we resolve the pool's gauge via the Voter and count
// gauge.balanceOf(safe) as staked LP, plus gauge.earned(safe) as claimable VELO.
// ---------------------------------------------------------------------------
const V2_POOL = Address.fromString("0x58e6433a6903886e440ddf519ecc573c4046a6b2")
const V2_GAUGE = Address.fromString("0x8329c9c93b63db8a56a3b9a0c44c2edabd6572a8")
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

// Pre-create an existing V2 position so refreshVeloV2Position takes the "existing" path.
function makeOpenV2Position(token0: Address, token1: Address): Bytes {
  const id = getVeloV2PositionId(SERVICE_SAFE, V2_POOL)
  const p = new ProtocolPosition(id)
  p.agent = SERVICE_SAFE
  p.service = SERVICE_SAFE
  p.protocol = "velodrome-v2"
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

// VELO/USDC velodrome_v2 source from tokenConfig.ts. Must match the VELO price-source pool
// there — if tokenConfig changes the source, update this address (see review nit #6).
const VELO_PRICE_POOL = Address.fromString("0xa0A215dE234276CAc1b844fD58901351a50fec8A")
const USDC_OP = Address.fromString("0x0b2c639c533813f4aa9d7837caf62653d097ff85")

function mockVeloUsdcPool(): void {
  mockUsdcUsd()
  // On-chain ordering: USDC (0x0b2c…) < VELO (0x9560…), so USDC is token0. Mock it that way
  // so the test exercises the same getVelodromeV2Price branch production hits.
  createMockedFunction(VELO_PRICE_POOL, "token0", "token0():(address)")
    .withArgs([])
    .returns([ethereum.Value.fromAddress(USDC_OP)])
  createMockedFunction(VELO_PRICE_POOL, "token1", "token1():(address)")
    .withArgs([])
    .returns([ethereum.Value.fromAddress(VELO)])
  // reserve0 = 1.3e12 USDC (1.3M @6dec), reserve1 = 1e24 VELO (1M @18dec) → VELO ≈ $1.30
  // A volatile pool: priced from its reserves
  createMockedFunction(VELO_PRICE_POOL, "stable", "stable():(bool)").withArgs([]).returns([ethereum.Value.fromBoolean(false)])
  createMockedFunction(VELO_PRICE_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
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
  const ev = createRegisterInstanceEvent(OPERATOR_SAFE, SERVICE_ID, AGENT_INSTANCE, OPTIMUS_AGENT_ID)
  ev.block.number = BLOCK_NUMBER
  ev.block.timestamp = BLOCK_TIMESTAMP
  return ev.block
}

describe("Velodrome V2 gauge-staked positions", () => {
  afterEach(() => {
    clearStore()
  })

  test("staked position (LP left the safe) stays active, valued by gauge balance", () => {
    createService(SERVICE_SAFE)
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    mockV2PoolState()
    // No claimable rewards this refresh → reward block is skipped (no VELO pricing needed)
    createMockedFunction(V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .reverts()

    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    // Despite pool.balanceOf(safe) == 0, the position is NOT closed: the gauge holds 500 LP.
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "liquidity", "500")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableRewardUSD", "0")
  })

  test("claimable VELO gauge rewards fold into usdCurrentWithRewards", () => {
    createService(SERVICE_SAFE)
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    mockV2PoolState()
    mockVeloUsdcPool()
    // 2 VELO claimable (2e18 wei)
    createMockedFunction(V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("2000000000000000000"))])

    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    // claimableReward = 2e18 / 1e18 = 2 VELO; VELO priced ~1.3 here → rewardUSD ~2.6.
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
    const pos = ProtocolPosition.load(id)!
    assert.assertTrue(pos.claimableRewardUSD!.gt(BigDecimal.fromString("2.59")))
    assert.assertTrue(pos.claimableRewardUSD!.lt(BigDecimal.fromString("2.61")))
    // usdCurrent is 0 (dummy tokens), so usdCurrentWithRewards == rewardUSD ~2.6.
    assert.assertTrue(pos.usdCurrentWithRewards.gt(BigDecimal.fromString("2.59")))
    assert.assertTrue(pos.usdCurrentWithRewards.lt(BigDecimal.fromString("2.61")))
  })

  test("a re-entered pool starts its income from zero, so the next close counts only its own", () => {
    createService(SERVICE_SAFE)
    const id = makeOpenV2Position(DUMMY0, DUMMY1)
    // The first cycle closed with $2 of fees and $5 of rewards credited after its exit
    const closed = ProtocolPosition.load(id)!
    closed.isActive = false
    closed.collectedFeesUSD = BigDecimal.fromString("2")
    closed.claimedRewardsUSD = BigDecimal.fromString("5")
    closed.save()
    // Re-entry: the gauge holds LP again
    mockV2PoolState()
    createMockedFunction(V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .reverts()

    refreshVeloV2Position(SERVICE_SAFE, V2_POOL, v2Block(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "collectedFeesUSD", "0")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimedRewardsUSD", "0")
    // Second close: $110 out against the $100 in
    const reentered = ProtocolPosition.load(id)!
    reentered.isActive = false
    reentered.exitAmountUSD = BigDecimal.fromString("110")
    calculatePositionROI(reentered)
    assert.stringEquals(reentered.grossGainUSD.toString(), "110")
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
// Aero (merged protocol) — CL positions, v2 pools, xAERO rewards, new tokens
// ---------------------------------------------------------------------------
const AERO_TOKEN_ID = BigInt.fromI32(42)
const AERO_CL_POOL = Address.fromString("0x00000000000000000000000000000000000000e1")
const AERO_CL_GAUGE = Address.fromString("0x00000000000000000000000000000000000000e2")
const AERO_V2_POOL = Address.fromString("0x00000000000000000000000000000000000000e3")
const AERO_V2_GAUGE = Address.fromString("0x00000000000000000000000000000000000000e4")
const ROUTER = Address.fromString("0x00000000000000000000000000000000000000d2")

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
  const mint = createNFTTransferEvent(AERO_NFT_MANAGER, Address.zero(), SERVICE_SAFE, AERO_TOKEN_ID)
  mint.block = v2Block()
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
  inc.block = v2Block()
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
    assert.stringEquals("velodrome-v3", clVenueForManager(VELO_MANAGER).protocol)
  })

  test("mint + 6-arg IncreaseLiquidity creates an aero-cl position with its own mapping", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)

    const id = openAeroCLPosition()

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "protocol", "aero-cl")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "pool", AERO_CL_POOL.toHexString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount0", "1")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount1", "2")
    assert.entityCount("NFTPositionMapping", 1)
    assert.fieldEquals("NFTPositionMapping", Bytes.fromUTF8("aero-cl-42").toHexString(), "positionId", id.toHexString())
    // Unstaked NFT: no rewards, and earned(address,uint256[]) (which would revert) is not called
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "0")
  })

  test("staked position records its xAERO amount from earned(agent, [tokenId]) at $0", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    const id = openAeroCLPosition()

    mockAeroCLStaked(true)
    mockAeroCLEarned(BigInt.fromString("2000000000000000000"))

    refreshVeloCLPosition(id, AERO_TOKEN_ID, v2Block(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableRewardUSD", "0")
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
    dec.block = v2Block()
    dec.transaction.hash = TX_HASH
    handleDecreaseLiquidity(dec)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "false")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "exitAmount1", "3")
  })

  test("a Collect after the full exit leaves the exit amounts its DecreaseLiquidity recorded", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    const id = openAeroCLPosition()
    mockCLPositions(AERO_NFT_MANAGER, BigInt.zero())
    const dec = createDecreaseLiquidityEvent(
      AERO_NFT_MANAGER,
      AERO_TOKEN_ID,
      BigInt.fromString("1000000000000000000"),
      BigInt.fromString("1000000000000000000"),
      BigInt.fromString("3000000000000000000")
    )
    dec.block = v2Block()
    dec.transaction.hash = TX_HASH
    handleDecreaseLiquidity(dec)

    // positions() still answers (liquidity 0), so a refresh here would overwrite the exit with 0
    const collect = changetype<Collect>(newMockEvent())
    collect.address = AERO_NFT_MANAGER
    collect.parameters = new Array()
    collect.parameters.push(new ethereum.EventParam("tokenId", ethereum.Value.fromUnsignedBigInt(AERO_TOKEN_ID)))
    collect.parameters.push(new ethereum.EventParam("recipient", ethereum.Value.fromAddress(SERVICE_SAFE)))
    collect.parameters.push(new ethereum.EventParam("amount0", ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000"))))
    collect.parameters.push(new ethereum.EventParam("amount1", ethereum.Value.fromUnsignedBigInt(BigInt.fromString("3000000000000000000"))))
    collect.block = v2Block()
    collect.transaction.hash = TX_HASH
    handleCollect(collect)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "exitAmount1", "3")
  })

  test("a burn from the Aero NFPM closes the aero-cl position", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    const id = openAeroCLPosition()

    const burn = createNFTTransferEvent(AERO_NFT_MANAGER, SERVICE_SAFE, Address.zero(), AERO_TOKEN_ID)
    burn.block = v2Block()
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
    refreshVeloCLPosition(id, AERO_TOKEN_ID, v2Block(), TX_HASH, false)

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
    refreshVeloCLPosition(id, AERO_TOKEN_ID, v2Block(), TX_HASH, false)

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
    refreshVeloCLPosition(id, AERO_TOKEN_ID, v2Block(), TX_HASH, false)

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
    refreshVeloCLPosition(id, AERO_TOKEN_ID, v2Block(), TX_HASH, false)

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
    refreshVeloCLPosition(id, AERO_TOKEN_ID, v2Block(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "0")
  })

  test("the same tokenId on both NFPMs gives two positions", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockAeroCLPosition()
    mockAeroCLStaked(false)
    mockLegacyCLPosition()
    mockVeloUsdcPool()

    const aeroId = openAeroCLPosition()
    const legacyId = openLegacyCLPosition()

    assert.entityCount("ProtocolPosition", 2)
    assert.fieldEquals("ProtocolPosition", aeroId.toHexString(), "protocol", "aero-cl")
    assert.fieldEquals("ProtocolPosition", legacyId.toHexString(), "protocol", "velodrome-v3")
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
  mint.block = v2Block()
  mint.transaction.hash = TX_HASH
  handleNFTTransfer(mint)
  const inc = createIncreaseLiquidityEvent(
    VELO_MANAGER,
    AERO_TOKEN_ID,
    BigInt.fromString("1000000000000000000"),
    BigInt.fromString("1000000000000000000"),
    BigInt.fromString("2000000000000000000")
  )
  inc.block = v2Block()
  inc.transaction.hash = TX_HASH
  handleIncreaseLiquidity(inc)

  return Bytes.fromUTF8(SERVICE_SAFE.toHex() + "-velodrome-v3-42")
}

describe("Legacy CL venue after the CLVenue refactor", () => {
  afterEach(() => {
    clearStore()
  })

  test("a claim is split by what each position had earned before its block's first refresh", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockLegacyCLPosition()
    mockVeloUsdcPool()
    const a = openLegacyCLPosition() // claimable 2
    const b = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(43), DUMMY0, DUMMY1, LEGACY_CL_GAUGE, BigInt.fromI32(1), "1")
    // A row from an earlier block says nothing about this block
    const stale = new ClaimableRewardBeforeBlock(b.id)
    stale.block = BLOCK_NUMBER
    stale.claimableReward = BigDecimal.fromString("9")
    stale.save()

    // In the claim's block a refresh reads earned() = 0 before the reward Transfer is handled
    const claimBlock = v2Block()
    claimBlock.number = BLOCK_NUMBER.plus(BigInt.fromI32(1))
    createMockedFunction(LEGACY_CL_GAUGE, "earned", "earned(address,uint256):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE), ethereum.Value.fromUnsignedBigInt(AERO_TOKEN_ID)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.zero())])
    refreshVeloCLPosition(a, AERO_TOKEN_ID, claimBlock, TX_HASH, false)
    assert.fieldEquals("ProtocolPosition", a.toHexString(), "claimableReward", "0")

    seedAddressType(LEGACY_CL_GAUGE, true, false)
    const claim = newTransfer(VELO, LEGACY_CL_GAUGE, SERVICE_SAFE, BigInt.fromString("3000000000000000000"), 1, newReceipt([]))
    claim.block.number = claimBlock.number
    processERC20Transfer(claim, seededAddressType)

    assert.fieldEquals("ProtocolPosition", a.toHexString(), "claimedRewards", "2")
    assert.fieldEquals("ProtocolPosition", b.id.toHexString(), "claimedRewards", "1")
  })

  test("mint + 4-arg IncreaseLiquidity through the legacy NFPM keeps its label, mapping and reward token", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockLegacyCLPosition()
    mockVeloUsdcPool() // VELO at ≈$1.30

    const id = openLegacyCLPosition()
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "protocol", "velodrome-v3")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "pool", LEGACY_CL_POOL.toHexString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "entryAmount0", "1")
    assert.fieldEquals("NFTPositionMapping", Bytes.fromUTF8("velodrome-v3-42").toHexString(), "positionId", id.toHexString())
    // 2 VELO × ≈$1.30
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
    const pos = ProtocolPosition.load(id)!
    assert.assertTrue(pos.claimableRewardUSD!.gt(BigDecimal.fromString("2.59")))
    assert.assertTrue(pos.claimableRewardUSD!.lt(BigDecimal.fromString("2.61")))
  })

  test("a legacy CL gauge stays cached when the pool reports another one", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockLegacyCLPosition()
    mockVeloUsdcPool()
    const id = openLegacyCLPosition()

    createMockedFunction(LEGACY_CL_POOL, "gauge", "gauge():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(DUMMY1)])
    // Reading the other gauge would record 5 rewards instead of the cached gauge's 2
    createMockedFunction(DUMMY1, "earned", "earned(address,uint256):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE), ethereum.Value.fromUnsignedBigInt(AERO_TOKEN_ID)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("5000000000000000000"))])
    refreshVeloCLPosition(id, AERO_TOKEN_ID, v2Block(), TX_HASH, false)

    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", LEGACY_CL_GAUGE.toHexString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
  })

  test("a legacy pool whose gauge() reverts still closes the position", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockLegacyCLPosition()
    mockVeloUsdcPool()
    createMockedFunction(LEGACY_CL_POOL, "gauge", "gauge():(address)").withArgs([]).reverts()
    const id = openLegacyCLPosition()
    assert.assertTrue(!ProtocolPosition.load(id)!.rewardsContract)

    mockCLPositions(VELO_MANAGER, BigInt.zero())
    refreshVeloCLPosition(id, AERO_TOKEN_ID, v2Block(), TX_HASH, false)

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
    const ev = createAeroV2PoolCreatedEvent(AERO_V2_STABLE_FACTORY, BOLD_V2, USDC_OP, AERO_V2_POOL)
    handleAeroV2PoolCreated(ev)

    assert.fieldEquals("V2PoolVenue", AERO_V2_POOL.toHexString(), "protocol", "aero-v2")
    assert.fieldEquals("V2PoolVenue", AERO_V2_POOL.toHexString(), "stable", "true")
    assert.dataSourceCount("AeroV2Pool", 1)
  })

  test("PoolCreated from the volatile factory records stable = false", () => {
    const ev = createAeroV2PoolCreatedEvent(AERO_V2_VOLATILE_FACTORY, BOLD_V2, USDC_OP, AERO_V2_POOL)
    handleAeroV2PoolCreated(ev)

    assert.fieldEquals("V2PoolVenue", AERO_V2_POOL.toHexString(), "stable", "false")
  })

  test("PoolCreated for a non-whitelisted pair is ignored", () => {
    const ev = createAeroV2PoolCreatedEvent(AERO_V2_STABLE_FACTORY, DUMMY0, DUMMY1, AERO_V2_POOL)
    handleAeroV2PoolCreated(ev)

    assert.entityCount("V2PoolVenue", 0)
  })

  test("GaugeCreated feeds the aero-v2 gauge lookup; staked LP and xAERO rewards are counted", () => {
    createService(SERVICE_SAFE)
    // VELO is priced, so the reward reads $0 only because it is priced as xAERO
    mockVeloUsdcPool()
    saveAeroV2Venue(false)
    handleAeroGaugeCreated(createGaugeCreatedEvent(AERO_V2_POOL, AERO_V2_GAUGE))
    mockAeroV2PoolState(AERO_V2_POOL, AERO_V2_GAUGE)
    createMockedFunction(AERO_V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("2000000000000000000"))])

    // VELO_VOTER.gauges is deliberately not mocked: the aero-v2 path must not call it.
    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, v2Block(), TX_HASH, false)

    const id = getVeloV2PositionId(SERVICE_SAFE, AERO_V2_POOL)
    assert.stringEquals(SERVICE_SAFE.toHex() + "-aero-v2-" + AERO_V2_POOL.toHex(), id.toString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "protocol", "aero-v2")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "liquidity", "500")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", AERO_V2_GAUGE.toHexString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableReward", "2")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimableRewardUSD", "0")
  })

  test("an Aero v2 pool with no gauge yet is valued from LP alone, without the Voter", () => {
    createService(SERVICE_SAFE)
    saveAeroV2Venue(false)
    mockAeroV2PoolState(AERO_V2_POOL, AERO_V2_GAUGE)
    createMockedFunction(AERO_V2_POOL, "balanceOf", "balanceOf(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("500"))])

    // No GaugeCreated, and VELO_VOTER.gauges is not mocked: falling through to it fails the test
    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, v2Block(), TX_HASH, false)

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
    transfer.block = v2Block()
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
    burn.block = v2Block()
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
    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, v2Block(), TX_HASH, false)

    const NEW_GAUGE = Address.fromString("0x00000000000000000000000000000000000000e5")
    handleAeroGaugeCreated(createGaugeCreatedEvent(AERO_V2_POOL, NEW_GAUGE))
    mockAeroV2PoolState(AERO_V2_POOL, NEW_GAUGE)
    createMockedFunction(NEW_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)]).reverts()
    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, v2Block(), TX_HASH, false)

    const id = getVeloV2PositionId(SERVICE_SAFE, AERO_V2_POOL)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "rewardsContract", NEW_GAUGE.toHexString())
  })

  test("Aero's 4-arg Mint sets entry amounts", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    mockVeloUsdcPool()
    saveAeroV2Venue(false)
    // token0 = VELO (priced via mockVeloUsdcPool) so entryAmountUSD is non-zero
    createMockedFunction(AERO_V2_POOL, "token0", "token0():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(VELO)])
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
    transfer.block = v2Block()
    transfer.transaction.hash = TX_HASH
    handleVeloV2Transfer(transfer)

    const mint = createAeroV2MintEvent(
      AERO_V2_POOL,
      ROUTER,
      SERVICE_SAFE,
      BigInt.fromString("2000000000000000000"),
      BigInt.fromString("6000000000000000000")
    )
    mint.block = v2Block()
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

    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, v2Block(), TX_HASH, false)

    // stable() is mocked to revert, so 5 can only come from the venue row
    const id = getVeloV2PositionId(SERVICE_SAFE, AERO_V2_POOL)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "fee", "5")
  })

  test("a legacy v2 pool with no venue row takes its fee from stable()", () => {
    createService(SERVICE_SAFE)
    mockChainlinkEthUsd()
    createMockedFunction(V2_POOL, "token0", "token0():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(DUMMY0)])
    createMockedFunction(V2_POOL, "token1", "token1():(address)")
      .withArgs([]).returns([ethereum.Value.fromAddress(DUMMY1)])
    createMockedFunction(V2_POOL, "stable", "stable():(bool)")
      .withArgs([]).returns([ethereum.Value.fromBoolean(true)])
    createMockedFunction(V2_POOL, "balanceOf", "balanceOf(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(500))])
    createMockedFunction(V2_POOL, "totalSupply", "totalSupply():(uint256)")
      .withArgs([]).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000))])
    createMockedFunction(V2_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
      .withArgs([]).returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000)),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000)),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero())
      ])
    createMockedFunction(VELO_VOTER, "gauges", "gauges(address):(address)")
      .withArgs([ethereum.Value.fromAddress(V2_POOL)])
      .returns([ethereum.Value.fromAddress(Address.zero())])

    const transfer = createV2TransferEvent(V2_POOL, Address.zero(), SERVICE_SAFE, BigInt.fromI32(500))
    transfer.block = v2Block()
    transfer.transaction.hash = TX_HASH
    handleVeloV2Transfer(transfer)

    const id = getVeloV2PositionId(SERVICE_SAFE, V2_POOL)
    assert.stringEquals(SERVICE_SAFE.toHex() + "-velodrome-v2-" + V2_POOL.toHex(), id.toString())
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "protocol", "velodrome-v2")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "fee", "5")
  })
})

describe("New Optimism tokens (BOLD 0x0356…, USDS, xAERO)", () => {
  afterEach(() => {
    clearStore()
  })

  test("the agent's BOLD prices off the Velodrome v2 stable BOLD/USDC pool; the legacy BOLD stays", () => {
    const bold = changetype<TokenConfig>(getTokenConfig(BOLD_V2))
    assert.stringEquals("velodrome_v2", bold.priceSources[0].sourceType)
    assert.stringEquals(
      "0x8828b7792499a7d86e931df56e3d37c428d12d2b",
      bold.priceSources[0].address.toHexString()
    )
    assert.assertNotNull(getTokenConfig(BOLD))
  })

  test("USDS and xAERO are tracked for balances but have no price source, so they value at $0", () => {
    const tokens: Address[] = [USDS, XAERO]
    for (let i = 0; i < tokens.length; i++) {
      const cfg = changetype<TokenConfig>(getTokenConfig(tokens[i]))
      assert.i32Equals(0, cfg.priceSources.length)
      assert.assertTrue(WHITELISTED_TOKENS.indexOf(tokens[i].toHexString()) != -1)
      assert.stringEquals("0", getTokenPriceUSD(tokens[i], BLOCK_TIMESTAMP, true).toString())
    }
  })
})

const BOLD_STABLE_POOL = Address.fromString("0x8828B7792499A7d86E931DF56E3D37C428d12d2b")

// A stable pool, holding 25,094 BOLD / 22,830 USDC as on-chain: its reserve ratio reads ~$0.91
function mockBoldStablePool(token0: Address, token1: Address): void {
  mockUsdcUsd()
  createMockedFunction(BOLD_STABLE_POOL, "token0", "token0():(address)")
    .withArgs([]).returns([ethereum.Value.fromAddress(token0)])
  createMockedFunction(BOLD_STABLE_POOL, "token1", "token1():(address)")
    .withArgs([]).returns([ethereum.Value.fromAddress(token1)])
  createMockedFunction(BOLD_STABLE_POOL, "stable", "stable():(bool)")
    .withArgs([]).returns([ethereum.Value.fromBoolean(true)])
  const bold = ethereum.Value.fromUnsignedBigInt(BigInt.fromString("25094000000000000000000"))
  const usdc = ethereum.Value.fromUnsignedBigInt(BigInt.fromString("22830000000"))
  createMockedFunction(BOLD_STABLE_POOL, "getReserves", "getReserves():(uint256,uint256,uint256)")
    .withArgs([])
    .returns(token0.equals(BOLD_V2)
      ? [bold, usdc, ethereum.Value.fromUnsignedBigInt(BLOCK_TIMESTAMP)]
      : [usdc, bold, ethereum.Value.fromUnsignedBigInt(BLOCK_TIMESTAMP)])
}

function mockBoldStableAmountOut(): void {
  createMockedFunction(BOLD_STABLE_POOL, "getAmountOut", "getAmountOut(uint256,address):(uint256)")
    .withArgs([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000")),
      ethereum.Value.fromAddress(BOLD_V2)
    ])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(999289))]) // 0.999289 USDC
}

describe("BOLD (0x0356…) stable-pool pricing", () => {
  afterEach(() => {
    clearStore()
  })

  test("is quoted through getAmountOut, not the imbalanced reserve ratio", () => {
    mockBoldStablePool(BOLD_V2, USDC_OP)
    mockBoldStableAmountOut()

    const price = getTokenPriceUSD(BOLD_V2, BLOCK_TIMESTAMP, true)
    assert.stringEquals("0.999289", price.toString())
  })

  test("BOLD as the pool's token1 is quoted the same way", () => {
    mockBoldStablePool(USDC_OP, BOLD_V2)
    mockBoldStableAmountOut()

    assert.stringEquals("0.999289", getTokenPriceUSD(BOLD_V2, BLOCK_TIMESTAMP, true).toString())
  })

  test("BOLD quoted below $0.98 is marked depegged", () => {
    mockBoldStablePool(BOLD_V2, USDC_OP)
    createMockedFunction(BOLD_STABLE_POOL, "getAmountOut", "getAmountOut(uint256,address):(uint256)")
      .withArgs([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000")),
        ethereum.Value.fromAddress(BOLD_V2)
      ])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(979000))]) // 0.979 USDC

    assert.stringEquals("0.979", getTokenPriceUSD(BOLD_V2, BLOCK_TIMESTAMP, true).toString())
    assert.fieldEquals("Token", BOLD_V2.toHexString(), "depegged", "true")
  })

  test("a reverting getAmountOut leaves BOLD unpriced", () => {
    mockBoldStablePool(BOLD_V2, USDC_OP)
    createMockedFunction(BOLD_STABLE_POOL, "getAmountOut", "getAmountOut(uint256,address):(uint256)")
      .withArgs([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000")),
        ethereum.Value.fromAddress(BOLD_V2)
      ])
      .reverts()

    assert.stringEquals("0", getTokenPriceUSD(BOLD_V2, BLOCK_TIMESTAMP, true).toString())
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
    refreshVeloV2Position(SERVICE_SAFE, AERO_V2_POOL, v2Block(), TX_HASH, false)
    const v2Id = getVeloV2PositionId(SERVICE_SAFE, AERO_V2_POOL)
    assert.fieldEquals("ProtocolPosition", clId.toHexString(), "claimableReward", "0")
    assert.fieldEquals("ProtocolPosition", v2Id.toHexString(), "claimableReward", "0")

    // Both now have 2 xAERO claimable; only the snapshot refresh can pick that up
    mockAeroCLStaked(true)
    mockAeroCLEarned(BigInt.fromString("2000000000000000000"))
    createMockedFunction(AERO_V2_GAUGE, "earned", "earned(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("2000000000000000000"))])

    refreshAllActivePositions(SERVICE_SAFE, v2Block(), false)

    assert.fieldEquals("ProtocolPosition", clId.toHexString(), "claimableReward", "2")
    assert.fieldEquals("ProtocolPosition", v2Id.toHexString(), "claimableReward", "2")
  })
})
