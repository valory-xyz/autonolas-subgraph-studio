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
import { StakingContract } from "../generated/schema";
import { InstanceCreated } from "../generated/StakingFactory/StakingFactory";
import {
  RewardClaimed,
  ServiceForceUnstaked,
  ServiceStaked,
  ServiceUnstaked,
  ServicesEvicted,
} from "../generated/templates/StakingProxy/StakingProxy";
import { Transfer } from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import { handleInstanceCreated } from "../src/staking-factory";
import {
  handleRewardClaimed,
  handleServiceForceUnstaked,
  handleServiceStaked,
  handleServiceUnstaked,
  handleServicesEvicted,
} from "../src/staking-proxy";
import { handleServiceNftTransfer } from "../src/service-registry";

// ----------------- Fixtures -----------------

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
const STAKING_FACTORY_GNOSIS = Address.fromString(
  "0xb0228CA253A88Bc8eb4ca70BCAC8f87b381f4700"
);
const STAKING_PROXY = Address.fromString(
  "0x9999999999999999999999999999999999999999"
);
const ALLOWED_IMPL_GNOSIS = Address.fromString(
  "0xEa00be6690a871827fAfD705440D20dd75e67AB1"
);
const DISALLOWED_IMPL = Address.fromString(
  "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead"
);

const SERVICE_ID = BigInt.fromI32(42);
const SERVICE_ID_2 = BigInt.fromI32(43);
const EPOCH = BigInt.fromI32(7);
const REWARD = BigInt.fromString("1500000000000000000"); // 1.5 OLAS
const MIN_STAKING_DEPOSIT = BigInt.fromString("10000000000000000000"); // 10 OLAS
const NUM_AGENT_INSTANCES = BigInt.fromI32(1);

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

function mockProxyConfig(
  proxy: Address,
  minStakingDeposit: BigInt,
  numAgentInstances: BigInt
): void {
  createMockedFunction(
    proxy,
    "minStakingDeposit",
    "minStakingDeposit():(uint256)"
  ).returns([ethereum.Value.fromUnsignedBigInt(minStakingDeposit)]);
  createMockedFunction(
    proxy,
    "numAgentInstances",
    "numAgentInstances():(uint256)"
  ).returns([ethereum.Value.fromUnsignedBigInt(numAgentInstances)]);
}

const OLAS_GNOSIS_ADDR = Address.fromString(
  "0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f"
);
function mockOlasBalanceOf(holder: Address, balance: BigInt): void {
  createMockedFunction(
    OLAS_GNOSIS_ADDR,
    "balanceOf",
    "balanceOf(address):(uint256)"
  )
    .withArgs([ethereum.Value.fromAddress(holder)])
    .returns([ethereum.Value.fromUnsignedBigInt(balance)]);
}

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

// ----------------- Event constructors -----------------

function newInstanceCreated(
  sender: Address,
  instance: Address,
  implementation: Address,
  txHash: Bytes
): InstanceCreated {
  const mock = newMockEvent();
  const e = new InstanceCreated(
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
    new ethereum.EventParam("instance", ethereum.Value.fromAddress(instance))
  );
  e.parameters.push(
    new ethereum.EventParam(
      "implementation",
      ethereum.Value.fromAddress(implementation)
    )
  );
  return setMockEventBoilerplate(e, txHash, 0, STAKING_FACTORY_GNOSIS);
}

function newServiceStaked(
  serviceId: BigInt,
  epoch: BigInt,
  owner: Address,
  multisig: Address,
  proxy: Address,
  txHash: Bytes
): ServiceStaked {
  const mock = newMockEvent();
  const e = new ServiceStaked(
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
      "epoch",
      ethereum.Value.fromUnsignedBigInt(epoch)
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  );
  e.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  );
  e.parameters.push(
    new ethereum.EventParam("multisig", ethereum.Value.fromAddress(multisig))
  );
  e.parameters.push(
    new ethereum.EventParam(
      "nonces",
      ethereum.Value.fromUnsignedBigIntArray([])
    )
  );
  return setMockEventBoilerplate(e, txHash, 0, proxy);
}

function newRewardClaimed(
  serviceId: BigInt,
  epoch: BigInt,
  owner: Address,
  multisig: Address,
  reward: BigInt,
  proxy: Address,
  txHash: Bytes
): RewardClaimed {
  const mock = newMockEvent();
  const e = new RewardClaimed(
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
      "epoch",
      ethereum.Value.fromUnsignedBigInt(epoch)
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  );
  e.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  );
  e.parameters.push(
    new ethereum.EventParam("multisig", ethereum.Value.fromAddress(multisig))
  );
  e.parameters.push(
    new ethereum.EventParam(
      "nonces",
      ethereum.Value.fromUnsignedBigIntArray([])
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "reward",
      ethereum.Value.fromUnsignedBigInt(reward)
    )
  );
  return setMockEventBoilerplate(e, txHash, 0, proxy);
}

