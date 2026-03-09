import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { IncentivesClaimed as IncentivesClaimedEvent } from "../generated/DispenserV1/DispenserV1";
import {
  DispenserV2,
  AddNomineeHash as AddNomineeHashEvent,
  IncentivesClaimed as IncentivesClaimedV2Event,
  OwnerUpdated as OwnerUpdatedEvent,
  PauseDispenser as PauseDispenserEvent,
  RemoveNomineeHash as RemoveNomineeHashEvent,
  Retained as RetainedEvent,
  SetDepositProcessorChainIds as SetDepositProcessorChainIdsEvent,
  StakingIncentivesBatchClaimed as StakingIncentivesBatchClaimedEvent,
  StakingIncentivesClaimed as StakingIncentivesClaimedEvent,
  TokenomicsUpdated as TokenomicsUpdatedEvent,
  TreasuryUpdated as TreasuryUpdatedEvent,
  VoteWeightingUpdated as VoteWeightingUpdatedEvent,
  WithheldAmountSynced as WithheldAmountSyncedEvent,
} from "../generated/DispenserV2/DispenserV2";
import {
  AddNomineeHash,
  Epoch,
  IncentivesClaimed,
  OwnerUpdated,
  TokenomicsUpdated,
  TreasuryUpdated,
  PauseDispenser,
  RemoveNomineeHash,
  Retained,
  SetDepositProcessorChainIds,
  StakingIncentivesBatchClaimed,
  StakingIncentivesClaimed,
  VoteWeightingUpdated,
  WithheldAmountSynced,
  StakingIncentive,
  StakingIncentivesBatch,
} from "../generated/schema";
import { DevIncentiveMapper, handleDevIncentiveSave } from "./mappings";
import { getNomineeHash } from "./utils";

export function handleIncentivesClaimed(event: IncentivesClaimedEvent): void {
  let entity = new IncentivesClaimed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.owner = event.params.owner;
  entity.reward = event.params.reward;
  entity.topUp = event.params.topUp;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();

  // Update Epoch entity with devIncentive
  const devIncentiveParams = new DevIncentiveMapper(
    event.block.number,
    event.transaction.hash,
    event.params.owner,
    event.params.reward,
    event.params.topUp
  );

  handleDevIncentiveSave(devIncentiveParams);
}

export function handleIncentivesClaimedV2(
  event: IncentivesClaimedV2Event
): void {
  let entity = new IncentivesClaimed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.owner = event.params.owner;
  entity.reward = event.params.reward;
  entity.topUp = event.params.topUp;
  entity.unitTypes = event.params.unitTypes;
  entity.unitIds = event.params.unitIds;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();

  // Update Epoch entity with devIncentive
  const devIncentiveParams = new DevIncentiveMapper(
    event.block.number,
    event.transaction.hash,
    event.params.owner,
    event.params.reward,
    event.params.topUp
  );

  handleDevIncentiveSave(devIncentiveParams);
}

