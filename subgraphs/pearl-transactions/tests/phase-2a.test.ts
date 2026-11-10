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
  ExecutionFromModuleSuccess,
  ExecutionSuccess,
  RemovedOwner,
  SafeReceived,
} from "../generated/templates/Safe/GnosisSafe";
import { TokenDeposit } from "../generated/ServiceRegistryTokenUtility/ServiceRegistryTokenUtility";
import {
  AgentInstance,
  FundsMovement,
  MasterSafe,
  Service,
  TrackedAddress,
} from "../generated/schema";
import { handleErc20Transfer } from "../src/erc20";
import {
  handleSafeAddedOwner,
  handleSafeChangedThreshold,
  handleSafeExecutionFromModuleSuccess,
  handleSafeExecutionSuccess,
  handleSafeReceived,
  handleSafeRemovedOwner,
} from "../src/safe";
import { handleTokenDeposit } from "../src/service-registry-token-utility";
import {
  agentFundingEventId,
  agentSafeTopUpId,
  multiSendNativeLegs,
} from "../src/utils";

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
const SRTU_GNOSIS = Address.fromString(
  "0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8"
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

// newTokenDeposit — SRTU TokenDeposit(account, token, amount). Used to
// verify the bond legs' TokenBalance booking (the raw Master ↔ SRTU
// Transfer is suppressed; the SRTU handler owns the balance delta).
function newTokenDeposit(
  account: Address,
  token: Address,
  amount: BigInt,
  txHash: Bytes,
  logIndex: i32
): TokenDeposit {
  const mock = newMockEvent();
  const e = new TokenDeposit(
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
    new ethereum.EventParam("account", ethereum.Value.fromAddress(account))
  );
  e.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  );
  e.parameters.push(
    new ethereum.EventParam(
      "amount",
      ethereum.Value.fromUnsignedBigInt(amount)
    )
  );
  return setMockEventBoilerplate(e, txHash, logIndex, SRTU_GNOSIS);
}

// newErc20TransferAt — a Transfer event whose `event.address` is an
// arbitrary token (handleErc20Transfer reads event.address for the row's
// `token`, so the same handler serves every ERC-20 data source).
function newErc20TransferAt(
  token: Address,
  from: Address,
  to: Address,
  amount: BigInt,
  txHash: Bytes,
  logIndex: i32
): OlasTransfer {
  const e = newOlasTransfer(from, to, amount, txHash, logIndex);
  e.address = token;
  return e;
}

// assertStablecoinResolves — seed a Master Safe (setupTransferSeen=true so
// the inbound classifies as MASTER_FUNDING_IN), fire a Master EOA → Master
// Safe stablecoin Transfer on `network`, and assert the Token resolves to
// the expected 6-decimal symbol. File-scoped (not nested in a describe) to
// avoid the AssemblyScript closure-capture WASM-validator error.
function assertStablecoinResolves(
  network: string,
  tokenStr: string,
  expectedSymbol: string,
  salt: i32
): void {
  dataSourceMock.setNetwork(network);
  seedMasterSafe(true);
  const token = Address.fromString(tokenStr);
  const tx = mockTx(salt);
  handleErc20Transfer(
    newErc20TransferAt(
      token,
      MASTER_EOA,
      MASTER_SAFE,
      BigInt.fromString("1000000"),
      tx,
      0
    )
  );
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
    "token",
    token.toHexString()
  );
  assert.fieldEquals("Token", token.toHexString(), "symbol", expectedSymbol);
  assert.fieldEquals("Token", token.toHexString(), "decimals", "6");
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

const EXEC_TRANSACTION_SELECTOR = Bytes.fromHexString("0x6a761202");
// Bytes.empty() is four zero bytes (ByteArray.fromI32(0)), not zero-length.
const NO_DATA = new Bytes(0);

// Calldata of Safe.execTransaction(to, value, data, operation, 0, 0, 0, 0x0,
// 0x0, sig). ethereum.encode of a dynamic tuple leads with an offset word
// that real calldata does not have, so it is dropped.
function execTransactionInput(
  to: Address,
  value: BigInt,
  data: Bytes,
  operation: i32,
  selector: Bytes = EXEC_TRANSACTION_SELECTOR
): Bytes {
  const args = new ethereum.Tuple();
  args.push(ethereum.Value.fromAddress(to));
  args.push(ethereum.Value.fromUnsignedBigInt(value));
  args.push(ethereum.Value.fromBytes(data));
  args.push(ethereum.Value.fromI32(operation));
  args.push(ethereum.Value.fromUnsignedBigInt(BigInt.zero()));
  args.push(ethereum.Value.fromUnsignedBigInt(BigInt.zero()));
  args.push(ethereum.Value.fromUnsignedBigInt(BigInt.zero()));
  args.push(ethereum.Value.fromAddress(ZERO));
  args.push(ethereum.Value.fromAddress(ZERO));
  args.push(
    ethereum.Value.fromBytes(Bytes.fromHexString("0x" + "01".repeat(65)))
  );
  const encoded = ethereum.encode(ethereum.Value.fromTuple(args))!;
  return selector.concat(Bytes.fromUint8Array(encoded.subarray(32)));
}

function newExecutionSuccess(
  safe: Address,
  txFrom: Address,
  txTo: Address,
  input: Bytes,
  txHash: Bytes,
  logIndex: i32
): ExecutionSuccess {
  const mock = newMockEvent();
  const e = new ExecutionSuccess(
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
      "txHash",
      ethereum.Value.fromFixedBytes(Bytes.fromHexString("0x" + "ab".repeat(32)))
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "payment",
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    )
  );
  e.transaction.from = txFrom;
  e.transaction.to = txTo;
  e.transaction.input = input;
  return setMockEventBoilerplate(e, txHash, logIndex, safe);
}

function newExecutionFromModuleSuccess(
  safe: Address,
  txFrom: Address,
  txTo: Address,
  input: Bytes,
  txHash: Bytes
): ExecutionFromModuleSuccess {
  const mock = newMockEvent();
  const e = new ExecutionFromModuleSuccess(
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
    new ethereum.EventParam("module", ethereum.Value.fromAddress(RANDOM_EOA))
  );
  e.transaction.from = txFrom;
  e.transaction.to = txTo;
  e.transaction.input = input;
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
  ms.historyFloorBlock = BigInt.fromI32(1);
  ms.historyFloorTimestamp = BigInt.fromI32(1);
  ms.lastActivityTimestamp = BigInt.fromI32(1);
  ms.setupTransferSeen = setupTransferSeen;
  ms.save();

  seedTrackedAddress(MASTER_SAFE, "MASTER", MASTER_SAFE, null);
  seedTrackedAddress(MASTER_EOA, "MASTER_EOA", MASTER_SAFE, null);
}

