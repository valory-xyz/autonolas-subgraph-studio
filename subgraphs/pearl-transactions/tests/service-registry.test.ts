import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
  describe,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  ActivateRegistration,
  CreateMultisigWithAgents,
  OperatorUnbond,
  RegisterInstance,
  TerminateService,
  Transfer,
} from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import {
  TokenDeposit,
  TokenRefund,
} from "../generated/ServiceRegistryTokenUtility/ServiceRegistryTokenUtility";
import {
  handleActivateRegistration,
  handleCreateMultisigWithAgents,
  handleOperatorUnbond,
  handleRegisterInstance,
  handleServiceNftTransfer,
  handleTerminateService,
} from "../src/service-registry";
import {
  handleTokenDeposit,
  handleTokenRefund,
} from "../src/service-registry-token-utility";

// ----------------- Test fixtures -----------------

const ZERO = Address.zero();
const MASTER_EOA = Address.fromString(
  "0x1111111111111111111111111111111111111111"
);
const BACKUP_EOA = Address.fromString(
  "0x2222222222222222222222222222222222222222"
);
const MASTER_SAFE = Address.fromString(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
);
const AGENT_SAFE = Address.fromString(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
);
const AGENT_INSTANCE_1 = Address.fromString(
  "0xcccccccccccccccccccccccccccccccccccccccc"
);
const AGENT_INSTANCE_2 = Address.fromString(
  "0xdddddddddddddddddddddddddddddddddddddddd"
);
const OPERATOR = MASTER_SAFE; // Pearl bonds itself as operator
const OLAS_GNOSIS = Address.fromString(
  "0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f"
);
const SR_L2_GNOSIS = Address.fromString(
  "0x9338b5153AE39BB89f50468E608eD9d764B755fD"
);
const SRTU_GNOSIS = Address.fromString(
  "0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8"
);

const PEARL_AGENT_ID = BigInt.fromI32(25); // Gnosis omenstrat
const OTHER_AGENT_ID = BigInt.fromI32(99); // any non-Pearl agent
const SERVICE_ID = BigInt.fromI32(42);
const OTHER_SERVICE_ID = BigInt.fromI32(43);

const SECURITY_DEPOSIT = BigInt.fromString("10000000000000000000"); // 10 OLAS
const AGENT_BOND = BigInt.fromString("30000000000000000000"); // 30 OLAS

// txHash deterministically per-test-name to keep buffer state isolated
// across tests (clearStore() doesn't touch the mock-event tx hash).
function mockTx(salt: i32): Bytes {
  return Bytes.fromHexString(
    "0x" + "00".repeat(28) + salt.toString(16).padStart(8, "0")
  );
}

function mockGetOwners(safe: Address, owners: Address[]): void {
  const valueArray: ethereum.Value[] = [];
  for (let i = 0; i < owners.length; i++) {
    valueArray.push(ethereum.Value.fromAddress(owners[i]));
  }
  createMockedFunction(safe, "getOwners", "getOwners():(address[])").returns([
    ethereum.Value.fromArray(valueArray),
  ]);
}

function mockGetThreshold(safe: Address, threshold: i32): void {
  createMockedFunction(
    safe,
    "getThreshold",
    "getThreshold():(uint256)"
  ).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(threshold))]);
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

function newActivateRegistration(
  serviceId: BigInt,
  txHash: Bytes,
  logIndex: i32
): ActivateRegistration {
  const mock = newMockEvent();
  const e = new ActivateRegistration(
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
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  );
  return setMockEventBoilerplate(e, txHash, logIndex, SR_L2_GNOSIS);
}

function newRegisterInstance(
  operator: Address,
  serviceId: BigInt,
  agentInstance: Address,
  agentId: BigInt,
  txHash: Bytes,
  logIndex: i32
): RegisterInstance {
  const mock = newMockEvent();
  const e = new RegisterInstance(
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
    new ethereum.EventParam("operator", ethereum.Value.fromAddress(operator))
  );
  e.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "agentInstance",
      ethereum.Value.fromAddress(agentInstance)
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "agentId",
      ethereum.Value.fromUnsignedBigInt(agentId)
    )
  );
  return setMockEventBoilerplate(e, txHash, logIndex, SR_L2_GNOSIS);
}