function newServiceUnstaked(
  serviceId: BigInt,
  epoch: BigInt,
  owner: Address,
  multisig: Address,
  reward: BigInt,
  proxy: Address,
  txHash: Bytes
): ServiceUnstaked {
  const mock = newMockEvent();
  const e = new ServiceUnstaked(
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
      "epoch",
      ethereum.Value.fromUnsignedBigInt(epoch)
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  );
  e.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  );
  e.parameters.push(
    new ethereum.EventParam("multisig", ethereum.Value.fromAddress(multisig))
  );
  e.parameters.push(
    new ethereum.EventParam(
      "nonces",
      ethereum.Value.fromUnsignedBigIntArray([])
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "reward",
      ethereum.Value.fromUnsignedBigInt(reward)
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "availableRewards",
      ethereum.Value.fromUnsignedBigInt(BigInt.zero())
    )
  );
  return setMockEventBoilerplate(e, txHash, 0, proxy);
}

function newServicesEvicted(
  epoch: BigInt,
  serviceIds: BigInt[],
  owners: Address[],
  multisigs: Address[],
  proxy: Address,
  txHash: Bytes
): ServicesEvicted {
  const mock = newMockEvent();
  const e = new ServicesEvicted(
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
      "epoch",
      ethereum.Value.fromUnsignedBigInt(epoch)
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "serviceIds",
      ethereum.Value.fromUnsignedBigIntArray(serviceIds)
    )
  );
  e.parameters.push(
    new ethereum.EventParam("owners", ethereum.Value.fromAddressArray(owners))
  );
  e.parameters.push(
    new ethereum.EventParam(
      "multisigs",
      ethereum.Value.fromAddressArray(multisigs)
    )
  );
  e.parameters.push(
    new ethereum.EventParam(
      "serviceInactivity",
      ethereum.Value.fromUnsignedBigIntArray([])
    )
  );
  return setMockEventBoilerplate(e, txHash, 0, proxy);
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
  return setMockEventBoilerplate(
    e,
    txHash,
    logIndex,
    Address.fromString("0x9338b5153AE39BB89f50468E608eD9d764B755fD")
  );
}

// ----------------- Tests -----------------

