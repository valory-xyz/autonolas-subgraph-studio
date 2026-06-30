import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleRegisterInstance, handleCreateMultisigWithAgents } from "../src/service-registry-l-2";
import { RegisterInstance, CreateMultisigWithAgents } from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import { PREDICT_AGENT_IDS } from "../src/constants";

// Any whitelisted trader agent ID works for the generic tests
const PREDICT_AGENT_ID = PREDICT_AGENT_IDS[0];

const SERVICE_ID_1 = BigInt.fromI32(100);
const SERVICE_ID_2 = BigInt.fromI32(200);
const MULTISIG_1 = Address.fromString("0x1234567890123456789012345678901234567890");
const MULTISIG_2 = Address.fromString("0x2234567890123456789012345678901234567890");
const OPERATOR = Address.fromString("0x3234567890123456789012345678901234567890");
const AGENT_INSTANCE = Address.fromString("0x4234567890123456789012345678901234567890");

function getServiceId(serviceId: BigInt): string {
  return serviceId.toHexString();
}

function createRegisterInstanceEvent(
  operator: Address,
  serviceId: BigInt,
  agentInstance: Address,
  agentId: BigInt
): RegisterInstance {
  let event = changetype<RegisterInstance>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(new ethereum.EventParam("operator", ethereum.Value.fromAddress(operator)));
  event.parameters.push(new ethereum.EventParam("serviceId", ethereum.Value.fromUnsignedBigInt(serviceId)));
  event.parameters.push(new ethereum.EventParam("agentInstance", ethereum.Value.fromAddress(agentInstance)));
  event.parameters.push(new ethereum.EventParam("agentId", ethereum.Value.fromUnsignedBigInt(agentId)));

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

  test("Should create TraderService for each whitelisted agent ID", () => {
    for (let i = 0; i < PREDICT_AGENT_IDS.length; i++) {
      let serviceId = BigInt.fromI32(100 + i);
      let event = createRegisterInstanceEvent(OPERATOR, serviceId, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_IDS[i]));
      handleRegisterInstance(event);

      assert.fieldEquals("TraderService", getServiceId(serviceId), "id", getServiceId(serviceId));
    }
  });

  test("Should NOT create TraderService when agent ID does not match", () => {
    let wrongAgentId = BigInt.fromI32(99);
    let event = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, wrongAgentId);
    handleRegisterInstance(event);

    assert.notInStore("TraderService", getServiceId(SERVICE_ID_1));
  });

  test("Should not create duplicate TraderService for same serviceId", () => {
    let event1 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
    handleRegisterInstance(event1);

    let event2 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
    handleRegisterInstance(event2);

    let serviceId = getServiceId(SERVICE_ID_1);
    assert.fieldEquals("TraderService", serviceId, "id", serviceId);
  });

  test("Should create multiple TraderServices for different serviceIds", () => {
    let event1 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
    let event2 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_2, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
    handleRegisterInstance(event1);
    handleRegisterInstance(event2);

    assert.fieldEquals("TraderService", getServiceId(SERVICE_ID_1), "id", getServiceId(SERVICE_ID_1));
    assert.fieldEquals("TraderService", getServiceId(SERVICE_ID_2), "id", getServiceId(SERVICE_ID_2));
  });
});

describe("ServiceRegistryL2 - CreateMultisigWithAgents Handler", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should create TraderAgent when TraderService exists", () => {
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
    handleRegisterInstance(registerEvent);

    let multisigEvent = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent);

    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "id", MULTISIG_1.toHexString());
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "serviceId", SERVICE_ID_1.toString());
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalBets", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalPayout", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalTraded", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalFees", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalFeesSettled", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalExpectedPayout", "0");
  });

  test("Should NOT create TraderAgent when TraderService does not exist", () => {
    let multisigEvent = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent);

    assert.notInStore("TraderAgent", MULTISIG_1.toHexString());
  });

  test("Should NOT create TraderAgent for wrong agent ID", () => {
    let wrongAgentId = BigInt.fromI32(99);
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, wrongAgentId);
    handleRegisterInstance(registerEvent);

    let multisigEvent = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent);

    assert.notInStore("TraderAgent", MULTISIG_1.toHexString());
  });

  test("Should not create duplicate TraderAgent for same multisig", () => {
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
    handleRegisterInstance(registerEvent);

    let multisigEvent1 = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    let multisigEvent2 = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent1);
    handleCreateMultisigWithAgents(multisigEvent2);

    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "id", MULTISIG_1.toHexString());
  });

  test("Should increment totalTraderAgents in Global", () => {
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
    handleRegisterInstance(registerEvent);

    let multisigEvent = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    handleCreateMultisigWithAgents(multisigEvent);

    assert.fieldEquals("Global", "", "totalTraderAgents", "1");
  });

  test("Should correctly track multiple TraderAgents in Global", () => {
    let registerEvent1 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
    let registerEvent2 = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_2, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
    handleRegisterInstance(registerEvent1);
    handleRegisterInstance(registerEvent2);

    let multisigEvent1 = createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1);
    let multisigEvent2 = createCreateMultisigWithAgentsEvent(SERVICE_ID_2, MULTISIG_2);
    handleCreateMultisigWithAgents(multisigEvent1);
    handleCreateMultisigWithAgents(multisigEvent2);

    assert.fieldEquals("Global", "", "totalTraderAgents", "2");
  });

  test("Global should be initialized correctly on first TraderAgent creation", () => {
    let registerEvent = createRegisterInstanceEvent(OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
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
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalFeesSettled", "0");
    assert.fieldEquals("Global", "", "totalExpectedPayout", "0");
  });
});