// serviceEntityId equivalent for tests — Service.id is the serviceId as Bytes.
function serviceBytes(serviceId: string): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(BigInt.fromString(serviceId)));
}

function seedTrackedAddress(
  address: Address,
  role: string,
  masterSafe: Address | null,
  service: Bytes | null
): void {
  const tracked = new TrackedAddress(address);
  tracked.role = role;
  if (masterSafe !== null) tracked.masterSafe = masterSafe;
  if (service !== null) tracked.service = service;
  tracked.firstTrackedBlock = BigInt.fromI32(1);
  tracked.save();
}

function seedAgentSafe(serviceId: string): void {
  const svc = serviceBytes(serviceId);
  seedTrackedAddress(AGENT_SAFE, "AGENT", MASTER_SAFE, svc);
  seedTrackedAddress(AGENT_EOA, "AGENT_EOA", MASTER_SAFE, svc);
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
    handleErc20Transfer(newOlasTransfer(MASTER_EOA, MASTER_SAFE, AMOUNT, tx, 0));

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
    handleErc20Transfer(newOlasTransfer(MASTER_EOA, MASTER_SAFE, AMOUNT, tx, 0));

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "MASTER_FUNDING_IN"
    );
  });

  test("ServiceRegistryL2 dust → Master Safe classifies as OTHER, not MASTER_FUNDING_IN", () => {
    seedMasterSafe(/* setupTransferSeen = */ true);
    // The ServiceRegistryL2 contract sends tiny native dust to the Master
    // Safe during terminate / unbond. It shares the classifier with the
    // OLAS handler, so a transfer from the registry address must NOT be
    // mistaken for a user deposit.
    const REGISTRY_GNOSIS = Address.fromString(
      "0x9338b5153AE39BB89f50468E608eD9d764B755fD"
    );
    const tx = mockTx(99);
    handleErc20Transfer(
      newOlasTransfer(REGISTRY_GNOSIS, MASTER_SAFE, AMOUNT, tx, 0)
    );

    const id = tx.concatI32(0);
    assert.fieldEquals("FundsMovement", id.toHexString(), "category", "OTHER");
  });

  test("Master Safe → Agent Safe groups under AgentFundingEvent", () => {
    seedMasterSafe(true);
    seedAgentSafe(SERVICE_ID);

    const tx = mockTx(3);
    handleErc20Transfer(newOlasTransfer(MASTER_SAFE, AGENT_SAFE, AMOUNT, tx, 0));
    handleErc20Transfer(
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

  test("Agent Safe → Master Safe in OLAS classifies as AGENT_OLAS_TO_MASTER", () => {
    seedMasterSafe(true);
    seedAgentSafe(SERVICE_ID);

    const tx = mockTx(4);
    handleErc20Transfer(newOlasTransfer(AGENT_SAFE, MASTER_SAFE, AMOUNT, tx, 0));

    // OLAS agent→master (the reward-sweep bucket) gets its own category so
    // the wallet can exclude it at query time.
    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "AGENT_OLAS_TO_MASTER"
    );

    // Lock the token gate: the category only flips because the token is OLAS.
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "token",
      OLAS_GNOSIS.toHexString()
    );

    // AGENT_OLAS_TO_MASTER must move balances exactly like AGENT_TO_MASTER —
    // the Master Safe (to) is credited and the Agent Safe (from) debited. These
    // assertions fail if either TokenBalance branch in erc20.ts is dropped.
    assert.fieldEquals(
      "TokenBalance",
      MASTER_SAFE.concat(OLAS_GNOSIS).toHexString(),
      "balance",
      AMOUNT.toString()
    );
    assert.fieldEquals(
      "TokenBalance",
      AGENT_SAFE.concat(OLAS_GNOSIS).toHexString(),
      "balance",
      AMOUNT.neg().toString()
    );
  });

  test("Agent Safe → Master Safe in a non-OLAS token stays AGENT_TO_MASTER", () => {
    seedMasterSafe(true);
    seedAgentSafe(SERVICE_ID);

    // The split is token-gated: only OLAS becomes AGENT_OLAS_TO_MASTER.
    const usdc = Address.fromString(
      "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83"
    );
    const tx = mockTx(41);
    handleErc20Transfer(
      newErc20TransferAt(
        usdc,
        AGENT_SAFE,
        MASTER_SAFE,
        BigInt.fromString("1000000"),
        tx,
        0
      )
    );

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
    handleErc20Transfer(newOlasTransfer(MASTER_SAFE, RANDOM_EOA, AMOUNT, tx, 0));

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
    handleErc20Transfer(newOlasTransfer(RANDOM_EOA, RANDOM_EOA, AMOUNT, tx, 0));
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

  // --- Plan §10 gap tests added in response to coverage audit -------

  test("Master EOA → unrelated EOA classifies as OTHER (not dropped)", () => {
    seedMasterSafe(true);
    const tx = mockTx(20);
    handleErc20Transfer(newOlasTransfer(MASTER_EOA, RANDOM_EOA, AMOUNT, tx, 0));

    // Per plan §10: "Master EOA → unrelated EOA classified OTHER,
    // not silently dropped."
    assert.entityCount("FundsMovement", 1);
    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "OTHER"
    );
  });

  test("Master Safe → SRTU OLAS Transfer emits no RAW bond row (deduped vs SEMANTIC)", () => {
    seedMasterSafe(true);
    const SRTU_GNOSIS = Address.fromString(
      "0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8"
    );
    const tx = mockTx(21);
    handleErc20Transfer(newOlasTransfer(MASTER_SAFE, SRTU_GNOSIS, AMOUNT, tx, 0));

    // classifyTransfer drops the Master Safe ↔ SRTU OLAS hop: the SRTU
    // handler already books the canonical SEMANTIC bond row (now carrying
    // masterSafe), so a second RAW_TRANSFER row here would double-count
    // the bond in a masterSafe-filtered wallet query.
    assert.entityCount("FundsMovement", 0);
  });

  test("SRTU → Master Safe OLAS Transfer emits no RAW bond row (deduped vs SEMANTIC)", () => {
    seedMasterSafe(true);
    const SRTU_GNOSIS = Address.fromString(
      "0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8"
    );
    const tx = mockTx(22);
    handleErc20Transfer(newOlasTransfer(SRTU_GNOSIS, MASTER_SAFE, AMOUNT, tx, 0));

    assert.entityCount("FundsMovement", 0);
  });

  test("StakingProxy → Agent Safe OLAS Transfer = STAKING_REWARD_CLAIM raw reconciliation", () => {
    seedMasterSafe(true);
    seedAgentSafe("42");
    // Seed the staking proxy as a TrackedAddress(STAKING) — classifyTransfer
    // now keys the reward-claim path on the merged tracked-address table.
    const STAKING_PROXY = Address.fromString(
      "0x9999999999999999999999999999999999999999"
    );
    seedTrackedAddress(STAKING_PROXY, "STAKING", null, null);

    const tx = mockTx(23);
    handleErc20Transfer(newOlasTransfer(STAKING_PROXY, AGENT_SAFE, AMOUNT, tx, 0));

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "STAKING_REWARD_CLAIM"
    );
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "source",
      "RAW_TRANSFER"
    );
  });

  test("Agent Safe → unknown app contract = AGENT_TO_APP", () => {
    seedMasterSafe(true);
    seedAgentSafe("42");
    const APP = Address.fromString(
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    );
    const tx = mockTx(24);
    handleErc20Transfer(newOlasTransfer(AGENT_SAFE, APP, AMOUNT, tx, 0));

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "AGENT_TO_APP"
    );
  });

  test("Unknown app contract → Agent Safe = APP_TO_AGENT", () => {
    seedMasterSafe(true);
    seedAgentSafe("42");
    const APP = Address.fromString(
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    );
    const tx = mockTx(25);
    handleErc20Transfer(newOlasTransfer(APP, AGENT_SAFE, AMOUNT, tx, 0));

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "APP_TO_AGENT"
    );
  });

  test("TokenBalance running total accumulates across MASTER_FUNDING_IN hops", () => {
    seedMasterSafe(true);
    const tx1 = mockTx(26);
    handleErc20Transfer(newOlasTransfer(MASTER_EOA, MASTER_SAFE, AMOUNT, tx1, 0));
    const tx2 = mockTx(27);
    handleErc20Transfer(newOlasTransfer(MASTER_EOA, MASTER_SAFE, AMOUNT, tx2, 0));

    // TokenBalance id = safe.concat(token).
    const id = MASTER_SAFE.concat(OLAS_GNOSIS);
    // Two inflows of AMOUNT each → 2 × AMOUNT.
    assert.fieldEquals(
      "TokenBalance",
      id.toHexString(),
      "balance",
      AMOUNT.plus(AMOUNT).toString()
    );
  });

  test("Master Safe → SRTU bond leg debits the OLAS TokenBalance exactly once", () => {
    // Review #149 finding 3: the raw Master ↔ SRTU Transfer is suppressed in
    // classifyTransfer (deduped against the SEMANTIC BondMovement row), so
    // handleErc20Transfer applies NO balance delta for it — the SRTU handler
    // books the bond's balance effect instead. Without that, the Master
    // Safe's balance overstates by the bonded amount for the whole staking
    // period. On-chain both events fire in the same tx; mirror that here.
    seedMasterSafe(true);
    const balId = MASTER_SAFE.concat(OLAS_GNOSIS);

    // Fund the Master Safe with 5 OLAS.
    const tx1 = mockTx(280);
    handleErc20Transfer(newOlasTransfer(MASTER_EOA, MASTER_SAFE, AMOUNT, tx1, 0));
    assert.fieldEquals(
      "TokenBalance",
      balId.toHexString(),
      "balance",
      AMOUNT.toString()
    );

    // Post a 1 OLAS bond: raw Transfer (suppressed) + TokenDeposit (booked).
    const bond = BigInt.fromString("1000000000000000000");
    const tx2 = mockTx(281);
    handleErc20Transfer(newOlasTransfer(MASTER_SAFE, SRTU_GNOSIS, bond, tx2, 0));
    handleTokenDeposit(
      newTokenDeposit(MASTER_SAFE, OLAS_GNOSIS, bond, tx2, 1)
    );

    // The raw leg produced no FundsMovement (deduped)…
    assert.notInStore("FundsMovement", tx2.concatI32(0).toHexString());
    // …the SEMANTIC bond row exists…
    assert.fieldEquals(
      "BondMovement",
      tx2.concatI32(1).toHexString(),
      "category",
      "SERVICE_BOND_DEPOSIT"
    );
    // …and the balance reflects the bond debit exactly once.
    assert.fieldEquals(
      "TokenBalance",
      balId.toHexString(),
      "balance",
      AMOUNT.minus(bond).toString()
    );
  });

  test("Master Safe A → Master Safe B credits B and debits A", () => {
    // Review #149 finding 4: master→master (funds migration between Pearl
    // installs) classifies as MASTER_FUNDING_IN for the recipient; the
    // sender's debit rides on ClassifyResult.senderMasterId. (A's
    // masterSafe-filtered HISTORY intentionally shows no outgoing row —
    // documented limitation, same shape as the native-out gap.)
    seedMasterSafe(true); // A = MASTER_SAFE

    const MASTER_B = Address.fromString(
      "0x9999999999999999999999999999999999999999"
    );
    const msB = new MasterSafe(MASTER_B);
    msB.network = "gnosis";
    msB.masterEoa = NEW_OWNER;
    msB.owners = [NEW_OWNER];
    msB.threshold = BigInt.fromI32(1);
    msB.firstSeenTimestamp = BigInt.fromI32(1);
    msB.firstSeenBlock = BigInt.fromI32(1);
    msB.historyFloorBlock = BigInt.fromI32(1);
    msB.historyFloorTimestamp = BigInt.fromI32(1);
    msB.lastActivityTimestamp = BigInt.fromI32(1);
    msB.setupTransferSeen = true;
    msB.save();
    seedTrackedAddress(MASTER_B, "MASTER", MASTER_B, null);

    // Fund A with 5 OLAS, then migrate all of it to B.
    const tx1 = mockTx(282);
    handleErc20Transfer(newOlasTransfer(MASTER_EOA, MASTER_SAFE, AMOUNT, tx1, 0));
    const tx2 = mockTx(283);
    handleErc20Transfer(newOlasTransfer(MASTER_SAFE, MASTER_B, AMOUNT, tx2, 0));

    // The row belongs to the recipient.
    assert.fieldEquals(
      "FundsMovement",
      tx2.concatI32(0).toHexString(),
      "category",
      "MASTER_FUNDING_IN"
    );
    // B is credited…
    assert.fieldEquals(
      "TokenBalance",
      MASTER_B.concat(OLAS_GNOSIS).toHexString(),
      "balance",
      AMOUNT.toString()
    );
    // …and A is debited (senderMasterId path).
    assert.fieldEquals(
      "TokenBalance",
      MASTER_SAFE.concat(OLAS_GNOSIS).toHexString(),
      "balance",
      "0"
    );
  });

  test("same-tx OLAS + USDC Master → Agent funding keeps totalOlasAmount OLAS-only", () => {
    // Review #149 finding 5: handleErc20Transfer serves every ERC-20 data
    // source, and AgentFundingEvent groups per (tx, masterSafe, service) —
    // not per token. totalOlasAmount is documented OLAS-only, so the bump is
    // gated on the token; non-OLAS legs still link via `transfers`.
    seedMasterSafe(true);
    seedAgentSafe(SERVICE_ID);
    const usdc = Address.fromString(
      "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83" // gnosis USDC, 6 dec
    );

    const tx = mockTx(284);
    const olasLeg = BigInt.fromString("1000000000000000000"); // 1 OLAS (1e18)
    const usdcLeg = BigInt.fromString("100000000"); // 100 USDC (1e8)
    handleErc20Transfer(newOlasTransfer(MASTER_SAFE, AGENT_SAFE, olasLeg, tx, 0));
    handleErc20Transfer(
      newErc20TransferAt(usdc, MASTER_SAFE, AGENT_SAFE, usdcLeg, tx, 1)
    );

    // Both legs group under one event…
    assert.entityCount("AgentFundingEvent", 1);
    const afeId = tx.concat(MASTER_SAFE).concat(serviceBytes(SERVICE_ID));
    // …both rows link to it…
    assert.fieldEquals(
      "FundsMovement",
      tx.concatI32(0).toHexString(),
      "agentFundingEvent",
      afeId.toHexString()
    );
    assert.fieldEquals(
      "FundsMovement",
      tx.concatI32(1).toHexString(),
      "agentFundingEvent",
      afeId.toHexString()
    );
    // …but the OLAS total contains ONLY the OLAS leg, not mixed-decimal raw
    // units (1e18 + 1e8 summed across tokens).
    assert.fieldEquals(
      "AgentFundingEvent",
      afeId.toHexString(),
      "totalOlasAmount",
      olasLeg.toString()
    );
  });

  // --- Rev. 4 (PR #130 review) new behaviors ---------------------------

  test("WrappedNative Transfer routed via the same generic handler as OLAS", () => {
    seedMasterSafe(true);
    seedAgentSafe("42");
    const WXDAI_GNOSIS = Address.fromString(
      "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d"
    );
    // Build a Transfer event whose event.address is WXDAI (the
    // WrappedNative data source). handleErc20Transfer reads
    // event.address for the row's `token` field, so the same handler
    // works regardless of which token contract fired.
    const tx = mockTx(28);
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
      new ethereum.EventParam("from", ethereum.Value.fromAddress(MASTER_SAFE))
    );
    e.parameters.push(
      new ethereum.EventParam("to", ethereum.Value.fromAddress(AGENT_SAFE))
    );
    e.parameters.push(
      new ethereum.EventParam(
        "value",
        ethereum.Value.fromUnsignedBigInt(AMOUNT)
      )
    );
    e.address = WXDAI_GNOSIS;
    e.transaction.hash = tx;
    e.logIndex = BigInt.fromI32(0);

    handleErc20Transfer(e);

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "MASTER_TO_AGENT"
    );
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "token",
      WXDAI_GNOSIS.toHexString()
    );
    // Token entity carries the correct per-chain symbol (WXDAI on
    // Gnosis; getOrCreateToken resolves via getWrappedNativeSymbol).
    assert.fieldEquals(
      "Token",
      WXDAI_GNOSIS.toHexString(),
      "symbol",
      "WXDAI"
    );
  });

  test("first live Master EOA → Master Safe inbound is SAFE_SETUP_TRANSFER, subsequent are MASTER_FUNDING_IN", () => {
    // Per AC #3 / Path A, the first live Master EOA → Master Safe hop
    // observed after first sighting (setupTransferSeen=false) classifies
    // as SAFE_SETUP_TRANSFER; the flag then flips and subsequent hops are
    // MASTER_FUNDING_IN.
    seedMasterSafe(/* setupTransferSeen = */ false);

    const tx = mockTx(29);
    handleErc20Transfer(newOlasTransfer(MASTER_EOA, MASTER_SAFE, AMOUNT, tx, 0));

    const id = tx.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "SAFE_SETUP_TRANSFER"
    );
    assert.fieldEquals(
      "MasterSafe",
      MASTER_SAFE.toHexString(),
      "setupTransferSeen",
      "true"
    );

    // Second live hop falls through to MASTER_FUNDING_IN.
    const tx2 = mockTx(30);
    handleErc20Transfer(newOlasTransfer(MASTER_EOA, MASTER_SAFE, AMOUNT, tx2, 0));
    const id2 = tx2.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id2.toHexString(),
      "category",
      "MASTER_FUNDING_IN"
    );
  });

});