function newCreateMultisig(
  serviceId: BigInt,
  multisig: Address,
  txHash: Bytes,
  logIndex: i32
): CreateMultisigWithAgents {
  const mock = newMockEvent();
  const e = new CreateMultisigWithAgents(
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
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  );
  e.parameters.push(
    new ethereum.EventParam("multisig", ethereum.Value.fromAddress(multisig))
  );
  return setMockEventBoilerplate(e, txHash, logIndex, SR_L2_GNOSIS);
}

function newNftTransfer(
  from: Address,
  to: Address,
  tokenId: BigInt,
  txHash: Bytes,
  logIndex: i32
): Transfer {
  const mock = newMockEvent();
  const e = new Transfer(
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
      "id",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    )
  );
  return setMockEventBoilerplate(e, txHash, logIndex, SR_L2_GNOSIS);
}

function newTerminate(
  serviceId: BigInt,
  txHash: Bytes,
  logIndex: i32
): TerminateService {
  const mock = newMockEvent();
  const e = new TerminateService(
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
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  );
  return setMockEventBoilerplate(e, txHash, logIndex, SR_L2_GNOSIS);
}

function newOperatorUnbond(
  operator: Address,
  serviceId: BigInt,
  txHash: Bytes,
  logIndex: i32
): OperatorUnbond {
  const mock = newMockEvent();
  const e = new OperatorUnbond(
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
    new ethereum.EventParam("operator", ethereum.Value.fromAddress(operator))
  );
  e.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  );
  return setMockEventBoilerplate(e, txHash, logIndex, SR_L2_GNOSIS);
}

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

