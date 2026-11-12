import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
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
import {
  DispenserImplementationUpdated,
  StakingIncentivesClaimed as SingleClaim,
  StakingIncentivesBatchClaimed as BatchClaim,
  StakingIncentivesBatch,
  SetDepositProcessorChainIds as ProcessorRoutes,
} from "../generated/schema";

// Event layout is identical in the pinned old and deployment ABIs.
export function handleIncentivesClaimedV2(event: IncentivesClaimed): void {
  Legacy.handleIncentivesClaimedV2(changetype<LegacyEvents.IncentivesClaimed>(event));
}

// Event layout is identical in the pinned old and deployment ABIs.
export function handleOwnerUpdated(event: OwnerUpdated): void {
  Legacy.handleOwnerUpdated(changetype<LegacyEvents.OwnerUpdated>(event));
}

// Event layout is identical in the pinned old and deployment ABIs.
export function handlePauseDispenser(event: PauseDispenser): void {
  Legacy.handlePauseDispenser(changetype<LegacyEvents.PauseDispenser>(event));
}

// Event layout is identical in the pinned old and deployment ABIs.
export function handleAddNomineeHash(event: AddNomineeHash): void {
  Legacy.handleAddNomineeHash(changetype<LegacyEvents.AddNomineeHash>(event));
}

// Event layout is identical in the pinned old and deployment ABIs.
export function handleRemoveNomineeHash(event: RemoveNomineeHash): void {
  Legacy.handleRemoveNomineeHash(changetype<LegacyEvents.RemoveNomineeHash>(event));
}

// Event layout is identical in the pinned old and deployment ABIs.
export function handleRetained(event: Retained): void {
  Legacy.handleRetained(changetype<LegacyEvents.Retained>(event));
}

// Event layout is identical in the pinned old and deployment ABIs.
export function handleTreasuryUpdated(event: TreasuryUpdated): void {
  Legacy.handleTreasuryUpdated(changetype<LegacyEvents.TreasuryUpdated>(event));
}

// Event layout is identical in the pinned old and deployment ABIs.
export function handleVoteWeightingUpdated(event: VoteWeightingUpdated): void {
  Legacy.handleVoteWeightingUpdated(changetype<LegacyEvents.VoteWeightingUpdated>(event));
}

// Event layout is identical in the pinned old and deployment ABIs.
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
  let entity = new ProcessorRoutes(event.transaction.hash.concatI32(event.logIndex.toI32()));
  entity.depositProcessors = event.params.depositProcessors.map<Bytes>((value: Address): Bytes => value);
  // Preserve uint256 chain IDs without the legacy handler's i32 narrowing.
  entity.chainIds = event.params.chainIds;
  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;
  entity.save();
}

export function handleStakingIncentivesClaimed(event: StakingIncentivesClaimed): void {
  let entity = new SingleClaim(event.transaction.hash.concatI32(event.logIndex.toI32()));
  entity.dispenser = event.address;
  entity.account = event.params.account;
  entity.chainId = event.params.chainId;
  entity.stakingTarget = event.params.stakingTarget;
  entity.stakingIncentive = event.params.stakingIncentive;
  entity.transferAmount = event.params.transferAmount;
  entity.returnAmount = event.params.returnAmount;
  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;
  entity.save();
  // This event aggregates a claim range; it does not identify each epoch's share.
  // Do not apply the legacy lastClaimedEpoch - 1 rollup to this source.
}

export function handleStakingIncentivesBatchClaimed(event: StakingIncentivesBatchClaimed): void {
  let entity = new BatchClaim(event.transaction.hash.concatI32(event.logIndex.toI32()));
  entity.dispenser = event.address;
  entity.account = event.params.account;
  entity.totalStakingIncentive = event.params.totalStakingIncentive;
  entity.totalTransferAmount = event.params.totalTransferAmount;
  entity.totalReturnAmount = event.params.totalReturnAmount;
  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;
  entity.save();
  for (let i = 0; i < event.params.chainIds.length; i++) {
    let child = new StakingIncentivesBatch(
      event.address.toHexString() + "_" + entity.id.toHexString() + "_" + i.toString()
    );
    child.batchClaim = entity.id;
    child.chainId = event.params.chainIds[i];
    child.stakingTargets = event.params.stakingTargets[i];
    child.stakingIncentives = event.params.stakingIncentives[i];
    child.save();
  }
}