export function handleOwnerUpdated(event: OwnerUpdatedEvent): void {
  let entity = new OwnerUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.owner = event.params.owner;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleTokenomicsUpdated(event: TokenomicsUpdatedEvent): void {
  let entity = new TokenomicsUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.tokenomics = event.params.tokenomics;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleTreasuryUpdated(event: TreasuryUpdatedEvent): void {
  let entity = new TreasuryUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.treasury = event.params.treasury;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleAddNomineeHash(event: AddNomineeHashEvent): void {
  let entity = new AddNomineeHash(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.nomineeHash = event.params.nomineeHash;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handlePauseDispenser(event: PauseDispenserEvent): void {
  let entity = new PauseDispenser(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.pauseState = event.params.pauseState;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleRemoveNomineeHash(event: RemoveNomineeHashEvent): void {
  let entity = new RemoveNomineeHash(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.nomineeHash = event.params.nomineeHash;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleRetained(event: RetainedEvent): void {
  let entity = new Retained(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.account = event.params.account;
  entity.returnAmount = event.params.returnAmount;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleSetDepositProcessorChainIds(
  event: SetDepositProcessorChainIdsEvent
): void {
  let entity = new SetDepositProcessorChainIds(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );

  // Convert Address[] to Bytes[]
  let depositProcessors: Bytes[] = event.params.depositProcessors.map<Bytes>(
    (address: Address): Bytes => {
      return address as Bytes;
    }
  );

  entity.depositProcessors = depositProcessors;
  entity.chainIds = event.params.chainIds.map<BigInt>((value) =>
    BigInt.fromI32(value.toI32())
  );

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleStakingIncentivesBatchClaimed(
  event: StakingIncentivesBatchClaimedEvent
): void {
  let entity = new StakingIncentivesBatchClaimed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.account = event.params.account;

  // It is currently impossible to handle nested arrays in event parameters.
  // Convert them to flat arrays and save them into separate entities.
  for (let i = 0; i < event.params.chainIds.length; i++) {
    let stakingIncentivesBatch = new StakingIncentivesBatch(
      `${event.transaction.hash.toHex()}_${i}`
    );
    stakingIncentivesBatch.batchClaim = entity.id;
    stakingIncentivesBatch.chainId = event.params.chainIds[i];
    stakingIncentivesBatch.stakingTargets = event.params.stakingTargets[i];
    stakingIncentivesBatch.stakingIncentives =
      event.params.stakingIncentives[i];
    stakingIncentivesBatch.save();
  }

  entity.totalStakingIncentive = event.params.totalStakingIncentive;
  entity.totalTransferAmount = event.params.totalTransferAmount;
  entity.totalReturnAmount = event.params.totalReturnAmount;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();

  const contract = DispenserV2.bind(event.address);

  for (let i = 0; i < event.params.chainIds.length; i++) {
    for (let j = 0; j < event.params.stakingTargets[i].length; j++) {
      const nomineeHash = getNomineeHash(
        event.params.stakingTargets[i][j],
        event.params.chainIds[i]
      );

      // Access the last claimed epoch from the contract state for the nominee hash.
      // This value is updated when the event occurs. We can subtract 1 epoch
      // to determine the epoch to which this claim belongs.
      const claimedEpoch = contract
        .mapLastClaimedStakingEpochs(nomineeHash)
        .minus(BigInt.fromI32(1));

      if (claimedEpoch) {
        const epoch = Epoch.load(claimedEpoch.toString());

        if (epoch) {
          let stakingIncentive = new StakingIncentive(
            `${event.transaction.hash.toHex()}_${event.params.chainIds[i]}_${j}`
          );
          stakingIncentive.epoch = epoch.id;
          stakingIncentive.account = event.params.account;
          stakingIncentive.chainId = event.params.chainIds[i];
          stakingIncentive.stakingTarget = event.params.stakingTargets[i][j];
          stakingIncentive.stakingIncentive =
            event.params.stakingIncentives[i][j];
          stakingIncentive.save();

          // Update the total staking incentives in the epoch
          if (!epoch.totalStakingIncentives) {
            epoch.totalStakingIncentives = event.params.stakingIncentives[i][j];
          } else {
            epoch.totalStakingIncentives = epoch.totalStakingIncentives!.plus(
              event.params.stakingIncentives[i][j]
            );
          }

          // Reduce available staking incentives in the epoch by stakingIncentive
          if (epoch.availableStakingIncentives) {
            epoch.availableStakingIncentives =
              epoch.availableStakingIncentives!.minus(
                event.params.stakingIncentives[i][j]
              );
          }

          epoch.save();
        }
      }
    }
  }
}

export function handleStakingIncentivesClaimed(
  event: StakingIncentivesClaimedEvent
): void {
  let entity = new StakingIncentivesClaimed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
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

  // Access the last claimed epoch from the contract state for the nominee hash.
  // This value is updated when the event occurs. We can subtract 1 epoch
  // to determine the epoch to which this claim belongs.
  const nomineeHash = getNomineeHash(entity.stakingTarget, entity.chainId);
  const contract = DispenserV2.bind(event.address);
  const claimedEpoch = contract
    .mapLastClaimedStakingEpochs(nomineeHash)
    .minus(BigInt.fromI32(1));

  if (claimedEpoch) {
    const epoch = Epoch.load(claimedEpoch.toString());

    if (epoch) {
      let stakingIncentive = new StakingIncentive(
        event.transaction.hash.toHex()
      );
      stakingIncentive.epoch = epoch.id;
      stakingIncentive.account = event.params.account;
      stakingIncentive.chainId = event.params.chainId;
      stakingIncentive.stakingTarget = event.params.stakingTarget;
      stakingIncentive.stakingIncentive = event.params.stakingIncentive;
      stakingIncentive.save();

      // Update the total staking incentives in the epoch
      if (!epoch.totalStakingIncentives) {
        epoch.totalStakingIncentives = event.params.stakingIncentive;
      } else {
        epoch.totalStakingIncentives = epoch.totalStakingIncentives!.plus(
          event.params.stakingIncentive
        );
      }

      // Reduce available staking incentives in the epoch by stakingIncentive
      if (epoch.availableStakingIncentives) {
        epoch.availableStakingIncentives =
          epoch.availableStakingIncentives!.minus(
            event.params.stakingIncentive
          );
      }

      epoch.save();
    }
  }
}

export function handleVoteWeightingUpdated(
  event: VoteWeightingUpdatedEvent
): void {
  let entity = new VoteWeightingUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.voteWeighting = event.params.voteWeighting;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleWithheldAmountSynced(
  event: WithheldAmountSyncedEvent
): void {
  let entity = new WithheldAmountSynced(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.chainId = event.params.chainId;
  entity.amount = event.params.amount;
  entity.updatedWithheldAmount = event.params.updatedWithheldAmount;
  entity.batchHash = event.params.batchHash;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}
