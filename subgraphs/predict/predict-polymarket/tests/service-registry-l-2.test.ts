import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleRegisterInstance, handleCreateMultisigWithAgents } from "../src/service-registry-l-2";
import { RegisterInstance, CreateMultisigWithAgents } from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import { PREDICT_AGENT_ID } from "../src/constants";

const SERVICE_ID_1 = BigInt.fromI32(100);
const SERVICE_ID_2 = BigInt.fromI32(200);
const MULTISIG_1 = Address.fromString("0x1234567890123456789012345678901234567890");
const MULTISIG_2 = Address.fromString("0x2234567890123456789012345678901234567890");
const OPERATOR_1 = Address.fromString("0x3234567890123456789012345678901234567890");
const OPERATOR_2 = Address.fromString("0x3334567890123456789012345678901234567890");
const AGENT_INSTANCE = Address.fromString("0x4234567890123456789012345678901234567890");
// Pearl Mini operator surrogate — the operator label the wallet-history
// consumer would filter on for the Pearl-Mini cohort.
const PEARL_MINI_OPERATOR = Address.fromString("0xA749f605D93B3efcc207C54270d83C6E8fa70fF8");
// Pearl Mini surrogate agentId (anything ≠ PREDICT_AGENT_ID; the gate is gone).
const PEARL_MINI_AGENT_ID = 87;

function serviceKey(serviceId: BigInt): string {
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

describe("ServiceRegistryL2 - handleRegisterInstance (gate lifted)", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Creates TraderService recording an arbitrary agentId (here, polystrat 86)", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_1, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID))
    );

    const id = serviceKey(SERVICE_ID_1);
    assert.fieldEquals("TraderService", id, "id", id);
    assert.fieldEquals("TraderService", id, "agentIds", "[" + PREDICT_AGENT_ID.toString() + "]");
    assert.fieldEquals("TraderService", id, "operators", "[" + OPERATOR_1.toHexString() + "]");
  });

  test("Creates TraderService for a non-polystrat agentId (Pearl Mini surrogate)", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(PEARL_MINI_OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PEARL_MINI_AGENT_ID))
    );

    const id = serviceKey(SERVICE_ID_1);
    assert.fieldEquals("TraderService", id, "id", id);
    assert.fieldEquals("TraderService", id, "agentIds", "[" + PEARL_MINI_AGENT_ID.toString() + "]");
    assert.fieldEquals("TraderService", id, "operators", "[" + PEARL_MINI_OPERATOR.toHexString() + "]");
  });

  test("Dedup-appends repeated (agentId, operator) for the same service", () => {
    const event1 = createRegisterInstanceEvent(OPERATOR_1, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));
    const event2 = createRegisterInstanceEvent(OPERATOR_1, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID));

    handleRegisterInstance(event1);
    handleRegisterInstance(event2);

    const id = serviceKey(SERVICE_ID_1);
    // Dedup: single occurrence of both agentId and operator.
    assert.fieldEquals("TraderService", id, "agentIds", "[" + PREDICT_AGENT_ID.toString() + "]");
    assert.fieldEquals("TraderService", id, "operators", "[" + OPERATOR_1.toHexString() + "]");
  });

  test("Accumulates distinct agentIds + operators for a multi-agent service", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_1, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID))
    );
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_2, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PEARL_MINI_AGENT_ID))
    );

    const id = serviceKey(SERVICE_ID_1);
    assert.fieldEquals(
      "TraderService",
      id,
      "agentIds",
      "[" + PREDICT_AGENT_ID.toString() + ", " + PEARL_MINI_AGENT_ID.toString() + "]"
    );
    assert.fieldEquals(
      "TraderService",
      id,
      "operators",
      "[" + OPERATOR_1.toHexString() + ", " + OPERATOR_2.toHexString() + "]"
    );
  });

  test("Keeps TraderServices separate across distinct serviceIds", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_1, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID))
    );
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_2, SERVICE_ID_2, AGENT_INSTANCE, BigInt.fromI32(PEARL_MINI_AGENT_ID))
    );

    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "id", serviceKey(SERVICE_ID_1));
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_2), "id", serviceKey(SERVICE_ID_2));
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "agentIds", "[" + PREDICT_AGENT_ID.toString() + "]");
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_2), "agentIds", "[" + PEARL_MINI_AGENT_ID.toString() + "]");
  });
});

