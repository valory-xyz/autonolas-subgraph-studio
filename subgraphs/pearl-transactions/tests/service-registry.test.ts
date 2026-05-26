import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  afterEach,
  newMockEvent,
} from "matchstick-as/assembly/index";
import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { RegisterInstance } from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import { handleRegisterInstance } from "../src/service-registry";

// Scaffold smoke test. Phase 1a will replace these with the full Phase 1
// test suite from IMPLEMENTATION-PLAN.md §10 (agent-ID tagging,
// RegisterInstance/CreateMultisigWithAgents ordering, Master Safe
// resolution from staking + NFT transfer, SRTU bond rows with bondType
// attribution, full stake→claim→unstake lifecycle, daily-snapshot
// rollover).

function createRegisterInstanceEvent(
  operator: Address,
  serviceId: BigInt,
  agentInstance: Address,
  agentId: BigInt
): RegisterInstance {
  const mockEvent = newMockEvent();
  const event = new RegisterInstance(
    mockEvent.address,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("operator", ethereum.Value.fromAddress(operator))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "agentInstance",
      ethereum.Value.fromAddress(agentInstance)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "agentId",
      ethereum.Value.fromUnsignedBigInt(agentId)
    )
  );
  return event;
}

describe("pearl-transactions scaffold", () => {
  beforeEach(() => {
    clearStore();
  });

  afterEach(() => {
    clearStore();
  });

  test("handleRegisterInstance writes a minimal Service row", () => {
    const operator = Address.fromString(
      "0x1111111111111111111111111111111111111111"
    );
    const agentInstance = Address.fromString(
      "0x2222222222222222222222222222222222222222"
    );
    const serviceId = BigInt.fromI32(42);
    const agentId = BigInt.fromI32(25);

    const event = createRegisterInstanceEvent(
      operator,
      serviceId,
      agentInstance,
      agentId
    );
    handleRegisterInstance(event);

    assert.fieldEquals("Service", "42", "serviceId", "42");
  });

  test("handleRegisterInstance is idempotent for the same serviceId", () => {
    const operator = Address.fromString(
      "0x1111111111111111111111111111111111111111"
    );
    const agentInstance = Address.fromString(
      "0x2222222222222222222222222222222222222222"
    );
    const serviceId = BigInt.fromI32(7);
    const agentId = BigInt.fromI32(25);

    handleRegisterInstance(
      createRegisterInstanceEvent(operator, serviceId, agentInstance, agentId)
    );
    handleRegisterInstance(
      createRegisterInstanceEvent(operator, serviceId, agentInstance, agentId)
    );

    assert.entityCount("Service", 1);
  });
});