// ---- Phase 2b — stablecoins (USDC / USDC.e / pUSD; all 6 decimals) ----
//
// Covers every (chain, token) tuple in getStablecoinSymbol so a typo in
// any address literal (or a missing resolver branch) fails loudly here
// instead of silently mapping to UNKNOWN/6 in production. Each case sets
// its own network so there's no cross-test ordering dependency.
describe("pearl-transactions / Phase 2b — stablecoins", () => {
  beforeEach(() => {
    clearStore();
    dataSourceMock.setNetwork("gnosis");
  });

  afterEach(() => {
    clearStore();
    // Reset so a stray network doesn't leak into any later suite.
    dataSourceMock.setNetwork("gnosis");
  });

  test("gnosis USDC resolves @ 6 decimals", () => {
    assertStablecoinResolves(
      "gnosis",
      "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83",
      "USDC",
      31
    );
  });

  test("gnosis USDC.e resolves @ 6 decimals", () => {
    assertStablecoinResolves(
      "gnosis",
      "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0",
      "USDC.e",
      32
    );
  });

  test("matic USDC resolves @ 6 decimals", () => {
    assertStablecoinResolves(
      "matic",
      "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      "USDC",
      33
    );
  });

  test("matic USDC.e resolves @ 6 decimals", () => {
    assertStablecoinResolves(
      "matic",
      "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      "USDC.e",
      34
    );
  });

  test("matic pUSD resolves @ 6 decimals", () => {
    assertStablecoinResolves(
      "matic",
      "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
      "pUSD",
      35
    );
  });

  test("optimism USDC resolves @ 6 decimals", () => {
    assertStablecoinResolves(
      "optimism",
      "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      "USDC",
      36
    );
  });

  test("optimism USDC.e resolves @ 6 decimals", () => {
    assertStablecoinResolves(
      "optimism",
      "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
      "USDC.e",
      37
    );
  });

  test("base USDC resolves @ 6 decimals", () => {
    assertStablecoinResolves(
      "base",
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "USDC",
      38
    );
  });
});

