import { assert, clearStore, test, beforeEach } from "matchstick-as/assembly/index";
import * as LegacyEvents from "../generated/DispenserV2/DispenserV2";
import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import { ImplementationUpdated, SetDepositProcessorChainIds, IncentivesClaimed } from "../generated/DispenserProxy/DispenserProxy";
import { handleImplementationUpdated, handleStakingIncentivesClaimed, handleStakingIncentivesBatchClaimed, handleSetDepositProcessorChainIds, handleIncentivesClaimedV2 } from "../src/dispenser-proxy";
import { PROXY, ACCOUNT, CHAIN, param, uint, dispenserEvent, singleClaim, batchClaim, seedDispenserEpoch, mockClaimEpoch } from "./dispenser-utils";

beforeEach(() => {
  clearStore();
});

test("records proxy implementation updates", () => {
  const event = dispenserEvent<ImplementationUpdated>(PROXY, 1, [
    param("implementation", ethereum.Value.fromAddress(ACCOUNT)),
  ]);
  handleImplementationUpdated(event);
  const id = event.transaction.hash.concatI32(1).toHexString();
  assert.fieldEquals("DispenserImplementationUpdated", id, "dispenser", PROXY.toHexString());
  assert.fieldEquals("DispenserImplementationUpdated", id, "implementation", ACCOUNT.toHexString());
});

test("keeps incentive, actual transfer and return separate for withheld-covered claims", () => {
  const event = singleClaim(PROXY, 1, 100, 0, 100);
  handleStakingIncentivesClaimed(event);
  const id = event.transaction.hash.concatI32(1).toHexString();
  assert.fieldEquals("StakingIncentivesClaimed", id, "stakingIncentive", "100");
  assert.fieldEquals("StakingIncentivesClaimed", id, "transferAmount", "0");
  assert.fieldEquals("StakingIncentivesClaimed", id, "returnAmount", "100");
  assert.fieldEquals("StakingIncentivesClaimed", id, "dispenser", PROXY.toHexString());
  assert.fieldEquals("StakingIncentivesClaimed", id, "chainId", "5000000000");
});

test("preserves partially withheld amounts and zero-incentive returns", () => {
  const first = singleClaim(PROXY, 1, 100, 60, 40);
  const second = singleClaim(PROXY, 2, 0, 0, 25);
  handleStakingIncentivesClaimed(first);
  handleStakingIncentivesClaimed(second);
  assert.entityCount("StakingIncentivesClaimed", 2);
  assert.fieldEquals("StakingIncentivesClaimed", first.transaction.hash.concatI32(1).toHexString(), "transferAmount", "60");
  assert.fieldEquals("StakingIncentivesClaimed", second.transaction.hash.concatI32(2).toHexString(), "returnAmount", "25");
});

test("preserves multiple batches and their targets in one transaction", () => {
  const first = batchClaim(PROXY, 3);
  const second = batchClaim(PROXY, 4);
  handleStakingIncentivesBatchClaimed(first);
  handleStakingIncentivesBatchClaimed(second);
  assert.entityCount("StakingIncentivesBatchClaimed", 2);
  assert.entityCount("StakingIncentivesBatch", 2);
  const id = first.transaction.hash.concatI32(3).toHexString() + "_0";
  assert.fieldEquals("StakingIncentivesBatch", id, "chainId", "5000000000");
  assert.fieldEquals("StakingIncentivesBatchClaimed", first.transaction.hash.concatI32(3).toHexString(), "totalReturnAmount", "100");
});

test("aggregate proxy claims leave existing staking epoch totals unchanged", () => {
  seedDispenserEpoch();
  const chain = BigInt.fromI32(100);
  mockClaimEpoch(PROXY, chain);
  handleStakingIncentivesClaimed(singleClaim(PROXY, 1, 100, 100, 0, chain));
  handleStakingIncentivesBatchClaimed(batchClaim(PROXY, 2, chain));
  assert.entityCount("StakingIncentive", 0);
  assert.entityCount("Epoch", 1);
  assert.fieldEquals("Epoch", "1", "totalStakingIncentives", "25");
  assert.fieldEquals("Epoch", "1", "availableStakingIncentives", "1000");
});

test("proxy developer incentives create DevIncentive and update the epoch top-up", () => {
  seedDispenserEpoch();
  const event = dispenserEvent<IncentivesClaimed>(PROXY, 1, [
    param("owner", ethereum.Value.fromAddress(ACCOUNT)),
    param("reward", uint(5)),
    param("topUp", uint(7)),
    param("unitTypes", ethereum.Value.fromUnsignedBigIntArray([BigInt.zero()])),
    param("unitIds", ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(1)])),
  ]);
  handleIncentivesClaimedV2(changetype<LegacyEvents.IncentivesClaimed>(event));
  const id = event.transaction.hash.concatI32(1).toHexString();
  assert.fieldEquals("IncentivesClaimed", id, "dispenser", PROXY.toHexString());
  assert.entityCount("DevIncentive", 1);
  assert.fieldEquals("DevIncentive", event.transaction.hash.toHexString(), "epoch", "1");
  assert.fieldEquals("DevIncentive", event.transaction.hash.toHexString(), "reward", "5");
  assert.fieldEquals("DevIncentive", event.transaction.hash.toHexString(), "topUp", "7");
  assert.fieldEquals("Epoch", "1", "devIncentivesTotalTopUp", "17");
  assert.fieldEquals("Epoch", "1", "totalStakingIncentives", "25");
});

test("preserves uint256 processor route chain IDs", () => {
  const event = dispenserEvent<SetDepositProcessorChainIds>(PROXY, 1, [
    param("depositProcessors", ethereum.Value.fromAddressArray([ACCOUNT])),
    param("chainIds", ethereum.Value.fromUnsignedBigIntArray([CHAIN])),
  ]);
  handleSetDepositProcessorChainIds(changetype<LegacyEvents.SetDepositProcessorChainIds>(event));
  assert.fieldEquals("SetDepositProcessorChainIds", event.transaction.hash.concatI32(1).toHexString(), "chainIds", "[5000000000]");
});
