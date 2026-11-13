import { assert, beforeEach, clearStore, test } from "matchstick-as/assembly/index";
import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import * as LegacyEvents from "../generated/DispenserV2/DispenserV2";
import * as V1Events from "../generated/DispenserV1/DispenserV1";
import * as ProxyEvents from "../generated/DispenserProxy/DispenserProxy";
import * as Legacy from "../src/dispenser";
import * as Proxy from "../src/dispenser-proxy";
import { PROXY, OLD_DISPENSER, ACCOUNT, TARGET, CHAIN, param, uint, dispenserEvent, singleClaim, batchClaim, seedDispenserEpoch, mockClaimEpoch } from "./dispenser-utils";

beforeEach(() => {
  clearStore();
});

function checkSources(entity: string, params: ethereum.EventParam[]): void {
  const oldEvent = dispenserEvent<ethereum.Event>(OLD_DISPENSER, 1, params);
  const newEvent = dispenserEvent<ethereum.Event>(PROXY, 2, params);
  if (entity == "AddNomineeHash") {
    Legacy.handleAddNomineeHash(changetype<LegacyEvents.AddNomineeHash>(oldEvent));
    Proxy.handleAddNomineeHash(changetype<ProxyEvents.AddNomineeHash>(newEvent));
  } else if (entity == "RemoveNomineeHash") {
    Legacy.handleRemoveNomineeHash(changetype<LegacyEvents.RemoveNomineeHash>(oldEvent));
    Proxy.handleRemoveNomineeHash(changetype<ProxyEvents.RemoveNomineeHash>(newEvent));
  } else if (entity == "Retained") {
    Legacy.handleRetained(changetype<LegacyEvents.Retained>(oldEvent));
    Proxy.handleRetained(changetype<ProxyEvents.Retained>(newEvent));
  } else if (entity == "WithheldAmountSynced") {
    Legacy.handleWithheldAmountSynced(changetype<LegacyEvents.WithheldAmountSynced>(oldEvent));
    Proxy.handleWithheldAmountSynced(changetype<ProxyEvents.WithheldAmountSynced>(newEvent));
  } else if (entity == "PauseDispenser") {
    Legacy.handlePauseDispenser(changetype<LegacyEvents.PauseDispenser>(oldEvent));
    Proxy.handlePauseDispenser(changetype<ProxyEvents.PauseDispenser>(newEvent));
  } else if (entity == "OwnerUpdated") {
    Legacy.handleOwnerUpdated(changetype<LegacyEvents.OwnerUpdated>(oldEvent));
    Proxy.handleOwnerUpdated(changetype<ProxyEvents.OwnerUpdated>(newEvent));
  } else if (entity == "TreasuryUpdated") {
    Legacy.handleTreasuryUpdated(changetype<LegacyEvents.TreasuryUpdated>(oldEvent));
    Proxy.handleTreasuryUpdated(changetype<ProxyEvents.TreasuryUpdated>(newEvent));
  } else if (entity == "VoteWeightingUpdated") {
    Legacy.handleVoteWeightingUpdated(changetype<LegacyEvents.VoteWeightingUpdated>(oldEvent));
    Proxy.handleVoteWeightingUpdated(changetype<ProxyEvents.VoteWeightingUpdated>(newEvent));
  } else {
    seedDispenserEpoch();
    Legacy.handleIncentivesClaimedV2(changetype<LegacyEvents.IncentivesClaimed>(oldEvent));
    Proxy.handleIncentivesClaimedV2(changetype<ProxyEvents.IncentivesClaimed>(newEvent));
  }
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
