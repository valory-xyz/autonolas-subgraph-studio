import { assert, beforeEach, clearStore, test, createMockedFunction } from "matchstick-as/assembly/index";
import { getNomineeHash } from "../src/utils";
import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import * as LegacyEvents from "../generated/DispenserV2/DispenserV2";
import * as V1Events from "../generated/DispenserV1/DispenserV1";
import * as Legacy from "../src/dispenser";
import * as Proxy from "../src/dispenser-proxy";
import { PROXY, OLD_DISPENSER, ACCOUNT, TARGET, CHAIN, param, uint, dispenserEvent, singleClaim, batchClaim, seedDispenserEpoch, mockClaimEpoch, nestedBatchClaim } from "./dispenser-utils";

beforeEach(() => {
  clearStore();
});

function checkSources(entity: string, params: ethereum.EventParam[]): void {
  const oldEvent = dispenserEvent<ethereum.Event>(OLD_DISPENSER, 1, params);
  const newEvent = dispenserEvent<ethereum.Event>(PROXY, 2, params);
  if (entity == "AddNomineeHash") {
    Legacy.handleAddNomineeHash(changetype<LegacyEvents.AddNomineeHash>(oldEvent));
    Proxy.handleAddNomineeHash(changetype<LegacyEvents.AddNomineeHash>(newEvent));
  } else if (entity == "RemoveNomineeHash") {
    Legacy.handleRemoveNomineeHash(changetype<LegacyEvents.RemoveNomineeHash>(oldEvent));
    Proxy.handleRemoveNomineeHash(changetype<LegacyEvents.RemoveNomineeHash>(newEvent));
  } else if (entity == "Retained") {
    Legacy.handleRetained(changetype<LegacyEvents.Retained>(oldEvent));
    Proxy.handleRetained(changetype<LegacyEvents.Retained>(newEvent));
  } else if (entity == "WithheldAmountSynced") {
    Legacy.handleWithheldAmountSynced(changetype<LegacyEvents.WithheldAmountSynced>(oldEvent));
    Proxy.handleWithheldAmountSynced(changetype<LegacyEvents.WithheldAmountSynced>(newEvent));
  } else if (entity == "PauseDispenser") {
    Legacy.handlePauseDispenser(changetype<LegacyEvents.PauseDispenser>(oldEvent));
    Proxy.handlePauseDispenser(changetype<LegacyEvents.PauseDispenser>(newEvent));
  } else if (entity == "OwnerUpdated") {
    Legacy.handleOwnerUpdated(changetype<LegacyEvents.OwnerUpdated>(oldEvent));
    Proxy.handleOwnerUpdated(changetype<LegacyEvents.OwnerUpdated>(newEvent));
  } else if (entity == "TreasuryUpdated") {
    Legacy.handleTreasuryUpdated(changetype<LegacyEvents.TreasuryUpdated>(oldEvent));
    Proxy.handleTreasuryUpdated(changetype<LegacyEvents.TreasuryUpdated>(newEvent));
  } else if (entity == "VoteWeightingUpdated") {
    Legacy.handleVoteWeightingUpdated(changetype<LegacyEvents.VoteWeightingUpdated>(oldEvent));
    Proxy.handleVoteWeightingUpdated(changetype<LegacyEvents.VoteWeightingUpdated>(newEvent));
  } else if (entity == "SetDepositProcessorChainIds") {
    Legacy.handleSetDepositProcessorChainIds(changetype<LegacyEvents.SetDepositProcessorChainIds>(oldEvent));
    Proxy.handleSetDepositProcessorChainIds(changetype<LegacyEvents.SetDepositProcessorChainIds>(newEvent));
  } else if (entity == "IncentivesClaimed") {
    seedDispenserEpoch();
    Legacy.handleIncentivesClaimedV2(changetype<LegacyEvents.IncentivesClaimed>(oldEvent));
    Proxy.handleIncentivesClaimedV2(changetype<LegacyEvents.IncentivesClaimed>(newEvent));
  } else {
    throw new Error("Unknown Dispenser entity: " + entity);
  }

  const fields = ["AddNomineeHash", "RemoveNomineeHash", "Retained", "WithheldAmountSynced", "PauseDispenser", "OwnerUpdated", "TreasuryUpdated", "VoteWeightingUpdated", "IncentivesClaimed", "SetDepositProcessorChainIds"];
  const names = ["nomineeHash", "nomineeHash", "returnAmount", "updatedWithheldAmount", "pauseState", "owner", "treasury", "voteWeighting", "topUp", "chainIds"];
  const values = [TARGET.toHexString(), TARGET.toHexString(), "10", "20", "2", ACCOUNT.toHexString(), ACCOUNT.toHexString(), ACCOUNT.toHexString(), "7", "[5000000000]"];
  const index = fields.indexOf(entity);
  assert.fieldEquals(entity, oldEvent.transaction.hash.concatI32(1).toHexString(), names[index], values[index]);
  assert.fieldEquals(entity, newEvent.transaction.hash.concatI32(2).toHexString(), names[index], values[index]);
  assert.entityCount(entity, 2);
  assert.fieldEquals(entity, oldEvent.transaction.hash.concatI32(1).toHexString(), "dispenser", OLD_DISPENSER.toHexString());
  assert.fieldEquals(entity, newEvent.transaction.hash.concatI32(2).toHexString(), "dispenser", PROXY.toHexString());
}