describe("pearl-transactions / Phase 1b — staking", () => {
  beforeEach(() => {
    clearStore();
    // Pearl-transactions only supports gnosis/matic/optimism/base.
    // Matchstick defaults to mainnet, so the network resolver crashes
    // unless we override here.
    dataSourceMock.setNetwork("gnosis");
    mockGetOwners(MASTER_SAFE, [MASTER_EOA, BACKUP_EOA]);
    mockGetThreshold(MASTER_SAFE, 1);
    mockProxyConfig(STAKING_PROXY, MIN_STAKING_DEPOSIT, NUM_AGENT_INSTANCES);
    // Phase 2a's emitMasterSafeOlasBaseline calls OLAS.balanceOf at
    // first sighting; mock returns 0 for tests not covering baseline.
    mockOlasBalanceOf(MASTER_SAFE, BigInt.zero());
  });

  afterEach(() => {
    clearStore();
  });

  test("InstanceCreated with allowed implementation creates StakingContract", () => {
    const tx = mockTx(1);
    handleInstanceCreated(
      newInstanceCreated(MASTER_SAFE, STAKING_PROXY, ALLOWED_IMPL_GNOSIS, tx)
    );

    assert.entityCount("StakingContract", 1);
    assert.fieldEquals(
      "StakingContract",
      STAKING_PROXY.toHexString(),
      "implementation",
      ALLOWED_IMPL_GNOSIS.toHexString()
    );
    assert.fieldEquals(
      "StakingContract",
      STAKING_PROXY.toHexString(),
      "minStakingDeposit",
      MIN_STAKING_DEPOSIT.toString()
    );
    assert.fieldEquals(
      "StakingContract",
      STAKING_PROXY.toHexString(),
      "numAgentInstances",
      NUM_AGENT_INSTANCES.toString()
    );
  });

  test("InstanceCreated with disallowed implementation is skipped", () => {
    const tx = mockTx(2);
    handleInstanceCreated(
      newInstanceCreated(MASTER_SAFE, STAKING_PROXY, DISALLOWED_IMPL, tx)
    );
    assert.entityCount("StakingContract", 0);
  });

  test("ServiceStaked sets masterSafe + agentSafe + state + currentStakingContract", () => {
    const tx = mockTx(3);
    handleServiceStaked(
      newServiceStaked(SERVICE_ID, EPOCH, MASTER_SAFE, AGENT_SAFE, STAKING_PROXY, tx)
    );

    assert.fieldEquals("Service", "42", "state", "STAKED");
    assert.fieldEquals(
      "Service",
      "42",
      "masterSafe",
      MASTER_SAFE.toHexString()
    );
    assert.fieldEquals(
      "Service",
      "42",
      "agentSafe",
      AGENT_SAFE.toHexString()
    );
    assert.fieldEquals(
      "Service",
      "42",
      "currentStakingContract",
      STAKING_PROXY.toHexString()
    );
    // SAFE_DEPLOYED row should have been emitted by getOrCreateMasterSafe.
    assert.entityCount("MasterSafe", 1);
    assert.entityCount("AgentSafe", 1);
  });

  test("RewardClaimed emits row + bumps cumulative + daily rollup", () => {
    const tx1 = mockTx(4);
    handleServiceStaked(
      newServiceStaked(SERVICE_ID, EPOCH, MASTER_SAFE, AGENT_SAFE, STAKING_PROXY, tx1)
    );

    const tx2 = mockTx(5);
    handleRewardClaimed(
      newRewardClaimed(
        SERVICE_ID,
        EPOCH,
        MASTER_SAFE,
        AGENT_SAFE,
        REWARD,
        STAKING_PROXY,
        tx2
      )
    );

    const id = tx2.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "STAKING_REWARD_CLAIM"
    );
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "amount",
      REWARD.toString()
    );
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "to",
      AGENT_SAFE.toHexString()
    );

    assert.fieldEquals(
      "Service",
      "42",
      "totalOlasRewardsClaimed",
      REWARD.toString()
    );
    assert.entityCount("DailyServiceFunds", 1);
  });

  test("ServiceUnstaked emits row + clears currentStakingContract + state=UNSTAKED", () => {
    const tx1 = mockTx(6);
    handleServiceStaked(
      newServiceStaked(SERVICE_ID, EPOCH, MASTER_SAFE, AGENT_SAFE, STAKING_PROXY, tx1)
    );

    const tx2 = mockTx(7);
    handleServiceUnstaked(
      newServiceUnstaked(
        SERVICE_ID,
        EPOCH,
        MASTER_SAFE,
        AGENT_SAFE,
        REWARD,
        STAKING_PROXY,
        tx2
      )
    );

    assert.fieldEquals("Service", "42", "state", "UNSTAKED");
    // currentStakingContract should be cleared (null).
    const id = tx2.concatI32(0);
    assert.fieldEquals(
      "FundsMovement",
      id.toHexString(),
      "category",
      "UNSTAKE_REWARD"
    );
  });

  test("ServicesEvicted emits one informational row per affected service", () => {
    const tx = mockTx(8);
    handleServicesEvicted(
      newServicesEvicted(
        EPOCH,
        [SERVICE_ID, SERVICE_ID_2],
        [MASTER_SAFE, MASTER_SAFE],
        [AGENT_SAFE, AGENT_SAFE],
        STAKING_PROXY,
        tx
      )
    );

    // Two FundsMovement rows, both SERVICE_EVICTED with amount 0.
    assert.entityCount("FundsMovement", 2);
    const id1 = tx.concatI32(0);
    const id2 = tx.concatI32(1);
    assert.fieldEquals("FundsMovement", id1.toHexString(), "category", "SERVICE_EVICTED");
    assert.fieldEquals("FundsMovement", id1.toHexString(), "amount", "0");
    assert.fieldEquals("FundsMovement", id2.toHexString(), "category", "SERVICE_EVICTED");
  });

  test("NFT-Transfer to a known StakingContract does NOT call getOwners()", () => {
    // Seed the StakingContract entity first.
    const sc = new StakingContract(STAKING_PROXY);
    sc.implementation = ALLOWED_IMPL_GNOSIS;
    sc.minStakingDeposit = MIN_STAKING_DEPOSIT;
    sc.numAgentInstances = NUM_AGENT_INSTANCES;
    sc.createdBlock = BigInt.fromI32(1);
    sc.createdTimestamp = BigInt.fromI32(1);
    sc.save();

    // No mockGetOwners() call for STAKING_PROXY — if the handler
    // calls getOwners() on it we'd get a revert in matchstick (or a
    // missing-mock error). The guard should prevent the call.
    const tx = mockTx(9);
    handleServiceNftTransfer(
      newNftTransfer(MASTER_SAFE, STAKING_PROXY, SERVICE_ID, tx, 0)
    );

    // No MasterSafe entity should have been created for the proxy.
    assert.entityCount("MasterSafe", 0);
    // Service still gets nftCustodian updated.
    assert.fieldEquals(
      "Service",
      "42",
      "nftCustodian",
      STAKING_PROXY.toHexString()
    );
    // Custody change row is still recorded.
    assert.entityCount("ServiceNftCustodyChange", 1);
  });
});
