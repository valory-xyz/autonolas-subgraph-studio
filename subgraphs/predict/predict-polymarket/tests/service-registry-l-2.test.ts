import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { handleRegisterInstance, handleCreateMultisigWithAgents } from "../src/service-registry-l-2";
import { RegisterInstance, CreateMultisigWithAgents } from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import { PREDICT_AGENT_ID } from "../src/constants";

const SERVICE_ID_1 = BigInt.fromI32(100);
const SERVICE_ID_2 = BigInt.fromI32(200);
const MULTISIG_1 = Address.fromString("0x1234567890123456789012345678901234567890");
const MULTISIG_2 = Address.fromString("0x2234567890123456789012345678901234567890");
const OPERATOR = Address.fromString("0x3234567890123456789012345678901234567890");
const AGENT_INSTANCE = Address.fromString("0x4234567890123456789012345678901234567890");

function createRegisterInstanceEvent(
  operator: Address,
  serviceId: BigInt,
  agentInstance: Address,
  agentId: i32
): RegisterInstance {
  let event = changetype<RegisterInstance>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(new ethereum.EventParam("operator", ethereum.Value.fromAddress(operator)));
  event.parameters.push(new ethereum.EventParam("serviceId", ethereum.Value.fromUnsignedBigInt(serviceId)));
  event.parameters.push(new ethereum.EventParam("agentInstance", ethereum.Value.fromAddress(agentInstance)));
  event.parameters.push(new ethereum.EventParam("agentId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(agentId))));

  return event;
}

function createCreateMultisigWithAgentsEvent(
  serviceId: BigInt,
  multisig: Address
): CreateMultisigWithAgents {
  let event = changetype<CreateMultisigWithAgents>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(new ethereum.EventParam("serviceId", ethereum.Value.fromUnsignedBigInt(serviceId)));
  event.parameters.push(new ethereum.EventParam("multisig", ethereum.Value.fromAddress(multisig)));

  return event;
}

describe("ServiceRegistryL2 - RegisterInstance Handler", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should create TraderService when agent ID matches PREDICT_AGENT_ID", () => {
    let event = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, PREDICT_AGENT_ID);

    handleRegisterInstance(event);

    let serviceId = SERVICE_ID_1.toString();
    assert.fieldEquals("TraderService", serviceId, "id", serviceId);
  });

  test("Should not create TraderService when agent ID does not match PREDICT_AGENT_ID", () => {
    let wrongAgentId = 99;
    let event = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, wrongAgentId);

    handleRegisterInstance(event);

    let serviceId = SERVICE_ID_1.toString();
    assert.notInStore("TraderService", serviceId);
  });

  test("Should not create duplicate TraderService for same serviceId", () => {
    // Create first instance
    let event1 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, PREDICT_AGENT_ID);
    handleRegisterInstance(event1);

    // Try to create duplicate
    let event2 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, PREDICT_AGENT_ID);
    handleRegisterInstance(event2);

    let serviceId = SERVICE_ID_1.toString();
    assert.fieldEquals("TraderService", serviceId, "id", serviceId);
    // Test passes if no error occurs - duplicate prevention works
  });

  test("Should create multiple TraderServices for different serviceIds", () => {
    let event1 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, PREDICT_AGENT_ID);
    let event2 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_2, AGENT_INSTANCE, PREDICT_AGENT_ID);

    handleRegisterInstance(event1);
    handleRegisterInstance(event2);

    assert.fieldEquals("TraderService", SERVICE_ID_1.toString(), "id", SERVICE_ID_1.toString());
    assert.fieldEquals("TraderService", SERVICE_ID_2.toString(), "id", SERVICE_ID_2.toString());
  });
});

describe("ServiceRegistryL2 - CreateMultisigWithAgents Handler", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should create TraderAgent when TraderService exists", () => {
    // First, register the service
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, PREDICT_AGENT_ID);
    handleRegisterInstance(registerEvent);

    // Then create multisig
    let multisigEvent = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent);

    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "id", MULTISIG_1.toHexString());
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "serviceId", SERVICE_ID_1.toString());
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalBets", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalPayout", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalTraded", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalFees", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "blockNumber", "1");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "blockTimestamp", "1");
  });

  test("Should not create TraderAgent when TraderService does not exist", () => {
    let multisigEvent = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent);

    assert.notInStore("TraderAgent", MULTISIG_1.toHexString());
  });

  test("Should not create duplicate TraderAgent for same multisig", () => {
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, PREDICT_AGENT_ID);
    handleRegisterInstance(registerEvent);

    let multisigEvent1 = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    let multisigEvent2 = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);

    handleCreateMultisigWithAgents(multisigEvent1);
    handleCreateMultisigWithAgents(multisigEvent2);

    // Should only have one TraderAgent
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "id", MULTISIG_1.toHexString());
  });

  test("Should increment totalTraderAgents in Global when TraderAgent is created", () => {
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, PREDICT_AGENT_ID);
    handleRegisterInstance(registerEvent);

    let multisigEvent = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent);

    assert.fieldEquals("Global", "", "totalTraderAgents", "1");
  });

  test("Should correctly track multiple TraderAgents in Global", () => {
    // Register two services
    let registerEvent1 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, PREDICT_AGENT_ID);
    let registerEvent2 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_2, AGENT_INSTANCE, PREDICT_AGENT_ID);
    handleRegisterInstance(registerEvent1);
    handleRegisterInstance(registerEvent2);

    // Create two trader agents
    let multisigEvent1 = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    let multisigEvent2 = createCreateMultisigWithAgentsEvent(SERVICE_ID_2, MULTISIG_2);
    handleCreateMultisigWithAgents(multisigEvent1);
    handleCreateMultisigWithAgents(multisigEvent2);

    assert.fieldEquals("Global", "", "totalTraderAgents", "2");
  });

  test("Global should be initialized correctly on first TraderAgent creation", () => {
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, PREDICT_AGENT_ID);
    handleRegisterInstance(registerEvent);

    let multisigEvent = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent);

    assert.fieldEquals("Global", "", "id", "");
    assert.fieldEquals("Global", "", "totalTraderAgents", "1");
    assert.fieldEquals("Global", "", "totalActiveTraderAgents", "0");
    assert.fieldEquals("Global", "", "totalBets", "0");
    assert.fieldEquals("Global", "", "totalPayout", "0");
    assert.fieldEquals("Global", "", "totalTraded", "0");
    assert.fieldEquals("Global", "", "totalFees", "0");
  });
});

describe("ServiceRegistryL2 - Integration Tests", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Complete flow: Register service -> Create multisig -> Verify entities", () => {
    // Step 1: Register instance with correct agent ID
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, PREDICT_AGENT_ID);
    handleRegisterInstance(registerEvent);

    // Verify TraderService created
    assert.fieldEquals("TraderService", SERVICE_ID_1.toString(), "id", SERVICE_ID_1.toString());

    // Step 2: Create multisig
    let multisigEvent = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent);

    // Verify TraderAgent created
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "id", MULTISIG_1.toHexString());
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "serviceId", SERVICE_ID_1.toString());

    // Verify Global updated
    assert.fieldEquals("Global", "", "totalTraderAgents", "1");
  });

  test("Wrong agent ID flow should not create any entities", () => {
    let wrongAgentId = 99;
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, wrongAgentId);
    handleRegisterInstance(registerEvent);

    let multisigEvent = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent);

    // No TraderService or TraderAgent should exist
    assert.notInStore("TraderService", SERVICE_ID_1.toString());
    assert.notInStore("TraderAgent", MULTISIG_1.toHexString());
  });
});