test("AddNomineeHash exposes legacy and proxy Dispensers separately", () => {
  checkSources("AddNomineeHash", [param("nomineeHash", ethereum.Value.fromFixedBytes(TARGET))]);
});
test("RemoveNomineeHash exposes legacy and proxy Dispensers separately", () => {
  checkSources("RemoveNomineeHash", [param("nomineeHash", ethereum.Value.fromFixedBytes(TARGET))]);
});
test("Retained exposes legacy and proxy Dispensers separately", () => {
  checkSources("Retained", [param("account", ethereum.Value.fromAddress(ACCOUNT)), param("returnAmount", uint(10))]);
});
test("WithheldAmountSynced exposes legacy and proxy Dispensers separately", () => {
  checkSources("WithheldAmountSynced", [
    param("chainId", ethereum.Value.fromUnsignedBigInt(CHAIN)),
    param("amount", uint(10)),
    param("updatedWithheldAmount", uint(20)),
    param("batchHash", ethereum.Value.fromFixedBytes(TARGET)),
  ]);
});
test("PauseDispenser identifies the source of the latest pause event", () => {
  checkSources("PauseDispenser", [param("pauseState", uint(2))]);
});
test("OwnerUpdated exposes legacy and proxy Dispensers separately", () => {
  checkSources("OwnerUpdated", [param("owner", ethereum.Value.fromAddress(ACCOUNT))]);
});
test("TreasuryUpdated exposes legacy and proxy Dispensers separately", () => {
  checkSources("TreasuryUpdated", [param("treasury", ethereum.Value.fromAddress(ACCOUNT))]);
});
test("VoteWeightingUpdated exposes legacy and proxy Dispensers separately", () => {
  checkSources("VoteWeightingUpdated", [param("voteWeighting", ethereum.Value.fromAddress(ACCOUNT))]);
});
test("developer IncentivesClaimed identifies V2 and proxy sources", () => {
  checkSources("IncentivesClaimed", [
    param("owner", ethereum.Value.fromAddress(ACCOUNT)),
    param("reward", uint(5)),
    param("topUp", uint(7)),
    param("unitTypes", ethereum.Value.fromUnsignedBigIntArray([BigInt.zero()])),
    param("unitIds", ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(1)])),
  ]);
});
test("V1 developer IncentivesClaimed also records its Dispenser", () => {
  const event = dispenserEvent<V1Events.IncentivesClaimed>(OLD_DISPENSER, 1, [
    param("owner", ethereum.Value.fromAddress(ACCOUNT)),
    param("reward", uint(5)),
    param("topUp", uint(7)),
  ]);
  Legacy.handleIncentivesClaimed(event);
  assert.fieldEquals("IncentivesClaimed", event.transaction.hash.concatI32(1).toHexString(), "dispenser", OLD_DISPENSER.toHexString());
});
test("single claims attribute both sources while preserving the legacy epoch rollup", () => {
  seedDispenserEpoch();
  const chain = BigInt.fromI32(100);
  mockClaimEpoch(OLD_DISPENSER, chain);
  const oldEvent = singleClaim(OLD_DISPENSER, 1, 100, 100, 0, chain);
  const newEvent = singleClaim(PROXY, 2, 100, 100, 0, chain);
  Legacy.handleStakingIncentivesClaimed(changetype<LegacyEvents.StakingIncentivesClaimed>(oldEvent));
  Proxy.handleStakingIncentivesClaimed(newEvent);
  assert.entityCount("StakingIncentivesClaimed", 2);
  assert.fieldEquals("StakingIncentivesClaimed", oldEvent.transaction.hash.concatI32(1).toHexString(), "dispenser", OLD_DISPENSER.toHexString());
  assert.fieldEquals("StakingIncentivesClaimed", newEvent.transaction.hash.concatI32(2).toHexString(), "dispenser", PROXY.toHexString());
  assert.entityCount("StakingIncentive", 1);
  assert.fieldEquals("Epoch", "1", "totalStakingIncentives", "125");
  assert.fieldEquals("Epoch", "1", "availableStakingIncentives", "900");
});
test("batch claims attribute both sources and retain historical batch-child IDs", () => {
  seedDispenserEpoch();
  const chain = BigInt.fromI32(100);
  mockClaimEpoch(OLD_DISPENSER, chain);
  const oldEvent = batchClaim(OLD_DISPENSER, 1, chain);
  const newEvent = batchClaim(PROXY, 2, chain);
  Legacy.handleStakingIncentivesBatchClaimed(changetype<LegacyEvents.StakingIncentivesBatchClaimed>(oldEvent));
  Proxy.handleStakingIncentivesBatchClaimed(newEvent);
  assert.entityCount("StakingIncentivesBatchClaimed", 2);
  assert.fieldEquals("StakingIncentivesBatchClaimed", oldEvent.transaction.hash.concatI32(1).toHexString(), "dispenser", OLD_DISPENSER.toHexString());
  assert.fieldEquals("StakingIncentivesBatchClaimed", newEvent.transaction.hash.concatI32(2).toHexString(), "dispenser", PROXY.toHexString());
  assert.entityCount("StakingIncentivesBatch", 2);
  assert.fieldEquals("StakingIncentivesBatch", oldEvent.transaction.hash.toHexString() + "_0", "chainId", "100");
  assert.fieldEquals("StakingIncentivesBatch", newEvent.transaction.hash.concatI32(2).toHexString() + "_0", "chainId", "100");
  assert.entityCount("StakingIncentive", 1);
  assert.fieldEquals("Epoch", "1", "totalStakingIncentives", "125");
});
test("legacy processor routes preserve full uint256 chain IDs too", () => {
  const event = dispenserEvent<LegacyEvents.SetDepositProcessorChainIds>(OLD_DISPENSER, 1, [
    param("depositProcessors", ethereum.Value.fromAddressArray([ACCOUNT])),
    param("chainIds", ethereum.Value.fromUnsignedBigIntArray([CHAIN])),
  ]);
  Legacy.handleSetDepositProcessorChainIds(event);
  assert.fieldEquals("SetDepositProcessorChainIds", event.transaction.hash.concatI32(1).toHexString(), "chainIds", "[5000000000]");
});

