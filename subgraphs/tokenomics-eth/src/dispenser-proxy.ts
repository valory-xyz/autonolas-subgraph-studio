import {
  IncentivesClaimed,
  OwnerUpdated,
  PauseDispenser,
  AddNomineeHash,
  RemoveNomineeHash,
  Retained,
  TreasuryUpdated,
  VoteWeightingUpdated,
  WithheldAmountSynced,
  ImplementationUpdated,
  SetDepositProcessorChainIds,
  StakingIncentivesClaimed,
  StakingIncentivesBatchClaimed
} from "../generated/DispenserProxy/DispenserProxy";
import * as LegacyEvents from "../generated/DispenserV2/DispenserV2";
import * as Legacy from "./dispenser";
import { DispenserImplementationUpdated } from "../generated/schema";

// Delegated events have identical layouts in the pinned legacy and proxy ABIs.
export function handleIncentivesClaimedV2(event: IncentivesClaimed): void {
  Legacy.handleIncentivesClaimedV2(changetype<LegacyEvents.IncentivesClaimed>(event));
}

export function handleOwnerUpdated(event: OwnerUpdated): void {
  Legacy.handleOwnerUpdated(changetype<LegacyEvents.OwnerUpdated>(event));
}

export function handlePauseDispenser(event: PauseDispenser): void {
  Legacy.handlePauseDispenser(changetype<LegacyEvents.PauseDispenser>(event));
}

export function handleAddNomineeHash(event: AddNomineeHash): void {
  Legacy.handleAddNomineeHash(changetype<LegacyEvents.AddNomineeHash>(event));
}

export function handleRemoveNomineeHash(event: RemoveNomineeHash): void {
  Legacy.handleRemoveNomineeHash(changetype<LegacyEvents.RemoveNomineeHash>(event));
}

export function handleRetained(event: Retained): void {
  Legacy.handleRetained(changetype<LegacyEvents.Retained>(event));
}

export function handleTreasuryUpdated(event: TreasuryUpdated): void {
  Legacy.handleTreasuryUpdated(changetype<LegacyEvents.TreasuryUpdated>(event));
}

export function handleVoteWeightingUpdated(event: VoteWeightingUpdated): void {
  Legacy.handleVoteWeightingUpdated(changetype<LegacyEvents.VoteWeightingUpdated>(event));
}

export function handleWithheldAmountSynced(event: WithheldAmountSynced): void {
  Legacy.handleWithheldAmountSynced(changetype<LegacyEvents.WithheldAmountSynced>(event));
}

export function handleImplementationUpdated(event: ImplementationUpdated): void {
  let entity = new DispenserImplementationUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.dispenser = event.address;
  entity.implementation = event.params.implementation;
  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;
  entity.save();
}

export function handleSetDepositProcessorChainIds(event: SetDepositProcessorChainIds): void {
  Legacy.handleSetDepositProcessorChainIds(changetype<LegacyEvents.SetDepositProcessorChainIds>(event));
}

// Proxy staking events retain aggregate amounts without the legacy epoch rollup.
export function handleStakingIncentivesClaimed(event: StakingIncentivesClaimed): void {
  Legacy.saveStakingIncentivesClaimed(changetype<LegacyEvents.StakingIncentivesClaimed>(event));
}

export function handleStakingIncentivesBatchClaimed(event: StakingIncentivesBatchClaimed): void {
  Legacy.saveStakingIncentivesBatchClaimed(changetype<LegacyEvents.StakingIncentivesBatchClaimed>(event));
}
