import { assert, clearStore, test, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { ImplementationUpdated, StakingIncentivesClaimed, StakingIncentivesBatchClaimed, SetDepositProcessorChainIds } from "../generated/DispenserProxy/DispenserProxy";
import { handleImplementationUpdated, handleStakingIncentivesClaimed, handleStakingIncentivesBatchClaimed, handleSetDepositProcessorChainIds } from "../src/dispenser-proxy";

const PROXY = Address.fromString("0x78Bd94F48CAe623CC74828eCbFEBE3bDF428D83D");
const ACCOUNT = Address.fromString("0x0000000000000000000000000000000000000001");
const TARGET = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001");
const CHAIN = BigInt.fromString("5000000000");
function param(name: string, value: ethereum.Value): ethereum.EventParam { return new ethereum.EventParam(name, value); }
function uint(value: i32): ethereum.Value { return ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(value)); }
function single(index: i32, incentive: i32, transfer: i32, returned: i32): StakingIncentivesClaimed {
  let event = changetype<StakingIncentivesClaimed>(newMockEvent());
  event.address = PROXY; event.logIndex = BigInt.fromI32(index);
  event.parameters = [param("account", ethereum.Value.fromAddress(ACCOUNT)), param("chainId", ethereum.Value.fromUnsignedBigInt(CHAIN)), param("stakingTarget", ethereum.Value.fromFixedBytes(TARGET)), param("stakingIncentive", uint(incentive)), param("transferAmount", uint(transfer)), param("returnAmount", uint(returned))];
  return event;
}
function batch(index: i32): StakingIncentivesBatchClaimed {
  let event = changetype<StakingIncentivesBatchClaimed>(newMockEvent());
  event.address = PROXY; event.logIndex = BigInt.fromI32(index);
  event.parameters = [param("account", ethereum.Value.fromAddress(ACCOUNT)), param("chainIds", ethereum.Value.fromUnsignedBigIntArray([CHAIN])), param("stakingTargets", ethereum.Value.fromArray([ethereum.Value.fromFixedBytesArray([TARGET])])), param("stakingIncentives", ethereum.Value.fromArray([ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(100)])])), param("totalStakingIncentive", uint(100)), param("totalTransferAmount", uint(0)), param("totalReturnAmount", uint(100))];
  return event;
}
beforeEach(() => { clearStore(); });
test("records proxy implementation updates from creation", () => {
  let event = changetype<ImplementationUpdated>(newMockEvent()); event.address = PROXY;
  event.parameters = [param("implementation", ethereum.Value.fromAddress(ACCOUNT))];
  handleImplementationUpdated(event);
  let id = event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString();
  assert.fieldEquals("DispenserImplementationUpdated", id, "dispenser", PROXY.toHexString());
  assert.fieldEquals("DispenserImplementationUpdated", id, "implementation", ACCOUNT.toHexString());
});
test("keeps incentive, actual transfer and return separate for withheld-covered claims", () => {
  let event = single(1, 100, 0, 100); handleStakingIncentivesClaimed(event);
  let id = event.transaction.hash.concatI32(1).toHexString();
  assert.fieldEquals("StakingIncentivesClaimed", id, "stakingIncentive", "100");
  assert.fieldEquals("StakingIncentivesClaimed", id, "transferAmount", "0");
  assert.fieldEquals("StakingIncentivesClaimed", id, "returnAmount", "100");
  assert.fieldEquals("StakingIncentivesClaimed", id, "dispenser", PROXY.toHexString());
  assert.fieldEquals("StakingIncentivesClaimed", id, "chainId", "5000000000");
});
test("preserves partially withheld amounts and zero-incentive returns", () => {
  let first = single(1, 100, 60, 40); let second = single(2, 0, 0, 25);
  handleStakingIncentivesClaimed(first); handleStakingIncentivesClaimed(second);
  assert.entityCount("StakingIncentivesClaimed", 2);
  assert.fieldEquals("StakingIncentivesClaimed", first.transaction.hash.concatI32(1).toHexString(), "transferAmount", "60");
  assert.fieldEquals("StakingIncentivesClaimed", second.transaction.hash.concatI32(2).toHexString(), "returnAmount", "25");
});
test("preserves multiple batches and their targets in one transaction", () => {
  let first = batch(3); let second = batch(4);
  handleStakingIncentivesBatchClaimed(first); handleStakingIncentivesBatchClaimed(second);
  assert.entityCount("StakingIncentivesBatchClaimed", 2); assert.entityCount("StakingIncentivesBatch", 2);
  let id = PROXY.toHexString() + "_" + first.transaction.hash.concatI32(3).toHexString() + "_0";
  assert.fieldEquals("StakingIncentivesBatch", id, "chainId", "5000000000");
  assert.fieldEquals("StakingIncentivesBatchClaimed", first.transaction.hash.concatI32(3).toHexString(), "totalReturnAmount", "100");
});
test("does not invent a single-epoch allocation for aggregate claim events", () => {
  handleStakingIncentivesClaimed(single(1, 100, 100, 0)); handleStakingIncentivesBatchClaimed(batch(2));
  assert.entityCount("StakingIncentive", 0); assert.entityCount("Epoch", 0);
});
test("preserves uint256 processor route chain IDs", () => {
  let event = changetype<SetDepositProcessorChainIds>(newMockEvent()); event.address = PROXY;
  event.parameters = [param("depositProcessors", ethereum.Value.fromAddressArray([ACCOUNT])), param("chainIds", ethereum.Value.fromUnsignedBigIntArray([CHAIN]))];
  handleSetDepositProcessorChainIds(event);
  assert.fieldEquals("SetDepositProcessorChainIds", event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString(), "chainIds", "[5000000000]");
});
