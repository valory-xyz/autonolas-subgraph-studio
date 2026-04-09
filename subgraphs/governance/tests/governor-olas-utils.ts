import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
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
  VotingPeriodSet
} from "../generated/GovernorOLAS/GovernorOLAS"

export function createProposalCreatedEvent(
  proposalId: BigInt,
  proposer: Address,
  targets: Address[],
  values: BigInt[],
  signatures: string[],
  calldatas: Bytes[],
  startBlock: BigInt,
  endBlock: BigInt,
  description: string
): ProposalCreated {
  let event = changetype<ProposalCreated>(newMockEvent())
  event.parameters = new Array()

  event.parameters.push(
    new ethereum.EventParam("proposalId", ethereum.Value.fromUnsignedBigInt(proposalId))
  )
  event.parameters.push(
    new ethereum.EventParam("proposer", ethereum.Value.fromAddress(proposer))
  )
  event.parameters.push(
    new ethereum.EventParam("targets", ethereum.Value.fromAddressArray(targets))
  )
  event.parameters.push(
    new ethereum.EventParam("values", ethereum.Value.fromUnsignedBigIntArray(values))
  )
  event.parameters.push(
    new ethereum.EventParam("signatures", ethereum.Value.fromStringArray(signatures))
  )
  event.parameters.push(
    new ethereum.EventParam("calldatas", ethereum.Value.fromBytesArray(calldatas))
  )
  event.parameters.push(
    new ethereum.EventParam("startBlock", ethereum.Value.fromUnsignedBigInt(startBlock))
  )
  event.parameters.push(
    new ethereum.EventParam("endBlock", ethereum.Value.fromUnsignedBigInt(endBlock))
  )
  event.parameters.push(
    new ethereum.EventParam("description", ethereum.Value.fromString(description))
  )

  return event
}

export function createProposalCanceledEvent(proposalId: BigInt): ProposalCanceled {
  let event = changetype<ProposalCanceled>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam("proposalId", ethereum.Value.fromUnsignedBigInt(proposalId))
  )
  return event
}

export function createProposalExecutedEvent(proposalId: BigInt): ProposalExecuted {
  let event = changetype<ProposalExecuted>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam("proposalId", ethereum.Value.fromUnsignedBigInt(proposalId))
  )
  return event
}

export function createProposalQueuedEvent(proposalId: BigInt, eta: BigInt): ProposalQueued {
  let event = changetype<ProposalQueued>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam("proposalId", ethereum.Value.fromUnsignedBigInt(proposalId))
  )
  event.parameters.push(
    new ethereum.EventParam("eta", ethereum.Value.fromUnsignedBigInt(eta))
  )
  return event
}

export function createVoteCastEvent(
  voter: Address,
  proposalId: BigInt,
  support: i32,
  weight: BigInt,
  reason: string
): VoteCast {
  let event = changetype<VoteCast>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam("voter", ethereum.Value.fromAddress(voter))
  )
  event.parameters.push(
    new ethereum.EventParam("proposalId", ethereum.Value.fromUnsignedBigInt(proposalId))
  )
  event.parameters.push(
    new ethereum.EventParam("support", ethereum.Value.fromI32(support))
  )
  event.parameters.push(
    new ethereum.EventParam("weight", ethereum.Value.fromUnsignedBigInt(weight))
  )
  event.parameters.push(
    new ethereum.EventParam("reason", ethereum.Value.fromString(reason))
  )
  return event
}

export function createVoteCastWithParamsEvent(
  voter: Address,
  proposalId: BigInt,
  support: i32,
  weight: BigInt,
  reason: string,
  params: Bytes
): VoteCastWithParams {
  let event = changetype<VoteCastWithParams>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam("voter", ethereum.Value.fromAddress(voter))
  )
  event.parameters.push(
    new ethereum.EventParam("proposalId", ethereum.Value.fromUnsignedBigInt(proposalId))
  )
  event.parameters.push(
    new ethereum.EventParam("support", ethereum.Value.fromI32(support))
  )
  event.parameters.push(
    new ethereum.EventParam("weight", ethereum.Value.fromUnsignedBigInt(weight))
  )
  event.parameters.push(
    new ethereum.EventParam("reason", ethereum.Value.fromString(reason))
  )
  event.parameters.push(
    new ethereum.EventParam("params", ethereum.Value.fromBytes(params))
  )
  return event
}

export function createProposalThresholdSetEvent(
  oldThreshold: BigInt,
  newThreshold: BigInt
): ProposalThresholdSet {
  let event = changetype<ProposalThresholdSet>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam("oldProposalThreshold", ethereum.Value.fromUnsignedBigInt(oldThreshold))
  )
  event.parameters.push(
    new ethereum.EventParam("newProposalThreshold", ethereum.Value.fromUnsignedBigInt(newThreshold))
  )
  return event
}

export function createVotingDelaySetEvent(
  oldDelay: BigInt,
  newDelay: BigInt
): VotingDelaySet {
  let event = changetype<VotingDelaySet>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam("oldVotingDelay", ethereum.Value.fromUnsignedBigInt(oldDelay))
  )
  event.parameters.push(
    new ethereum.EventParam("newVotingDelay", ethereum.Value.fromUnsignedBigInt(newDelay))
  )
  return event
}

export function createVotingPeriodSetEvent(
  oldPeriod: BigInt,
  newPeriod: BigInt
): VotingPeriodSet {
  let event = changetype<VotingPeriodSet>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam("oldVotingPeriod", ethereum.Value.fromUnsignedBigInt(oldPeriod))
  )
  event.parameters.push(
    new ethereum.EventParam("newVotingPeriod", ethereum.Value.fromUnsignedBigInt(newPeriod))
  )
  return event
}
