import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
  dataSourceMock,
  describe,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Transfer as OlasTransfer } from "../generated/OLAS/ERC20";
import {
  AddedOwner,
  ChangedThreshold,
  RemovedOwner,
  SafeReceived,
} from "../generated/templates/Safe/GnosisSafe";
import { MasterSafe, TrackedEOA, TrackedSafe } from "../generated/schema";
import { handleOlasTransfer } from "../src/erc20";
import {
  handleSafeAddedOwner,
  handleSafeChangedThreshold,
  handleSafeReceived,
  handleSafeRemovedOwner,
} from "../src/safe";

// ----------------- Fixtures -----------------

const ZERO = Address.zero();
const MASTER_EOA = Address.fromString(
  "0x1111111111111111111111111111111111111111"
);
const BACKUP_EOA = Address.fromString(
  "0x2222222222222222222222222222222222222222"
);
const NEW_OWNER = Address.fromString(
  "0x3333333333333333333333333333333333333333"
);
const MASTER_SAFE = Address.fromString(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
);
const AGENT_SAFE = Address.fromString(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
);
const AGENT_EOA = Address.fromString(
  "0xcccccccccccccccccccccccccccccccccccccccc"
);
const RANDOM_EOA = Address.fromString(
  "0xdddddddddddddddddddddddddddddddddddddddd"
);
const OLAS_GNOSIS = Address.fromString(
  "0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f"
);
const AMOUNT = BigInt.fromString("5000000000000000000"); // 5 OLAS
const SERVICE_ID = "42";

function mockTx(salt: i32): Bytes {
  return Bytes.fromHexString(
    "0x" + "00".repeat(28) + salt.toString(16).padStart(8, "0")
  );
}

// ----------------- Event constructors -----------------

function setMockEventBoilerplate<T extends ethereum.Event>(
  event: T,
  txHash: Bytes,
  logIndex: i32,
  address: Address
): T {
  event.address = address;
  event.transaction.hash = txHash;
  event.logIndex = BigInt.fromI32(logIndex);
  return event;
}

function newOlasTransfer(
  from: Address,
  to: Address,
  amount: BigInt,
  txHash: Bytes,
  logIndex: i32
): OlasTransfer {
  const mock = newMockEvent();
  const e = new OlasTransfer(
    mock.address,
    mock.logIndex,
    mock.transactionLogIndex,
    mock.logType,
    mock.block,
    mock.transaction,
    mock.parameters,
    mock.receipt
  );
  e.parameters = new Array();
  e.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from))
  );
  e.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to))
  );
  e.parameters.push(
    new ethereum.EventParam(
      "value",
      ethereum.Value.fromUnsignedBigInt(amount)
    )
  );
  return setMockEventBoilerplate(e, txHash, logIndex, OLAS_GNOSIS);
}

function newSafeReceived(
  sender: Address,
  value: BigInt,
  safe: Address,
  txHash: Bytes,
  logIndex: i32
): SafeReceived {
  const mock = newMockEvent();
  const e = new SafeReceived(
    mock.address,
    mock.logIndex,
    mock.transactionLogIndex,
    mock.logType,
    mock.block,
    mock.transaction,
    mock.parameters,
    mock.receipt
  );
  e.parameters = new Array();
  e.parameters.push(
    new ethereum.EventParam("sender", ethereum.Value.fromAddress(sender))
  );
  e.parameters.push(
    new ethereum.EventParam(
      "value",
      ethereum.Value.fromUnsignedBigInt(value)
    )
  );
  return setMockEventBoilerplate(e, txHash, logIndex, safe);
}

function newAddedOwner(
  owner: Address,
  safe: Address,
  txHash: Bytes
): AddedOwner {
  const mock = newMockEvent();
  const e = new AddedOwner(
    mock.address,
    mock.logIndex,
    mock.transactionLogIndex,
    mock.logType,
    mock.block,
    mock.transaction,
    mock.parameters,
    mock.receipt
  );
  e.parameters = new Array();
  e.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  );
  return setMockEventBoilerplate(e, txHash, 0, safe);
}

