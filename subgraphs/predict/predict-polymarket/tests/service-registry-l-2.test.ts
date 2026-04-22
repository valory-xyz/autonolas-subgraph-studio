import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  newMockEvent,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  handleRegisterInstance,
  handleCreateMultisigWithAgents,
  handleTerminateService,
} from "../src/service-registry-l-2";
import {
  RegisterInstance,
  CreateMultisigWithAgents,
  TerminateService,
} from "../generated/ServiceRegistryL2/ServiceRegistryL2";

const SERVICE_ID_1 = BigInt.fromI32(100);
const SERVICE_ID_2 = BigInt.fromI32(200);
const MULTISIG_1 = Address.fromString("0x1234567890123456789012345678901234567890");
const MULTISIG_2 = Address.fromString("0x2234567890123456789012345678901234567890");
const OPERATOR_1 = Address.fromString("0x3234567890123456789012345678901234567890");
const OPERATOR_2 = Address.fromString("0xa749f605d93b3efcc207c54270d83c6e8fa70ff8"); // Pearl Mini creator
const AGENT_INSTANCE_1 = Address.fromString("0x4234567890123456789012345678901234567890");
const AGENT_INSTANCE_2 = Address.fromString("0x5234567890123456789012345678901234567890");
const POLYSTRAT_AGENT_ID = BigInt.fromI32(86);
const PEARL_MINI_AGENT_ID = BigInt.fromI32(25);

function serviceIdBytes(id: BigInt): string {
  return Bytes.fromByteArray(Bytes.fromBigInt(id)).toHexString();
}

function createRegisterInstanceEvent(
  operator: Address,
  serviceId: BigInt,
  agentInstance: Address,
  agentId: BigInt,
): RegisterInstance {
  let event = changetype<RegisterInstance>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("operator", ethereum.Value.fromAddress(operator)),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "agentInstance",
      ethereum.Value.fromAddress(agentInstance),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "agentId",
      ethereum.Value.fromUnsignedBigInt(agentId),
    ),
  );
  return event;
}

function createCreateMultisigWithAgentsEvent(
  serviceId: BigInt,
  multisig: Address,
): CreateMultisigWithAgents {
  let event = changetype<CreateMultisigWithAgents>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam("multisig", ethereum.Value.fromAddress(multisig)),
  );
  return event;
}

function createTerminateServiceEvent(serviceId: BigInt): TerminateService {
  let event = changetype<TerminateService>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId),
    ),
  );
  return event;
}

describe("ServiceRegistryL2 - RegisterInstance before CreateMultisigWithAgents", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Buffers agentId and operator on PendingMultisig when multisig doesn't exist yet", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        POLYSTRAT_AGENT_ID,
      ),
    );

    let id = serviceIdBytes(SERVICE_ID_1);
    assert.fieldEquals("PendingMultisig", id, "agentIds", "[86]");
    assert.fieldEquals(
      "PendingMultisig",
      id,
      "operators",
      "[" + OPERATOR_1.toHexString() + "]",
    );
    assert.notInStore("Multisig", MULTISIG_1.toHexString());
  });

  test("Deduplicates agentId and operator across multiple RegisterInstance events", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        POLYSTRAT_AGENT_ID,
      ),
    );
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_2,
        POLYSTRAT_AGENT_ID,
      ),
    );

    let id = serviceIdBytes(SERVICE_ID_1);
    assert.fieldEquals("PendingMultisig", id, "agentIds", "[86]");
    assert.fieldEquals(
      "PendingMultisig",
      id,
      "operators",
      "[" + OPERATOR_1.toHexString() + "]",
    );
  });

  test("Drains PendingMultisig into Multisig on CreateMultisigWithAgents", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_2,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        PEARL_MINI_AGENT_ID,
      ),
    );
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_2,
        POLYSTRAT_AGENT_ID,
      ),
    );
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );

    let ms = MULTISIG_1.toHexString();
    assert.fieldEquals("Multisig", ms, "serviceId", SERVICE_ID_1.toString());
    assert.fieldEquals("Multisig", ms, "agentIds", "[25, 86]");
    assert.fieldEquals(
      "Multisig",
      ms,
      "operators",
      "[" + OPERATOR_2.toHexString() + ", " + OPERATOR_1.toHexString() + "]",
    );
  });
});