test("processor routes expose legacy and proxy Dispensers separately", () => {
  checkSources("SetDepositProcessorChainIds", [
    param("depositProcessors", ethereum.Value.fromAddressArray([ACCOUNT])),
    param("chainIds", ethereum.Value.fromUnsignedBigIntArray([CHAIN])),
  ]);
});

test("nested batches preserve every chain, target and amount on both paths", () => {
  seedDispenserEpoch();
  const oldEvent = nestedBatchClaim(OLD_DISPENSER, 3);
  const newEvent = nestedBatchClaim(PROXY, 4);
  Legacy.handleStakingIncentivesBatchClaimed(changetype<LegacyEvents.StakingIncentivesBatchClaimed>(oldEvent));
  Proxy.handleStakingIncentivesBatchClaimed(newEvent);
  const prefixes = [oldEvent.transaction.hash.toHexString(), newEvent.transaction.hash.concatI32(4).toHexString()];
  for (let i = 0; i < prefixes.length; i++) {
    const first = prefixes[i] + "_0";
    const second = prefixes[i] + "_1";
    assert.fieldEquals("StakingIncentivesBatch", first, "chainId", "1");
    assert.fieldEquals("StakingIncentivesBatch", first, "stakingTargets", "[0x0000000000000000000000000000000000000000000000000000000000000001, 0x0000000000000000000000000000000000000000000000000000000000000002]");
    assert.fieldEquals("StakingIncentivesBatch", first, "stakingIncentives", "[30, 70]");
    assert.fieldEquals("StakingIncentivesBatch", second, "chainId", "100");
    assert.fieldEquals("StakingIncentivesBatch", second, "stakingTargets", "[0x0000000000000000000000000000000000000000000000000000000000000003]");
    assert.fieldEquals("StakingIncentivesBatch", second, "stakingIncentives", "[50]");
  }
  assert.entityCount("StakingIncentivesBatch", 4);
  assert.entityCount("StakingIncentive", 3);
  assert.fieldEquals("Epoch", "1", "totalStakingIncentives", "175");
});

test("legacy non-positive claimed epochs keep raw claims without adding rollups", () => {
  seedDispenserEpoch();
  createMockedFunction(OLD_DISPENSER, "mapLastClaimedStakingEpochs", "mapLastClaimedStakingEpochs(bytes32):(uint256)")
    .withArgs([ethereum.Value.fromFixedBytes(getNomineeHash(TARGET, CHAIN))])
    .returns([uint(0)]);
  Legacy.handleStakingIncentivesClaimed(changetype<LegacyEvents.StakingIncentivesClaimed>(singleClaim(OLD_DISPENSER, 20, 100, 100, 0)));
  createMockedFunction(OLD_DISPENSER, "mapLastClaimedStakingEpochs", "mapLastClaimedStakingEpochs(bytes32):(uint256)")
    .withArgs([ethereum.Value.fromFixedBytes(getNomineeHash(TARGET, CHAIN))])
    .returns([uint(1)]);
  Legacy.handleStakingIncentivesBatchClaimed(changetype<LegacyEvents.StakingIncentivesBatchClaimed>(batchClaim(OLD_DISPENSER, 21)));
  assert.entityCount("StakingIncentivesClaimed", 1);
  assert.entityCount("StakingIncentivesBatchClaimed", 1);
  assert.entityCount("StakingIncentive", 0);
  assert.fieldEquals("Epoch", "1", "totalStakingIncentives", "25");
  assert.fieldEquals("Epoch", "1", "availableStakingIncentives", "1000");
});