describe("ServiceRegistryL2 - handleCreateMultisigWithAgents", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Creates TraderAgent with traderService link after RegisterInstance", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_1, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID))
    );
    handleCreateMultisigWithAgents(createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1));

    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "serviceId", SERVICE_ID_1.toString());
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "traderService", serviceKey(SERVICE_ID_1));
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalBets", "0");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "totalPayout", "0");
    // Reverse link
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "traderAgent", MULTISIG_1.toHexString());
  });

  test("Creates TraderAgent for a non-polystrat cohort (Pearl Mini surrogate)", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(PEARL_MINI_OPERATOR, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PEARL_MINI_AGENT_ID))
    );
    handleCreateMultisigWithAgents(createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1));

    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "id", MULTISIG_1.toHexString());
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "agentIds", "[" + PEARL_MINI_AGENT_ID.toString() + "]");
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "operators", "[" + PEARL_MINI_OPERATOR.toHexString() + "]");
  });

  test("Creates a TraderService row even if CreateMultisigWithAgents fires first (defensive)", () => {
    handleCreateMultisigWithAgents(createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1));

    // TraderService row exists with empty arrays; TraderAgent linked through it.
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "id", serviceKey(SERVICE_ID_1));
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "agentIds", "[]");
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "operators", "[]");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "traderService", serviceKey(SERVICE_ID_1));

    // Later RegisterInstance backfills the arrays on the same TraderService row.
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_1, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID))
    );
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "agentIds", "[" + PREDICT_AGENT_ID.toString() + "]");
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "operators", "[" + OPERATOR_1.toHexString() + "]");
  });

  test("Does not duplicate TraderAgent for repeated CreateMultisigWithAgents", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_1, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID))
    );
    handleCreateMultisigWithAgents(createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1));
    handleCreateMultisigWithAgents(createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1));

    assert.fieldEquals("Global", "", "totalTraderAgents", "1");
  });

  test("Tracks distinct multisigs in Global across two services", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_1, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID))
    );
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_2, SERVICE_ID_2, AGENT_INSTANCE, BigInt.fromI32(PEARL_MINI_AGENT_ID))
    );

    handleCreateMultisigWithAgents(createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1));
    handleCreateMultisigWithAgents(createCreateMultisigWithAgentsEvent(SERVICE_ID_2, MULTISIG_2));

    assert.fieldEquals("Global", "", "totalTraderAgents", "2");
    assert.fieldEquals("TraderAgent", MULTISIG_1.toHexString(), "traderService", serviceKey(SERVICE_ID_1));
    assert.fieldEquals("TraderAgent", MULTISIG_2.toHexString(), "traderService", serviceKey(SERVICE_ID_2));
  });

  // Rare-but-reachable shape: Safe address reuse — two distinct services
  // emit CreateMultisigWithAgents for the same multisig. The TraderAgent
  // already exists from service 1, so the inner block doesn't fire — but
  // service 2's defensive TraderService row must still receive a
  // `traderAgent` back-link instead of staying null forever.
  test("Idempotent reverse link survives Safe address reuse across services", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(OPERATOR_1, SERVICE_ID_1, AGENT_INSTANCE, BigInt.fromI32(PREDICT_AGENT_ID))
    );
    handleCreateMultisigWithAgents(createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1));

    // Service 2 reuses the same multisig — TraderAgent already exists.
    handleCreateMultisigWithAgents(createCreateMultisigWithAgentsEvent(SERVICE_ID_2, MULTISIG_1));

    // Single TraderAgent (no double-count in Global).
    assert.fieldEquals("Global", "", "totalTraderAgents", "1");
    // Service 1's TraderService still points at the agent.
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_1), "traderAgent", MULTISIG_1.toHexString());
    // Service 2's TraderService also gets the link, not null.
    assert.fieldEquals("TraderService", serviceKey(SERVICE_ID_2), "traderAgent", MULTISIG_1.toHexString());
  });
});