describe("ServiceRegistryL2 - CreateMultisigWithAgents before RegisterInstance", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Creates Multisig entity with empty arrays when no pending exists", () => {
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );

    let ms = MULTISIG_1.toHexString();
    assert.fieldEquals("Multisig", ms, "id", ms);
    assert.fieldEquals("Multisig", ms, "serviceId", SERVICE_ID_1.toString());
    assert.fieldEquals("Multisig", ms, "agentIds", "[]");
    assert.fieldEquals("Multisig", ms, "operators", "[]");
  });

  test("Creates ServiceIndex mapping for future RegisterInstance lookups", () => {
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );

    let id = serviceIdBytes(SERVICE_ID_1);
    assert.fieldEquals("ServiceIndex", id, "multisig", MULTISIG_1.toHexString());
  });

  test("Appends to Multisig when RegisterInstance fires after CreateMultisigWithAgents", () => {
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        POLYSTRAT_AGENT_ID,
      ),
    );

    let ms = MULTISIG_1.toHexString();
    assert.fieldEquals("Multisig", ms, "agentIds", "[86]");
    assert.fieldEquals(
      "Multisig",
      ms,
      "operators",
      "[" + OPERATOR_1.toHexString() + "]",
    );
  });

  test("Deduplicates when the same RegisterInstance tuple fires twice", () => {
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        POLYSTRAT_AGENT_ID,
      ),
    );
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        POLYSTRAT_AGENT_ID,
      ),
    );

    let ms = MULTISIG_1.toHexString();
    assert.fieldEquals("Multisig", ms, "agentIds", "[86]");
    assert.fieldEquals(
      "Multisig",
      ms,
      "operators",
      "[" + OPERATOR_1.toHexString() + "]",
    );
  });
});

describe("ServiceRegistryL2 - cohort markers", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Pearl Mini marker: operators contains PolySafeCreator address", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_2,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        PEARL_MINI_AGENT_ID,
      ),
    );
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );

    let ms = MULTISIG_1.toHexString();
    assert.fieldEquals(
      "Multisig",
      ms,
      "operators",
      "[" + OPERATOR_2.toHexString() + "]",
    );
  });

  test("Polystrat marker: agentIds contains 86", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        POLYSTRAT_AGENT_ID,
      ),
    );
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );

    let ms = MULTISIG_1.toHexString();
    assert.fieldEquals("Multisig", ms, "agentIds", "[86]");
  });

  test("Generalization: non-polystrat, non-Pearl service is still indexed", () => {
    let customAgentId = BigInt.fromI32(7);
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        customAgentId,
      ),
    );
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );

    let ms = MULTISIG_1.toHexString();
    assert.fieldEquals("Multisig", ms, "agentIds", "[7]");
    // Multisig exists for every Olas service, no cohort gate.
    assert.fieldEquals("Multisig", ms, "serviceId", SERVICE_ID_1.toString());
  });
});

describe("ServiceRegistryL2 - No TraderAgent creation at registration", () => {
  beforeEach(() => {
    clearStore();
  });

  test("TraderAgent is NOT created on CreateMultisigWithAgents (lazy creation on first trade)", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        POLYSTRAT_AGENT_ID,
      ),
    );
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );

    assert.notInStore("TraderAgent", MULTISIG_1.toHexString());
  });

  test("No Global entity updates at registration time", () => {
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );

    // Global should not exist yet; it gets created on first trade.
    assert.notInStore("Global", "");
  });
});

describe("ServiceRegistryL2 - Multiple services", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Keeps separate Multisig entities for separate services", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        POLYSTRAT_AGENT_ID,
      ),
    );
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_2,
        SERVICE_ID_2,
        AGENT_INSTANCE_2,
        PEARL_MINI_AGENT_ID,
      ),
    );
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_2, MULTISIG_2),
    );

    assert.fieldEquals(
      "Multisig",
      MULTISIG_1.toHexString(),
      "serviceId",
      SERVICE_ID_1.toString(),
    );
    assert.fieldEquals("Multisig", MULTISIG_1.toHexString(), "agentIds", "[86]");
    assert.fieldEquals(
      "Multisig",
      MULTISIG_2.toHexString(),
      "serviceId",
      SERVICE_ID_2.toString(),
    );
    assert.fieldEquals("Multisig", MULTISIG_2.toHexString(), "agentIds", "[25]");
  });
});

describe("ServiceRegistryL2 - TerminateService", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Sets terminatedAt on the Multisig entity", () => {
    handleRegisterInstance(
      createRegisterInstanceEvent(
        OPERATOR_1,
        SERVICE_ID_1,
        AGENT_INSTANCE_1,
        POLYSTRAT_AGENT_ID,
      ),
    );
    handleCreateMultisigWithAgents(
      createCreateMultisigWithAgentsEvent(SERVICE_ID_1, MULTISIG_1),
    );
    let termEvent = createTerminateServiceEvent(SERVICE_ID_1);
    termEvent.block.timestamp = BigInt.fromI32(1700000000);
    handleTerminateService(termEvent);

    assert.fieldEquals(
      "Multisig",
      MULTISIG_1.toHexString(),
      "terminatedAt",
      "1700000000",
    );
  });

  test("No-op when serviceId is unknown (no ServiceIndex)", () => {
    handleTerminateService(createTerminateServiceEvent(SERVICE_ID_1));

    // Nothing to assert except that no entity exploded
    assert.notInStore("Multisig", MULTISIG_1.toHexString());
  });
});