function newRemovedOwner(
  owner: Address,
  safe: Address,
  txHash: Bytes
): RemovedOwner {
  const mock = newMockEvent();
  const e = new RemovedOwner(
    mock.address,
    mock.logIndex,
    mock.transactionLogIndex,
    mock.logType,
    mock.block,
    mock.transaction,
    mock.parameters,
    mock.receipt
  );
  e.parameters = new Array();
  e.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  );
  return setMockEventBoilerplate(e, txHash, 0, safe);
}

function newChangedThreshold(
  threshold: BigInt,
  safe: Address,
  txHash: Bytes
): ChangedThreshold {
  const mock = newMockEvent();
  const e = new ChangedThreshold(
    mock.address,
    mock.logIndex,
    mock.transactionLogIndex,
    mock.logType,
    mock.block,
    mock.transaction,
    mock.parameters,
    mock.receipt
  );
  e.parameters = new Array();
  e.parameters.push(
    new ethereum.EventParam(
      "threshold",
      ethereum.Value.fromUnsignedBigInt(threshold)
    )
  );
  return setMockEventBoilerplate(e, txHash, 0, safe);
}

// ----------------- Test setup helpers -----------------

function seedMasterSafe(setupTransferSeen: boolean): void {
  const ms = new MasterSafe(MASTER_SAFE);
  ms.network = "gnosis";
  ms.masterEoa = MASTER_EOA;
  ms.owners = [MASTER_EOA, BACKUP_EOA];
  ms.threshold = BigInt.fromI32(1);
  ms.firstSeenTimestamp = BigInt.fromI32(1);
  ms.firstSeenBlock = BigInt.fromI32(1);
  ms.lastActivityTimestamp = BigInt.fromI32(1);
  ms.setupTransferSeen = setupTransferSeen;
  ms.save();

  const trackedSafe = new TrackedSafe(MASTER_SAFE);
  trackedSafe.role = "MASTER";
  trackedSafe.masterSafe = MASTER_SAFE;
  trackedSafe.save();

  const trackedEoa = new TrackedEOA(MASTER_EOA);
  trackedEoa.role = "MASTER_EOA";
  trackedEoa.masterSafe = MASTER_SAFE;
  trackedEoa.firstTrackedBlock = BigInt.fromI32(1);
  trackedEoa.save();
}

function seedAgentSafe(serviceId: string): void {
  const trackedSafe = new TrackedSafe(AGENT_SAFE);
  trackedSafe.role = "AGENT";
  trackedSafe.masterSafe = MASTER_SAFE;
  trackedSafe.service = serviceId;
  trackedSafe.save();

  const trackedEoa = new TrackedEOA(AGENT_EOA);
  trackedEoa.role = "AGENT_EOA";
  trackedEoa.masterSafe = MASTER_SAFE;
  trackedEoa.service = serviceId;
  trackedEoa.firstTrackedBlock = BigInt.fromI32(1);
  trackedEoa.save();
}

// ----------------- Tests -----------------