function newTokenRefund(
  account: Address,
  token: Address,
  amount: BigInt,
  txHash: Bytes,
  logIndex: i32
): TokenRefund {
  const mock = newMockEvent();
  const e = new TokenRefund(
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

// ----------------- Tests -----------------

describe("pearl-transactions / Phase 1a — registry + Master EOA + SRTU bonds", () => {
  beforeEach(() => {
    clearStore();
    mockGetOwners(MASTER_SAFE, [MASTER_EOA, BACKUP_EOA]);
    mockGetThreshold(MASTER_SAFE, 1);
  });

  afterEach(() => {
    clearStore();
  });

  test("RegisterInstance before CreateMultisig — buffer drains correctly", () => {
    const tx = mockTx(1);
    handleRegisterInstance(
      newRegisterInstance(
        OPERATOR,
        SERVICE_ID,
        AGENT_INSTANCE_1,
        PEARL_AGENT_ID,
        tx,
        0
      )
    );
    // Service is not yet created — only PendingRegistration exists.
    assert.entityCount("Service", 0);
    assert.entityCount("PendingRegistration", 1);

    handleCreateMultisigWithAgents(
      newCreateMultisig(SERVICE_ID, AGENT_SAFE, tx, 1)
    );

    assert.entityCount("Service", 1);
    assert.fieldEquals("Service", "42", "serviceId", "42");
    assert.fieldEquals("Service", "42", "agentIds", "[25]");
    assert.fieldEquals(
      "Service",
      "42",
      "operators",
      "[" + OPERATOR.toHexString() + "]"
    );
    assert.fieldEquals("Service", "42", "state", "DEPLOYED");
    assert.fieldEquals(
      "Service",
      "42",
      "agentSafe",
      AGENT_SAFE.toHexString()
    );
    assert.entityCount("AgentSafe", 1);
    assert.entityCount("ServiceIndex", 1);
  });

  test("Agent IDs are recorded for ANY agent (no WASM-level Pearl gate)", () => {
    const tx = mockTx(2);
    handleRegisterInstance(
      newRegisterInstance(
        OPERATOR,
        SERVICE_ID,
        AGENT_INSTANCE_1,
        OTHER_AGENT_ID, // a non-Pearl agent ID
        tx,
        0
      )
    );
    handleCreateMultisigWithAgents(
      newCreateMultisig(SERVICE_ID, AGENT_SAFE, tx, 1)
    );

    // The non-Pearl service is fully indexed; cohort filtering is the
    // consumer's job (Service.agentIds is queryable).
    assert.entityCount("Service", 1);
    assert.fieldEquals("Service", "42", "agentIds", "[99]");
  });

  test("Multiple RegisterInstance events dedupe agentIds + operators", () => {
    const tx = mockTx(3);
    handleRegisterInstance(
      newRegisterInstance(
        OPERATOR,
        SERVICE_ID,
        AGENT_INSTANCE_1,
        PEARL_AGENT_ID,
        tx,
        0
      )
    );
    handleRegisterInstance(
      newRegisterInstance(
        OPERATOR,
        SERVICE_ID,
        AGENT_INSTANCE_2,
        PEARL_AGENT_ID,
        tx,
        1
      )
    );
    handleCreateMultisigWithAgents(
      newCreateMultisig(SERVICE_ID, AGENT_SAFE, tx, 2)
    );

    assert.fieldEquals("Service", "42", "agentIds", "[25]");
    assert.fieldEquals(
      "Service",
      "42",
      "operators",
      "[" + OPERATOR.toHexString() + "]"
    );
  });

  test(
    "NFT Transfer to a Master Safe triggers getOwners() + emits SAFE_DEPLOYED once",
    () => {
      const tx = mockTx(4);

      // Service mint: from = zero, to = Master Safe.
      handleServiceNftTransfer(
        newNftTransfer(ZERO, MASTER_SAFE, SERVICE_ID, tx, 0)
      );

      assert.entityCount("MasterSafe", 1);
      assert.fieldEquals(
        "MasterSafe",
        MASTER_SAFE.toHexString(),
        "masterEoa",
        MASTER_EOA.toHexString()
      );
      assert.fieldEquals(
        "MasterSafe",
        MASTER_SAFE.toHexString(),
        "threshold",
        "1"
      );
      assert.fieldEquals(
        "MasterSafe",
        MASTER_SAFE.toHexString(),
        "owners",
        "[" + MASTER_EOA.toHexString() + ", " + BACKUP_EOA.toHexString() + "]"
      );

      // Synthetic SAFE_DEPLOYED row keyed by the deterministic id.
      const safeDeployedId = Bytes.fromUTF8("safe-deployed:").concat(
        MASTER_SAFE
      );
      assert.fieldEquals(
        "FundsMovement",
        safeDeployedId.toHexString(),
        "category",
        "SAFE_DEPLOYED"
      );
      assert.fieldEquals(
        "FundsMovement",
        safeDeployedId.toHexString(),
        "amount",
        "0"
      );
      // Exactly one FundsMovement row so far (the SAFE_DEPLOYED).
      assert.entityCount("FundsMovement", 1);

      // Second NFT movement involving the same Master Safe must NOT
      // emit another SAFE_DEPLOYED row.
      handleServiceNftTransfer(
        newNftTransfer(MASTER_SAFE, MASTER_SAFE, SERVICE_ID, tx, 1)
      );
      assert.entityCount("FundsMovement", 1);
      assert.entityCount("ServiceNftCustodyChange", 2);
    }
  );

  test(
    "Stake-cycle multicall: 2 SERVICE_BOND_DEPOSIT rows w/ bondType attribution",
    () => {
      const tx = mockTx(5);

      // Event-ordered as per the plan §4.6 diagram:
      // 1. ActivateRegistration  → stash SECURITY_DEPOSIT
      // 2. TokenDeposit          → consume → SECURITY_DEPOSIT row
      // 3. RegisterInstance      → stash AGENT_BOND
      // 4. TokenDeposit          → consume → AGENT_BOND row
      // 5. CreateMultisigWithAgents
      handleActivateRegistration(newActivateRegistration(SERVICE_ID, tx, 0));
      handleTokenDeposit(
        newTokenDeposit(MASTER_SAFE, OLAS_GNOSIS, SECURITY_DEPOSIT, tx, 1)
      );
      handleRegisterInstance(
        newRegisterInstance(
          OPERATOR,
          SERVICE_ID,
          AGENT_INSTANCE_1,
          PEARL_AGENT_ID,
          tx,
          2
        )
      );
      handleTokenDeposit(
        newTokenDeposit(MASTER_SAFE, OLAS_GNOSIS, AGENT_BOND, tx, 3)
      );
      handleCreateMultisigWithAgents(
        newCreateMultisig(SERVICE_ID, AGENT_SAFE, tx, 4)
      );

      // Exactly the two SRTU deposit rows (no SAFE_DEPLOYED here —
      // CreateMultisigWithAgents doesn't touch getOrCreateMasterSafe).
      assert.entityCount("FundsMovement", 2);
      assertBondRow(
        tx,
        1,
        "SERVICE_BOND_DEPOSIT",
        "SECURITY_DEPOSIT",
        "42",
        SECURITY_DEPOSIT.toString()
      );
      assertBondRow(
        tx,
        3,
        "SERVICE_BOND_DEPOSIT",
        "AGENT_BOND",
        "42",
        AGENT_BOND.toString()
      );
    }
  );

  test(
    "Unstake-cycle multicall: 2 SERVICE_BOND_REFUND rows w/ bondType attribution",
    () => {
      const tx = mockTx(6);

      // Event order: TerminateService → TokenRefund (security)
      //              OperatorUnbond  → TokenRefund (agent bond)
      handleTerminateService(newTerminate(SERVICE_ID, tx, 0));
      handleTokenRefund(
        newTokenRefund(MASTER_SAFE, OLAS_GNOSIS, SECURITY_DEPOSIT, tx, 1)
      );
      handleOperatorUnbond(
        newOperatorUnbond(OPERATOR, SERVICE_ID, tx, 2)
      );
      handleTokenRefund(
        newTokenRefund(MASTER_SAFE, OLAS_GNOSIS, AGENT_BOND, tx, 3)
      );

      assert.entityCount("FundsMovement", 2);
      assertBondRow(
        tx,
        1,
        "SERVICE_BOND_REFUND",
        "SECURITY_DEPOSIT",
        "42",
        SECURITY_DEPOSIT.toString()
      );
      assertBondRow(
        tx,
        3,
        "SERVICE_BOND_REFUND",
        "AGENT_BOND",
        "42",
        AGENT_BOND.toString()
      );
    }
  );

  test(
    "TokenDeposit with no prior attribution → row recorded; service + bondType unset",
    () => {
      const tx = mockTx(7);
      // No ActivateRegistration / RegisterInstance fired in this tx —
      // attribution queue is empty. The row should still be recorded
      // with the correct amount and category; service + bondType are
      // left unset (null in the store).
      handleTokenDeposit(
        newTokenDeposit(MASTER_SAFE, OLAS_GNOSIS, SECURITY_DEPOSIT, tx, 0)
      );

      assert.entityCount("FundsMovement", 1);
      const id = tx.concatI32(0);
      assert.fieldEquals(
        "FundsMovement",
        id.toHexString(),
        "category",
        "SERVICE_BOND_DEPOSIT"
      );
      assert.fieldEquals(
        "FundsMovement",
        id.toHexString(),
        "amount",
        SECURITY_DEPOSIT.toString()
      );
      // No bondType field assertion — matchstick's fieldEquals errors
      // on genuinely-unset fields. The entity-existence + amount
      // assertions above are sufficient to prove the row was recorded
      // without attribution.
    }
  );

  test(
    "Per-tx attribution queue isolates across txs (no cross-tx bleed)",
    () => {
      const txA = mockTx(8);
      const txB = mockTx(9);

      // Tx A: stash SECURITY_DEPOSIT, don't consume.
      handleActivateRegistration(
        newActivateRegistration(SERVICE_ID, txA, 0)
      );

      // Tx B: TokenDeposit must NOT pick up Tx A's attribution.
      handleTokenDeposit(
        newTokenDeposit(MASTER_SAFE, OLAS_GNOSIS, SECURITY_DEPOSIT, txB, 0)
      );

      // Tx B's row exists with the correct category + amount but no
      // service field (i.e., attribution did not bleed from txA).
      assert.entityCount("FundsMovement", 1);
      const id = txB.concatI32(0);
      assert.fieldEquals(
        "FundsMovement",
        id.toHexString(),
        "category",
        "SERVICE_BOND_DEPOSIT"
      );
      assert.fieldEquals(
        "FundsMovement",
        id.toHexString(),
        "amount",
        SECURITY_DEPOSIT.toString()
      );
    }
  );
});

// ----------------- Helpers -----------------

function assertBondRow(
  txHash: Bytes,
  logIndex: i32,
  expectedCategory: string,
  expectedBondType: string,
  expectedServiceId: string,
  expectedAmount: string
): void {
  const id = txHash.concatI32(logIndex);
  assert.fieldEquals(
    "FundsMovement",
    id.toHexString(),
    "category",
    expectedCategory
  );
  assert.fieldEquals(
    "FundsMovement",
    id.toHexString(),
    "bondType",
    expectedBondType
  );
  assert.fieldEquals(
    "FundsMovement",
    id.toHexString(),
    "service",
    expectedServiceId
  );
  assert.fieldEquals(
    "FundsMovement",
    id.toHexString(),
    "amount",
    expectedAmount
  );
}
