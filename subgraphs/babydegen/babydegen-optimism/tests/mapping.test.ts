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
import { refreshVeloV2Position, getVeloV2PositionId } from "../src/veloV2Shared"
import { ProtocolPosition, Service } from "../generated/schema"
import { VELO, VELO_VOTER } from "../src/constants"
import {
  createRegisterInstanceEvent,
  createCreateMultisigWithAgentsEvent
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
  // On-chain ordering: USDC (0x0b2c…) < VELO (0x9560…), so USDC is token0. Mock it that way
  // so the test exercises the same getVelodromeV2Price branch production hits.
  createMockedFunction(VELO_PRICE_POOL, "token0", "token0():(address)")
    .withArgs([])
    .returns([ethereum.Value.fromAddress(USDC_OP)])
  createMockedFunction(VELO_PRICE_POOL, "token1", "token1():(address)")
    .withArgs([])
    .returns([ethereum.Value.fromAddress(VELO)])
  // reserve0 = 1.3e12 USDC (1.3M @6dec), reserve1 = 1e24 VELO (1M @18dec) → VELO ≈ $1.30
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