// Gnosis tx 0x6a542ed4e0bf5e84bd3408f1ba0e387dff5d232ba290aa0f91ee6128d37b5734:
// Agent Safe of service 0x3481…0658 sends 5.732515 xDAI to 0x4ced…8093.
// It is a withdrawal, not a top-up: its sender is the Agent Signer, not the
// payee. No real top-up exists on chain yet.
const REAL_SAFE = Address.fromString(
  "0x3481bc52e0be05a8c1d80f5ca30d19cf260e0658"
);
const REAL_RECIPIENT = Address.fromString(
  "0x4ced59b679664c00de0de117c0ef461481a98093"
);
const REAL_INPUT = Bytes.fromHexString(
  "0x6a761202" +
    "0000000000000000000000004ced59b679664c00de0de117c0ef461481a98093" +
    "0000000000000000000000000000000000000000000000004f8dfc0534993000" +
    "0000000000000000000000000000000000000000000000000000000000000140" +
    "0".repeat(64 * 6) +
    "0000000000000000000000000000000000000000000000000000000000000160" +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000041" +
    "9a21d2a2856a59f654e42f8ca8ba182c3113e03085fd3e53bee929cb3de51c9c" +
    "6d7bf7e6438eb825329f4f5b3613296d46c03a73f66fabe0d070741d149e21fa" +
    "1b00000000000000000000000000000000000000000000000000000000000000"
);

