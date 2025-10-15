import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ProposalCanceled as ProposalCanceledEvent,
  ProposalCreated as ProposalCreatedEvent,
  ProposalExecuted as ProposalExecutedEvent,
  ProposalQueued as ProposalQueuedEvent,
  ProposalThresholdSet as ProposalThresholdSetEvent,
  QuorumNumeratorUpdated as QuorumNumeratorUpdatedEvent,
  TimelockChange as TimelockChangeEvent,
  VoteCast as VoteCastEvent,
  VoteCastWithParams as VoteCastWithParamsEvent,
  VotingDelaySet as VotingDelaySetEvent,
  VotingPeriodSet as VotingPeriodSetEvent,
} from "../generated/GovernorOLAS/GovernorOLAS";
import {
  ProposalCanceled,
  ProposalCreated,
  ProposalExecuted,
  ProposalQueued,
  ProposalThresholdSet,
  QuorumNumeratorUpdated,
  TimelockChange,
  VoteCast,
  VoteCastWithParams,
  VotingDelaySet,
  VotingPeriodSet,
} from "../generated/schema";
import { updateProposalQuorum } from "./utils";

export function handleProposalCanceled(event: ProposalCanceledEvent): void {
  let entity = new ProposalCanceled(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.proposalId = event.params.proposalId;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  let proposalCreated = ProposalCreated.load(
    event.params.proposalId.toString()
  );
  if (proposalCreated) {
    proposalCreated.isCancelled = true;
    proposalCreated.save();
  }

  updateProposalQuorum(
    event.params.proposalId,
    event.block.number,
    event.address
  );

  entity.save();
}

export function handleProposalCreated(event: ProposalCreatedEvent): void {
  let entity = new ProposalCreated(event.params.proposalId.toString());

  entity.proposalId = event.params.proposalId;
  entity.proposer = event.params.proposer;
  // Convert Address[] to Bytes[]
  entity.targets = event.params.targets.map<Bytes>(
    (address: Address): Bytes => {
      return address as Bytes;
    }
  );
  entity.values = event.params.values;
  entity.signatures = event.params.signatures;
  entity.calldatas = event.params.calldatas;
  entity.startBlock = event.params.startBlock;
  entity.endBlock = event.params.endBlock;
  entity.description = event.params.description;
  entity.isExecuted = false;
  entity.isCancelled = false;
  entity.isQueued = false;
  entity.votesFor = BigInt.fromI32(0);
  entity.votesAgainst = BigInt.fromI32(0);

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleProposalExecuted(event: ProposalExecutedEvent): void {
  let entity = new ProposalExecuted(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.proposalId = event.params.proposalId;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  let proposalCreated = ProposalCreated.load(
    event.params.proposalId.toString()
  );
  if (proposalCreated) {
    proposalCreated.isExecuted = true;
    proposalCreated.save();
  }

  updateProposalQuorum(
    event.params.proposalId,
    event.block.number,
    event.address
  );

  entity.save();
}

export function handleProposalQueued(event: ProposalQueuedEvent): void {
  let entity = new ProposalQueued(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.proposalId = event.params.proposalId;
  entity.eta = event.params.eta;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  let proposalCreated = ProposalCreated.load(
    event.params.proposalId.toString()
  );
  if (proposalCreated) {
    proposalCreated.isQueued = true;
    proposalCreated.save();
  }

  updateProposalQuorum(
    event.params.proposalId,
    event.block.number,
    event.address
  );

  entity.save();
}

export function handleProposalThresholdSet(
  event: ProposalThresholdSetEvent
): void {
  let entity = new ProposalThresholdSet(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.oldProposalThreshold = event.params.oldProposalThreshold;
  entity.newProposalThreshold = event.params.newProposalThreshold;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleQuorumNumeratorUpdated(
  event: QuorumNumeratorUpdatedEvent
): void {
  let entity = new QuorumNumeratorUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.oldQuorumNumerator = event.params.oldQuorumNumerator;
  entity.newQuorumNumerator = event.params.newQuorumNumerator;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleTimelockChange(event: TimelockChangeEvent): void {
  let entity = new TimelockChange(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.oldTimelock = event.params.oldTimelock;
  entity.newTimelock = event.params.newTimelock;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleVoteCast(event: VoteCastEvent): void {
  let entity = new VoteCast(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.voter = event.params.voter;
  entity.proposalId = event.params.proposalId;
  entity.support = event.params.support;
  entity.weight = event.params.weight;
  entity.reason = event.params.reason;
  entity.proposalCreated = event.params.proposalId.toString();

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  let proposalCreated = ProposalCreated.load(
    event.params.proposalId.toString()
  );
  if (proposalCreated) {
    if (entity.support === 0) {
      proposalCreated.votesAgainst = proposalCreated.votesAgainst.plus(
        event.params.weight
      );
    }
    if (entity.support === 1) {
      proposalCreated.votesFor = proposalCreated.votesFor.plus(
        event.params.weight
      );
    }
    proposalCreated.save();
  }

  entity.save();
}

export function handleVoteCastWithParams(event: VoteCastWithParamsEvent): void {
  let entity = new VoteCastWithParams(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.voter = event.params.voter;
  entity.proposalId = event.params.proposalId;
  entity.support = event.params.support;
  entity.weight = event.params.weight;
  entity.reason = event.params.reason;
  entity.params = event.params.params;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleVotingDelaySet(event: VotingDelaySetEvent): void {
  let entity = new VotingDelaySet(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.oldVotingDelay = event.params.oldVotingDelay;
  entity.newVotingDelay = event.params.newVotingDelay;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleVotingPeriodSet(event: VotingPeriodSetEvent): void {
  let entity = new VotingPeriodSet(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.oldVotingPeriod = event.params.oldVotingPeriod;
  entity.newVotingPeriod = event.params.newVotingPeriod;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}
