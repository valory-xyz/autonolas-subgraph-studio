import {
  ImplementationUpdated,
  StakingIncentivesClaimed,
  StakingIncentivesBatchClaimed
} from "../generated/DispenserProxy/DispenserProxy";
import * as LegacyEvents from "../generated/DispenserV2/DispenserV2";
import * as Legacy from "./dispenser";
import { DispenserImplementationUpdated } from "../generated/schema";

// ABI compatibility for shared handlers is enforced by scripts/dispenser-abi.test.cjs.
export {
  handleIncentivesClaimedV2,
  handleOwnerUpdated,
  handlePauseDispenser,
  handleAddNomineeHash,
  handleRemoveNomineeHash,
  handleRetained,
  handleTreasuryUpdated,
  handleVoteWeightingUpdated,
  handleWithheldAmountSynced,
  handleSetDepositProcessorChainIds,
} from "./dispenser";

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

// Apply the existing last-claimed-epoch attribution to proxy claims too.
export function handleStakingIncentivesClaimed(event: StakingIncentivesClaimed): void {
  Legacy.processStakingIncentivesClaimed(changetype<LegacyEvents.StakingIncentivesClaimed>(event), false);
}

export function handleStakingIncentivesBatchClaimed(event: StakingIncentivesBatchClaimed): void {
  Legacy.processStakingIncentivesBatchClaimed(changetype<LegacyEvents.StakingIncentivesBatchClaimed>(event), false);
}