// ---- OPE-1965 — Agent Safe → Agent Signer native top-up ----
describe("pearl-transactions / AGENT_SAFE_TO_AGENT_EOA", () => {
  beforeEach(() => {
    clearStore();
    dataSourceMock.setNetwork("gnosis");
  });

  afterEach(() => {
    clearStore();
  });

  test("top-up sent by the Agent Signer writes one SEMANTIC native row", () => {
    seedAgentSafe(SERVICE_ID);
    const tx = mockTx(60);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        execTransactionInput(AGENT_EOA, AMOUNT, NO_DATA, 0),
        tx,
        3
      )
    );

    const id = agentSafeTopUpId(tx).toHexString();
    assert.entityCount("FundsMovement", 1);
    assert.fieldEquals("FundsMovement", id, "category", "AGENT_SAFE_TO_AGENT_EOA");
    assert.fieldEquals("FundsMovement", id, "source", "SEMANTIC");
    assert.fieldEquals("FundsMovement", id, "amount", AMOUNT.toString());
    assert.fieldEquals("FundsMovement", id, "from", AGENT_SAFE.toHexString());
    assert.fieldEquals("FundsMovement", id, "to", AGENT_EOA.toHexString());
    assert.assertTrue(FundsMovement.load(agentSafeTopUpId(tx))!.token === null);
    assert.fieldEquals("FundsMovement", id, "agentSafe", AGENT_SAFE.toHexString());
    assert.fieldEquals("FundsMovement", id, "masterSafe", MASTER_SAFE.toHexString());
    assert.fieldEquals(
      "FundsMovement",
      id,
      "service",
      serviceBytes(SERVICE_ID).toHexString()
    );
    assert.fieldEquals("FundsMovement", id, "transactionHash", tx.toHexString());
    assert.entityCount("TokenBalance", 0);
  });

  test("reentrant ExecutionSuccess from the same Safe in one tx writes one row", () => {
    seedAgentSafe(SERVICE_ID);
    const tx = mockTx(72);
    const input = execTransactionInput(AGENT_EOA, AMOUNT, NO_DATA, 0);
    // Inner execTransaction logs first, then the outer one; both carry the
    // outer tx input.
    handleSafeExecutionSuccess(
      newExecutionSuccess(AGENT_SAFE, AGENT_EOA, AGENT_SAFE, input, tx, 2)
    );
    handleSafeExecutionSuccess(
      newExecutionSuccess(AGENT_SAFE, AGENT_EOA, AGENT_SAFE, input, tx, 3)
    );
    assert.entityCount("FundsMovement", 1);
    assert.fieldEquals(
      "FundsMovement",
      agentSafeTopUpId(tx).toHexString(),
      "amount",
      AMOUNT.toString()
    );
  });

  test("outer tx not sent to the emitting Safe writes no row", () => {
    seedAgentSafe(SERVICE_ID);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        RANDOM_EOA,
        execTransactionInput(AGENT_EOA, AMOUNT, NO_DATA, 0),
        mockTx(61),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("selector other than execTransaction writes no row", () => {
    seedAgentSafe(SERVICE_ID);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        execTransactionInput(
          AGENT_EOA,
          AMOUNT,
          NO_DATA,
          0,
          Bytes.fromHexString("0xdeadbeef")
        ),
        mockTx(62),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("selector differing only in its last byte writes no row", () => {
    seedAgentSafe(SERVICE_ID);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        execTransactionInput(
          AGENT_EOA,
          AMOUNT,
          NO_DATA,
          0,
          Bytes.fromHexString("0x6a761203")
        ),
        mockTx(73),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("input shorter than a selector writes no row", () => {
    seedAgentSafe(SERVICE_ID);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        Bytes.fromHexString("0x6a76"),
        mockTx(74),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("truncated execTransaction calldata writes no row", () => {
    seedAgentSafe(SERVICE_ID);
    const full = execTransactionInput(AGENT_EOA, AMOUNT, NO_DATA, 0);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        Bytes.fromUint8Array(full.subarray(0, 40)),
        mockTx(70),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("delegatecall (operation 1) writes no row", () => {
    seedAgentSafe(SERVICE_ID);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        execTransactionInput(AGENT_EOA, AMOUNT, NO_DATA, 1),
        mockTx(63),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("call with data writes no row", () => {
    seedAgentSafe(SERVICE_ID);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        execTransactionInput(
          AGENT_EOA,
          AMOUNT,
          Bytes.fromHexString("0xa9059cbb"),
          0
        ),
        mockTx(64),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("zero value writes no row", () => {
    seedAgentSafe(SERVICE_ID);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        execTransactionInput(AGENT_EOA, BigInt.zero(), NO_DATA, 0),
        mockTx(65),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("recipient other than the tx sender writes no row", () => {
    seedAgentSafe(SERVICE_ID);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        execTransactionInput(RANDOM_EOA, AMOUNT, NO_DATA, 0),
        mockTx(66),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("untracked Safe writes no row", () => {
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        execTransactionInput(AGENT_EOA, AMOUNT, NO_DATA, 0),
        mockTx(67),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("real Gnosis withdrawal (payee is not the sender) writes no row", () => {
    seedTrackedAddress(REAL_SAFE, "AGENT", MASTER_SAFE, serviceBytes(SERVICE_ID));
    // AGENT_EOA stands in for the real sender, which is not the payee.
    handleSafeExecutionSuccess(
      newExecutionSuccess(REAL_SAFE, AGENT_EOA, REAL_SAFE, REAL_INPUT, mockTx(71), 0)
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("real Gnosis calldata, re-sent by its payee, decodes to the on-chain to and value", () => {
    // Pins the decode against real calldata only: the sender is set to the
    // payee so the decoded values reach the row. This is not the on-chain tx.
    seedTrackedAddress(REAL_SAFE, "AGENT", MASTER_SAFE, serviceBytes(SERVICE_ID));
    const tx = mockTx(75);
    handleSafeExecutionSuccess(
      newExecutionSuccess(REAL_SAFE, REAL_RECIPIENT, REAL_SAFE, REAL_INPUT, tx, 0)
    );

    const id = agentSafeTopUpId(tx).toHexString();
    assert.entityCount("FundsMovement", 1);
    assert.fieldEquals("FundsMovement", id, "category", "AGENT_SAFE_TO_AGENT_EOA");
    assert.fieldEquals("FundsMovement", id, "source", "SEMANTIC");
    assert.fieldEquals("FundsMovement", id, "from", REAL_SAFE.toHexString());
    assert.fieldEquals("FundsMovement", id, "to", REAL_RECIPIENT.toHexString());
    assert.fieldEquals("FundsMovement", id, "amount", "5732515000000000000");
  });

  test("Master Safe paying its own signer writes no row", () => {
    seedMasterSafe(true);
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        MASTER_SAFE,
        MASTER_EOA,
        MASTER_SAFE,
        execTransactionInput(MASTER_EOA, AMOUNT, NO_DATA, 0),
        mockTx(68),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("module execution with top-up shape writes nothing", () => {
    seedAgentSafe(SERVICE_ID);
    handleSafeExecutionFromModuleSuccess(
      newExecutionFromModuleSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        execTransactionInput(AGENT_EOA, AMOUNT, NO_DATA, 0),
        mockTx(76)
      )
    );
    assert.entityCount("FundsMovement", 0);
    assert.entityCount("TokenBalance", 0);
  });
});

// ---- OPE-1979 — Pearl Safe → Agent Signer native legs ----

const SIGNER = Address.fromString("0x5555555555555555555555555555555555555555");
const OTHER_SIGNER = Address.fromString("0x7777777777777777777777777777777777777777");
const OTHER_MASTER_SAFE = Address.fromString(
  "0x6666666666666666666666666666666666666666"
);
const MULTISEND = Address.fromString("0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761");
const SIGNER_SHARE = BigInt.fromString("321980789324419");
const SAFE_SHARE = BigInt.fromString("78019210675581");

function word(value: BigInt): string {
  const hex = value.toHexString().slice(2);
  return "0".repeat(64 - hex.length) + hex;
}

// One packed MultiSend leg: operation | to | value | dataLength | data.
function packedLeg(operation: i32, to: Address, value: BigInt, data: string = ""): string {
  return (
    (operation == 0 ? "00" : "01") +
    to.toHexString().slice(2) +
    word(value) +
    word(BigInt.fromI32(data.length / 2)) +
    data
  );
}

// multiSend(bytes) calldata, laid out by hand as real calldata is: selector,
// offset word, length word, packed legs, zero padding to a 32-byte boundary.
function multiSendData(legs: string): Bytes {
  const len = legs.length / 2;
  const pad = (32 - (len % 32)) % 32;
  return Bytes.fromHexString(
    "0x8d80ff0a" + word(BigInt.fromI32(32)) + word(BigInt.fromI32(len)) + legs + "00".repeat(pad)
  );
}

// execTransaction input that DELEGATECALLs MultiSend v1.3.0 with `legs`.
function execMultiSend(legs: string): Bytes {
  return execTransactionInput(MULTISEND, BigInt.zero(), multiSendData(legs), 1);
}

// The shape of the ZD#1285 Fund Agent split (synthetic addresses): Agent
// Signer leg first, then the Agent Safe leg.
const SPLIT_LEGS = packedLeg(0, SIGNER, SIGNER_SHARE) + packedLeg(0, AGENT_SAFE, SAFE_SHARE);

// Spelled out rather than built with agentSignerLegId, so the cross-indexer
// id layout is pinned.
function signerLegId(tx: Bytes, legIndex: i32): Bytes {
  return Bytes.fromUTF8("signer:").concat(tx).concatI32(legIndex);
}

function seedPearlService(
  serviceId: string,
  masterSafe: Address | null,
  agentSafe: Address | null
): void {
  const svc = new Service(serviceBytes(serviceId));
  svc.serviceId = BigInt.fromString(serviceId);
  svc.agentIds = [40];
  svc.operators = masterSafe !== null ? [masterSafe] : [];
  if (masterSafe !== null) svc.masterSafe = masterSafe;
  if (agentSafe !== null) svc.agentSafe = agentSafe;
  svc.state = "DEPLOYED";
  svc.totalOlasRewardsClaimed = BigInt.zero();
  svc.registeredTimestamp = BigInt.fromI32(1);
  svc.updatedTimestamp = BigInt.fromI32(1);
  svc.save();
}

function seedAgentInstance(signer: Address, serviceId: string): void {
  const instance = new AgentInstance(signer);
  instance.serviceEntityId = serviceBytes(serviceId);
  instance.updatedBlock = BigInt.fromI32(1);
  instance.save();
}

function seedPearlFunding(): void {
  seedMasterSafe(true);
  seedPearlService(SERVICE_ID, MASTER_SAFE, AGENT_SAFE);
  seedTrackedAddress(AGENT_SAFE, "AGENT", MASTER_SAFE, serviceBytes(SERVICE_ID));
  seedAgentInstance(SIGNER, SERVICE_ID);
}

function fundFromPearlSafe(input: Bytes, tx: Bytes, logIndex: i32 = 5): void {
  handleSafeExecutionSuccess(
    newExecutionSuccess(MASTER_SAFE, MASTER_EOA, MASTER_SAFE, input, tx, logIndex)
  );
}

describe("pearl-transactions / Pearl Safe → Agent Signer MASTER_TO_AGENT", () => {
  beforeEach(() => {
    clearStore();
    dataSourceMock.setNetwork("gnosis");
  });

  afterEach(() => {
    clearStore();
  });

  test("MultiSend split books the Signer leg next to the Agent Safe leg", () => {
    seedPearlFunding();
    const tx = mockTx(80);
    // The Agent Safe leg arrives as SafeReceived during execution.
    handleSafeReceived(newSafeReceived(MASTER_SAFE, SAFE_SHARE, AGENT_SAFE, tx, 2));
    fundFromPearlSafe(
      execMultiSend(SPLIT_LEGS),
      tx
    );

    const id = signerLegId(tx, 0).toHexString();
    const afeId = agentFundingEventId(tx, MASTER_SAFE, serviceBytes(SERVICE_ID)).toHexString();
    assert.entityCount("FundsMovement", 2);
    assert.fieldEquals("FundsMovement", id, "category", "MASTER_TO_AGENT");
    assert.fieldEquals("FundsMovement", id, "source", "SEMANTIC");
    assert.fieldEquals("FundsMovement", id, "amount", SIGNER_SHARE.toString());
    assert.fieldEquals("FundsMovement", id, "from", MASTER_SAFE.toHexString());
    assert.fieldEquals("FundsMovement", id, "to", SIGNER.toHexString());
    assert.assertTrue(FundsMovement.load(signerLegId(tx, 0))!.token === null);
    assert.fieldEquals("FundsMovement", id, "service", serviceBytes(SERVICE_ID).toHexString());
    assert.fieldEquals("FundsMovement", id, "masterSafe", MASTER_SAFE.toHexString());
    assert.fieldEquals("FundsMovement", id, "agentSafe", AGENT_SAFE.toHexString());
    assert.fieldEquals("FundsMovement", id, "agentFundingEvent", afeId);
    assert.fieldEquals(
      "FundsMovement",
      tx.concatI32(2).toHexString(),
      "agentFundingEvent",
      afeId
    );
    assert.fieldEquals(
      "AgentFundingEvent",
      afeId,
      "totalNativeAmount",
      SIGNER_SHARE.plus(SAFE_SHARE).toString()
    );
    assert.entityCount("TokenBalance", 0);
  });

  test("Signer leg id does not collide with a SafeReceived row at logIndex 0", () => {
    seedPearlFunding();
    const tx = mockTx(86);
    handleSafeReceived(newSafeReceived(MASTER_SAFE, SAFE_SHARE, AGENT_SAFE, tx, 0));
    fundFromPearlSafe(
      execMultiSend(SPLIT_LEGS),
      tx
    );
    assert.entityCount("FundsMovement", 2);
    assert.fieldEquals(
      "FundsMovement",
      signerLegId(tx, 0).toHexString(),
      "amount",
      SIGNER_SHARE.toString()
    );
    assert.fieldEquals(
      "FundsMovement",
      tx.concatI32(0).toHexString(),
      "amount",
      SAFE_SHARE.toString()
    );
  });

  test("plain CALL to the Agent Signer creates its AgentFundingEvent", () => {
    seedPearlFunding();
    const tx = mockTx(81);
    fundFromPearlSafe(execTransactionInput(SIGNER, AMOUNT, NO_DATA, 0), tx);

    const id = signerLegId(tx, 0).toHexString();
    const afeId = agentFundingEventId(tx, MASTER_SAFE, serviceBytes(SERVICE_ID)).toHexString();
    assert.entityCount("FundsMovement", 1);
    assert.fieldEquals("FundsMovement", id, "amount", AMOUNT.toString());
    assert.fieldEquals("FundsMovement", id, "agentFundingEvent", afeId);
    assert.fieldEquals("AgentFundingEvent", afeId, "totalNativeAmount", AMOUNT.toString());
    assert.fieldEquals("AgentFundingEvent", afeId, "masterSafe", MASTER_SAFE.toHexString());
  });

  test("row id carries the leg's MultiSend position", () => {
    seedPearlFunding();
    const tx = mockTx(82);
    fundFromPearlSafe(
      execMultiSend(packedLeg(0, AGENT_SAFE, SAFE_SHARE) + packedLeg(0, SIGNER, SIGNER_SHARE)),
      tx
    );
    assert.entityCount("FundsMovement", 1);
    assert.fieldEquals(
      "FundsMovement",
      signerLegId(tx, 1).toHexString(),
      "amount",
      SIGNER_SHARE.toString()
    );
  });

  test("reentrant ExecutionSuccess counts the legs once", () => {
    seedPearlFunding();
    const tx = mockTx(83);
    const input = execMultiSend(SPLIT_LEGS);
    fundFromPearlSafe(input, tx, 4);
    fundFromPearlSafe(input, tx, 5);
    assert.entityCount("FundsMovement", 1);
    assert.fieldEquals(
      "AgentFundingEvent",
      agentFundingEventId(tx, MASTER_SAFE, serviceBytes(SERVICE_ID)).toHexString(),
      "totalNativeAmount",
      SIGNER_SHARE.toString()
    );
  });

  test("leg is booked without an Agent Safe when the service has none yet", () => {
    seedMasterSafe(true);
    seedPearlService(SERVICE_ID, MASTER_SAFE, null);
    seedAgentInstance(SIGNER, SERVICE_ID);
    const tx = mockTx(84);
    fundFromPearlSafe(execTransactionInput(SIGNER, AMOUNT, NO_DATA, 0), tx);
    assert.entityCount("FundsMovement", 1);
    assert.assertTrue(FundsMovement.load(signerLegId(tx, 0))!.agentSafe === null);
  });

  test("Agent Signer of a still-buffered service writes no row", () => {
    seedMasterSafe(true);
    seedAgentInstance(SIGNER, SERVICE_ID); // no Service entity yet
    fundFromPearlSafe(execTransactionInput(SIGNER, AMOUNT, NO_DATA, 0), mockTx(91));
    assert.entityCount("FundsMovement", 0);
    assert.entityCount("AgentFundingEvent", 0);
  });

  test("Agent Signer of a service with no Pearl Safe yet writes no row", () => {
    seedMasterSafe(true);
    seedPearlService(SERVICE_ID, null, null);
    seedAgentInstance(SIGNER, SERVICE_ID);
    fundFromPearlSafe(execTransactionInput(SIGNER, AMOUNT, NO_DATA, 0), mockTx(92));
    assert.entityCount("FundsMovement", 0);
    assert.entityCount("AgentFundingEvent", 0);
  });

  test("a skipped Signer leg does not stop the next leg from being booked", () => {
    seedPearlFunding();
    seedPearlService("43", OTHER_MASTER_SAFE, null);
    seedAgentInstance(OTHER_SIGNER, "43");
    const tx = mockTx(94);
    fundFromPearlSafe(
      execMultiSend(packedLeg(0, OTHER_SIGNER, AMOUNT) + packedLeg(0, SIGNER, SIGNER_SHARE)),
      tx
    );
    assert.entityCount("FundsMovement", 1);
    assert.fieldEquals(
      "FundsMovement",
      signerLegId(tx, 1).toHexString(),
      "amount",
      SIGNER_SHARE.toString()
    );
    assert.fieldEquals(
      "AgentFundingEvent",
      agentFundingEventId(tx, MASTER_SAFE, serviceBytes(SERVICE_ID)).toHexString(),
      "totalNativeAmount",
      SIGNER_SHARE.toString()
    );
  });

  test("a buffered Signer leg does not stop the next leg from being booked", () => {
    seedPearlFunding();
    seedAgentInstance(OTHER_SIGNER, "44"); // no Service 44 yet
    const tx = mockTx(95);
    fundFromPearlSafe(
      execMultiSend(packedLeg(0, OTHER_SIGNER, AMOUNT) + packedLeg(0, SIGNER, SIGNER_SHARE)),
      tx
    );
    assert.entityCount("FundsMovement", 1);
    assert.fieldEquals(
      "FundsMovement",
      signerLegId(tx, 1).toHexString(),
      "amount",
      SIGNER_SHARE.toString()
    );
    assert.fieldEquals(
      "AgentFundingEvent",
      agentFundingEventId(tx, MASTER_SAFE, serviceBytes(SERVICE_ID)).toHexString(),
      "totalNativeAmount",
      SIGNER_SHARE.toString()
    );
  });

  test("Agent Signer of another Pearl Safe's service writes no row", () => {
    seedPearlFunding();
    seedPearlService("43", OTHER_MASTER_SAFE, null);
    seedAgentInstance(SIGNER, "43");
    fundFromPearlSafe(
      execMultiSend(SPLIT_LEGS),
      mockTx(85)
    );
    assert.entityCount("FundsMovement", 0);
    assert.entityCount("AgentFundingEvent", 0);
  });

  test("recipient that is not an Agent Signer writes no row", () => {
    seedPearlFunding();
    fundFromPearlSafe(execTransactionInput(RANDOM_EOA, AMOUNT, NO_DATA, 0), mockTx(86));
    assert.entityCount("FundsMovement", 0);
  });

  test("legs that are not plain native transfers write no row", () => {
    seedPearlFunding();
    fundFromPearlSafe(
      execMultiSend(
        packedLeg(0, SIGNER, BigInt.zero(), "a9059cbb") + // ERC-20-shaped call
          packedLeg(1, SIGNER, AMOUNT) // DELEGATECALL
      ),
      mockTx(87)
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("a CALL to the Agent Signer carrying value and data writes no row", () => {
    seedPearlFunding();
    fundFromPearlSafe(
      execMultiSend(packedLeg(0, SIGNER, AMOUNT, "a9059cbb")),
      mockTx(93)
    );
    assert.entityCount("FundsMovement", 0);
    assert.entityCount("AgentFundingEvent", 0);
  });

  test("DELEGATECALL to another contract writes no row", () => {
    seedPearlFunding();
    fundFromPearlSafe(
      execTransactionInput(RANDOM_EOA, BigInt.zero(), multiSendData(SPLIT_LEGS), 1),
      mockTx(88)
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("truncated MultiSend buffer writes no row", () => {
    seedPearlFunding();
    const legs = SPLIT_LEGS.slice(0, SPLIT_LEGS.length - 20);
    fundFromPearlSafe(
      execMultiSend(legs),
      mockTx(89)
    );
    assert.entityCount("FundsMovement", 0);
  });

  test("Agent Safe emitter with a MultiSend shape writes no row", () => {
    seedPearlFunding();
    handleSafeExecutionSuccess(
      newExecutionSuccess(
        AGENT_SAFE,
        AGENT_EOA,
        AGENT_SAFE,
        execMultiSend(SPLIT_LEGS),
        mockTx(90),
        0
      )
    );
    assert.entityCount("FundsMovement", 0);
  });
});

describe("pearl-transactions / multiSendNativeLegs", () => {
  test("unpacks native legs with their position", () => {
    const legs = multiSendNativeLegs(multiSendData(SPLIT_LEGS))!;
    assert.i32Equals(legs.length, 2);
    assert.i32Equals(legs[0].index, 0);
    assert.addressEquals(legs[0].to, SIGNER);
    assert.bigIntEquals(legs[0].value, SIGNER_SHARE);
    assert.i32Equals(legs[1].index, 1);
    assert.addressEquals(legs[1].to, AGENT_SAFE);
    assert.bigIntEquals(legs[1].value, SAFE_SHARE);
  });

  test("keeps positions but drops legs that are not plain native transfers", () => {
    const legs = multiSendNativeLegs(
      multiSendData(
        packedLeg(0, AGENT_SAFE, BigInt.zero(), "a9059cbb") +
          packedLeg(1, AGENT_SAFE, AMOUNT) +
          packedLeg(0, AGENT_SAFE, BigInt.zero()) +
          packedLeg(0, AGENT_SAFE, AMOUNT, "a9059cbb") + // value AND data
          packedLeg(0, SIGNER, AMOUNT)
      )
    )!;
    assert.i32Equals(legs.length, 1);
    assert.i32Equals(legs[0].index, 4);
    assert.addressEquals(legs[0].to, SIGNER);
  });

  test("an empty buffer has no legs", () => {
    assert.i32Equals(multiSendNativeLegs(multiSendData(""))!.length, 0);
  });

  test("a truncated head is malformed", () => {
    assert.assertTrue(
      multiSendNativeLegs(multiSendData(SPLIT_LEGS.slice(0, SPLIT_LEGS.length - 20))) === null
    );
  });

  test("trailing bytes are malformed", () => {
    assert.assertTrue(multiSendNativeLegs(multiSendData(SPLIT_LEGS + "00")) === null);
  });

  test("a data length past the end is malformed", () => {
    const leg = packedLeg(0, AGENT_SAFE, AMOUNT, "1234");
    assert.assertTrue(multiSendNativeLegs(multiSendData(leg.slice(0, leg.length - 2))) === null);
  });

  test("calldata with another selector is not a multiSend", () => {
    const data = multiSendData(SPLIT_LEGS).toHexString();
    assert.assertTrue(
      multiSendNativeLegs(Bytes.fromHexString("0x8d80ff0b" + data.slice(10))) === null
    );
  });

  test("calldata shorter than a selector is not a multiSend", () => {
    assert.assertTrue(multiSendNativeLegs(Bytes.fromHexString("0x8d80ff")) === null);
  });
});