describe("pearl-transactions / Phase 2a — raw OLAS + Safe template", () => {
  beforeEach(() => {
    clearStore();
    dataSourceMock.setNetwork("gnosis");
  });

  afterEach(() => {
    clearStore();
  });

  test("Master EOA → Master Safe (first hop) classifies as SAFE_SETUP_TRANSFER", () => {
    seedMasterSafe(/* setupTransferSeen = */ false);
    const tx = mockTx(1);
    handleOlasTransfer(newOlasTransfer(MASTER_EOA, MASTER_SAFE, AMOUNT, tx, 0));

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "SAFE_SETUP_TRANSFER"
    );
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "amount",
      AMOUNT.toString()
    );
    // Flag should now be true.
    assert.fieldEquals(
      "MasterSafe",
      MASTER_SAFE.toHexString(),
      "setupTransferSeen",
      "true"
    );
  });

  test("Master EOA → Master Safe (subsequent hops) classify as MASTER_FUNDING_IN", () => {
    seedMasterSafe(/* setupTransferSeen = */ true);
    const tx = mockTx(2);
    handleOlasTransfer(newOlasTransfer(MASTER_EOA, MASTER_SAFE, AMOUNT, tx, 0));

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "MASTER_FUNDING_IN"
    );
  });

  test("Master Safe → Agent Safe groups under AgentFundingEvent", () => {
    seedMasterSafe(true);
    seedAgentSafe(SERVICE_ID);

    const tx = mockTx(3);
    handleOlasTransfer(newOlasTransfer(MASTER_SAFE, AGENT_SAFE, AMOUNT, tx, 0));
    handleOlasTransfer(
      newOlasTransfer(MASTER_SAFE, AGENT_EOA, AMOUNT, tx, 1)
    );

    assert.entityCount("AgentFundingEvent", 1);
    // Both FundsMovement rows recorded, both linked to same AgentFundingEvent.
    assert.entityCount("FundsMovement", 2);

    const id0 = tx.concatI32(0);
    const id1 = tx.concatI32(1);
    assert.fieldEquals(
      "FundsMovement",
      id0.toHexString(),
      "category",
      "MASTER_TO_AGENT"
    );
    assert.fieldEquals(
      "FundsMovement",
      id1.toHexString(),
      "category",
      "MASTER_TO_AGENT"
    );
  });

  test("Agent Safe → Master Safe classifies as AGENT_TO_MASTER (reward sweep)", () => {
    seedMasterSafe(true);
    seedAgentSafe(SERVICE_ID);

    const tx = mockTx(4);
    handleOlasTransfer(newOlasTransfer(AGENT_SAFE, MASTER_SAFE, AMOUNT, tx, 0));

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "AGENT_TO_MASTER"
    );
  });

  test("Master Safe → random EOA classifies as MASTER_WITHDRAWAL", () => {
    seedMasterSafe(true);
    const tx = mockTx(5);
    handleOlasTransfer(newOlasTransfer(MASTER_SAFE, RANDOM_EOA, AMOUNT, tx, 0));

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "MASTER_WITHDRAWAL"
    );
  });

  test("Untracked → untracked Transfer is dropped", () => {
    seedMasterSafe(true);
    const tx = mockTx(6);
    handleOlasTransfer(newOlasTransfer(RANDOM_EOA, RANDOM_EOA, AMOUNT, tx, 0));
    assert.entityCount("FundsMovement", 0);
  });

  test("SafeReceived (native inbound) records row with token=null", () => {
    seedMasterSafe(true);
    const tx = mockTx(7);
    handleSafeReceived(newSafeReceived(MASTER_EOA, AMOUNT, MASTER_SAFE, tx, 0));

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "MASTER_FUNDING_IN"
    );
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "amount",
      AMOUNT.toString()
    );
  });

  test("AddedOwner / RemovedOwner / ChangedThreshold keep MasterSafe owners current", () => {
    seedMasterSafe(true);
    const tx = mockTx(8);

    handleSafeAddedOwner(newAddedOwner(NEW_OWNER, MASTER_SAFE, tx));
    assert.fieldEquals(
      "MasterSafe",
      MASTER_SAFE.toHexString(),
      "owners",
      "[" +
        MASTER_EOA.toHexString() +
        ", " +
        BACKUP_EOA.toHexString() +
        ", " +
        NEW_OWNER.toHexString() +
        "]"
    );

    handleSafeChangedThreshold(
      newChangedThreshold(BigInt.fromI32(2), MASTER_SAFE, tx)
    );
    assert.fieldEquals(
      "MasterSafe",
      MASTER_SAFE.toHexString(),
      "threshold",
      "2"
    );

    handleSafeRemovedOwner(newRemovedOwner(BACKUP_EOA, MASTER_SAFE, tx));
    assert.fieldEquals(
      "MasterSafe",
      MASTER_SAFE.toHexString(),
      "owners",
      "[" + MASTER_EOA.toHexString() + ", " + NEW_OWNER.toHexString() + "]"
    );
  });
});
