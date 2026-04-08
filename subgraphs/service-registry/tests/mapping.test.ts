import {
  assert,
  describe,
  test,
  clearStore,
  afterEach,
} from "matchstick-as/assembly/index"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  handleCreateService,
  handleUpdateService,
  handleRegisterInstance,
  handleCreateMultisig,
  handleTerminateService,
} from "../src/mapping"
import {
  createCreateServiceEvent,
  createUpdateServiceEvent,
  createRegisterInstanceEvent,
  createCreateMultisigWithAgentsEvent,
  createTerminateServiceEvent,
} from "./mapping-utils"
import {
  CREATOR_ADDRESS,
  OPERATOR_ADDRESS,
  AGENT_INSTANCE_ADDRESS,
  MULTISIG_ADDRESS,
  SERVICE_ID,
  AGENT_ID,
  TIMESTAMP,
  CONFIG_HASH,
} from "./test-helpers"

describe("Service Registry L2 handlers", () => {
  afterEach(() => {
    clearStore()
  })

  // --- handleCreateService ---

  test("handleCreateService creates Service entity with correct fields", () => {
    let event = createCreateServiceEvent(SERVICE_ID, CONFIG_HASH)
    event.block.timestamp = TIMESTAMP

    handleCreateService(event)

    assert.entityCount("Service", 1)
    let id = SERVICE_ID.toString()
    assert.fieldEquals("Service", id, "creationTimestamp", TIMESTAMP.toString())
    assert.fieldEquals("Service", id, "configHash", CONFIG_HASH.toHexString())
    assert.fieldEquals("Service", id, "agentIds", "[]")
  })

  test("handleCreateService with different service IDs creates separate entities", () => {
    let event1 = createCreateServiceEvent(BigInt.fromI32(1), CONFIG_HASH)
    event1.block.timestamp = TIMESTAMP
    handleCreateService(event1)

    let event2 = createCreateServiceEvent(BigInt.fromI32(2), CONFIG_HASH)
    event2.block.timestamp = TIMESTAMP
    handleCreateService(event2)

    assert.entityCount("Service", 2)
    assert.fieldEquals("Service", "1", "creationTimestamp", TIMESTAMP.toString())
    assert.fieldEquals("Service", "2", "creationTimestamp", TIMESTAMP.toString())
  })

  // --- handleUpdateService ---

  test("handleUpdateService updates configHash on existing service", () => {
    // First create the service
    let createEvent = createCreateServiceEvent(SERVICE_ID, CONFIG_HASH)
    createEvent.block.timestamp = TIMESTAMP
    handleCreateService(createEvent)

    // Now update configHash
    let newConfigHash = Bytes.fromHexString(
      "0x1111111111111111111111111111111111111111111111111111111111111111"
    )
    let updateEvent = createUpdateServiceEvent(SERVICE_ID, newConfigHash)
    handleUpdateService(updateEvent)

    assert.entityCount("Service", 1)
    assert.fieldEquals(
      "Service",
      SERVICE_ID.toString(),
      "configHash",
      newConfigHash.toHexString()
    )
  })

  test("handleUpdateService does nothing for non-existent service", () => {
    let newConfigHash = Bytes.fromHexString(
      "0x1111111111111111111111111111111111111111111111111111111111111111"
    )
    let updateEvent = createUpdateServiceEvent(BigInt.fromI32(999), newConfigHash)
    handleUpdateService(updateEvent)

    assert.entityCount("Service", 0)
  })

  // --- handleRegisterInstance ---

  test("handleRegisterInstance creates AgentRegistration and updates Service.agentIds", () => {
    // Create service first
    let createEvent = createCreateServiceEvent(SERVICE_ID, CONFIG_HASH)
    createEvent.block.timestamp = TIMESTAMP
    handleCreateService(createEvent)

    // Register an agent instance
    let regEvent = createRegisterInstanceEvent(
      OPERATOR_ADDRESS,
      SERVICE_ID,
      AGENT_INSTANCE_ADDRESS,
      AGENT_ID
    )
    regEvent.block.timestamp = BigInt.fromI32(1700000100)
    handleRegisterInstance(regEvent)

    // Check Service.agentIds updated
    assert.fieldEquals(
      "Service",
      SERVICE_ID.toString(),
      "agentIds",
      "[40]"
    )

    // Check AgentRegistration created
    let registrationId = SERVICE_ID.toString() + "-" + AGENT_ID.toI32().toString()
    assert.entityCount("AgentRegistration", 1)
    assert.fieldEquals("AgentRegistration", registrationId, "serviceId", SERVICE_ID.toI32().toString())
    assert.fieldEquals("AgentRegistration", registrationId, "agentId", AGENT_ID.toI32().toString())
    assert.fieldEquals("AgentRegistration", registrationId, "registrationTimestamp", "1700000100")
  })

  test("handleRegisterInstance does not add duplicate agent IDs", () => {
    // Create service
    let createEvent = createCreateServiceEvent(SERVICE_ID, CONFIG_HASH)
    createEvent.block.timestamp = TIMESTAMP
    handleCreateService(createEvent)

    // Register same agent twice
    let regEvent1 = createRegisterInstanceEvent(
      OPERATOR_ADDRESS,
      SERVICE_ID,
      AGENT_INSTANCE_ADDRESS,
      AGENT_ID
    )
    regEvent1.block.timestamp = BigInt.fromI32(1700000100)
    handleRegisterInstance(regEvent1)

    let regEvent2 = createRegisterInstanceEvent(
      OPERATOR_ADDRESS,
      SERVICE_ID,
      AGENT_INSTANCE_ADDRESS,
      AGENT_ID
    )
    regEvent2.block.timestamp = BigInt.fromI32(1700000200)
    handleRegisterInstance(regEvent2)

    // Should still have only one agent ID
    assert.fieldEquals(
      "Service",
      SERVICE_ID.toString(),
      "agentIds",
      "[40]"
    )
  })

  test("handleRegisterInstance creates Operator and increments Global.totalOperators", () => {
    // Create service
    let createEvent = createCreateServiceEvent(SERVICE_ID, CONFIG_HASH)
    createEvent.block.timestamp = TIMESTAMP
    handleCreateService(createEvent)

    // Register instance
    let regEvent = createRegisterInstanceEvent(
      OPERATOR_ADDRESS,
      SERVICE_ID,
      AGENT_INSTANCE_ADDRESS,
      AGENT_ID
    )
    regEvent.block.timestamp = BigInt.fromI32(1700000100)
    handleRegisterInstance(regEvent)

    // Operator entity created
    assert.entityCount("Operator", 1)

    // Global totalOperators incremented
    assert.fieldEquals("Global", "", "totalOperators", "1")
  })

  // --- handleCreateMultisig ---

  test("handleCreateMultisig creates Multisig, Creator, and links to Service", () => {
    // Create and register service
    let createEvent = createCreateServiceEvent(SERVICE_ID, CONFIG_HASH)
    createEvent.block.timestamp = TIMESTAMP
    handleCreateService(createEvent)

    let regEvent = createRegisterInstanceEvent(
      OPERATOR_ADDRESS,
      SERVICE_ID,
      AGENT_INSTANCE_ADDRESS,
      AGENT_ID
    )
    regEvent.block.timestamp = BigInt.fromI32(1700000100)
    handleRegisterInstance(regEvent)

    // Create multisig
    let multisigEvent = createCreateMultisigWithAgentsEvent(
      SERVICE_ID,
      MULTISIG_ADDRESS
    )
    multisigEvent.block.timestamp = BigInt.fromI32(1700000200)
    multisigEvent.transaction.from = CREATOR_ADDRESS
    handleCreateMultisig(multisigEvent)

    // Check Multisig entity
    let multisigId = MULTISIG_ADDRESS.toHexString()
    assert.entityCount("Multisig", 1)
    assert.fieldEquals("Multisig", multisigId, "serviceId", SERVICE_ID.toI32().toString())

    // Check Creator entity
    assert.entityCount("Creator", 1)

    // Check Service linked to multisig and creator
    assert.fieldEquals(
      "Service",
      SERVICE_ID.toString(),
      "multisig",
      multisigId
    )
    assert.fieldEquals(
      "Service",
      SERVICE_ID.toString(),
      "creator",
      CREATOR_ADDRESS.toHexString()
    )
  })

  test("handleCreateMultisig does nothing if service does not exist", () => {
    let multisigEvent = createCreateMultisigWithAgentsEvent(
      BigInt.fromI32(999),
      MULTISIG_ADDRESS
    )
    multisigEvent.block.timestamp = BigInt.fromI32(1700000200)
    handleCreateMultisig(multisigEvent)

    assert.entityCount("Multisig", 0)
    assert.entityCount("Creator", 0)
  })

  test("handleCreateMultisig assigns most recent agent to multisig", () => {
    // Create service
    let createEvent = createCreateServiceEvent(SERVICE_ID, CONFIG_HASH)
    createEvent.block.timestamp = TIMESTAMP
    handleCreateService(createEvent)

    // Register agent 40 first
    let regEvent1 = createRegisterInstanceEvent(
      OPERATOR_ADDRESS,
      SERVICE_ID,
      AGENT_INSTANCE_ADDRESS,
      BigInt.fromI32(40)
    )
    regEvent1.block.timestamp = BigInt.fromI32(1700000100)
    handleRegisterInstance(regEvent1)

    // Register agent 41 second (more recent)
    let regEvent2 = createRegisterInstanceEvent(
      OPERATOR_ADDRESS,
      SERVICE_ID,
      AGENT_INSTANCE_ADDRESS,
      BigInt.fromI32(41)
    )
    regEvent2.block.timestamp = BigInt.fromI32(1700000200)
    handleRegisterInstance(regEvent2)

    // Create multisig
    let multisigEvent = createCreateMultisigWithAgentsEvent(
      SERVICE_ID,
      MULTISIG_ADDRESS
    )
    multisigEvent.block.timestamp = BigInt.fromI32(1700000300)
    multisigEvent.transaction.from = CREATOR_ADDRESS
    handleCreateMultisig(multisigEvent)

    // Multisig should have only the most recent agent (41)
    let multisigId = MULTISIG_ADDRESS.toHexString()
    assert.fieldEquals("Multisig", multisigId, "agentIds", "[41]")
  })

  // --- handleTerminateService ---

  test("handleTerminateService clears agentIds, multisig, and creator", () => {
    // Create service, register, and create multisig
    let createEvent = createCreateServiceEvent(SERVICE_ID, CONFIG_HASH)
    createEvent.block.timestamp = TIMESTAMP
    handleCreateService(createEvent)

    let regEvent = createRegisterInstanceEvent(
      OPERATOR_ADDRESS,
      SERVICE_ID,
      AGENT_INSTANCE_ADDRESS,
      AGENT_ID
    )
    regEvent.block.timestamp = BigInt.fromI32(1700000100)
    handleRegisterInstance(regEvent)

    let multisigEvent = createCreateMultisigWithAgentsEvent(
      SERVICE_ID,
      MULTISIG_ADDRESS
    )
    multisigEvent.block.timestamp = BigInt.fromI32(1700000200)
    multisigEvent.transaction.from = CREATOR_ADDRESS
    handleCreateMultisig(multisigEvent)

    // Verify service has data before termination
    assert.fieldEquals("Service", SERVICE_ID.toString(), "agentIds", "[40]")

    // Terminate service
    let terminateEvent = createTerminateServiceEvent(SERVICE_ID)
    handleTerminateService(terminateEvent)

    // agentIds should be cleared
    assert.fieldEquals("Service", SERVICE_ID.toString(), "agentIds", "[]")

    // multisig and creator should be null
    assert.fieldEquals("Service", SERVICE_ID.toString(), "multisig", "null")
    assert.fieldEquals("Service", SERVICE_ID.toString(), "creator", "null")
  })

  test("handleTerminateService does nothing for non-existent service", () => {
    let terminateEvent = createTerminateServiceEvent(BigInt.fromI32(999))
    handleTerminateService(terminateEvent)

    // Should not create any entities
    assert.entityCount("Service", 0)
  })

  test("handleTerminateService preserves configHash and creationTimestamp", () => {
    // Create service
    let createEvent = createCreateServiceEvent(SERVICE_ID, CONFIG_HASH)
    createEvent.block.timestamp = TIMESTAMP
    handleCreateService(createEvent)

    // Terminate
    let terminateEvent = createTerminateServiceEvent(SERVICE_ID)
    handleTerminateService(terminateEvent)

    // configHash and creationTimestamp should remain
    assert.fieldEquals("Service", SERVICE_ID.toString(), "configHash", CONFIG_HASH.toHexString())
    assert.fieldEquals("Service", SERVICE_ID.toString(), "creationTimestamp", TIMESTAMP.toString())
  })
})
