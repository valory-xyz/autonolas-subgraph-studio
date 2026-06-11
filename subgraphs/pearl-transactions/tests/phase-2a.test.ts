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
import {
  MasterSafe,
  StakingContract,
  TrackedEOA,
  TrackedSafe,
} from "../generated/schema";
import { handleErc20Transfer } from "../src/erc20";
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
    // Seed a StakingContract entity at STAKING_PROXY (any Bytes works
    // for the classify lookup).
    const STAKING_PROXY = Address.fromString(
      "0x9999999999999999999999999999999999999999"
    );
    const sc = new StakingContract(STAKING_PROXY);
    sc.implementation = Address.fromString(
      "0xEa00be6690a871827fAfD705440D20dd75e67AB1"
    );
    sc.minStakingDeposit = BigInt.fromI32(10);
    sc.numAgentInstances = BigInt.fromI32(1);
    sc.createdBlock = BigInt.fromI32(1);
    sc.createdTimestamp = BigInt.fromI32(1);
    sc.save();

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
// instead of silently mapping to UNKNOWN/18 in production. Each case sets
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
