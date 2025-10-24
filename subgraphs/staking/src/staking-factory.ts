import { Bytes } from "@graphprotocol/graph-ts";
import {
  InstanceCreated as InstanceCreatedEvent,
  InstanceRemoved as InstanceRemovedEvent,
  InstanceStatusChanged as InstanceStatusChangedEvent,
  OwnerUpdated as OwnerUpdatedEvent,
  VerifierUpdated as VerifierUpdatedEvent
} from "../generated/StakingFactory/StakingFactory"
import {
  InstanceCreated,
  InstanceRemoved,
  InstanceStatusChanged,
  OwnerUpdated,
  VerifierUpdated,
  StakingContract
} from "../generated/schema"
import { StakingProxy } from "../generated/templates";
import { StakingProxy as StakingProxyContract } from "../generated/templates/StakingProxy/StakingProxy";

const ALLOWED_IMPLEMENTATIONS = [Bytes.fromHexString('0xEa00be6690a871827fAfD705440D20dd75e67AB1')]

export function handleInstanceCreated(event: InstanceCreatedEvent): void {
  StakingProxy.create(event.params.instance);

  let entity = new InstanceCreated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.sender = event.params.sender
  entity.instance = event.params.instance
  entity.implementation = event.params.implementation

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  if (!ALLOWED_IMPLEMENTATIONS.includes(entity.implementation)) return;

  let stakingContract = new StakingContract(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )

  stakingContract.sender = event.params.sender
  stakingContract.instance = event.params.instance
  stakingContract.implementation = event.params.implementation

  // Get remaining data on-chain
  const contract = StakingProxyContract.bind(event.params.instance);

  stakingContract.metadataHash = contract.metadataHash()
  stakingContract.maxNumServices = contract.maxNumServices()
  stakingContract.rewardsPerSecond = contract.rewardsPerSecond()
  stakingContract.minStakingDeposit = contract.minStakingDeposit()
  stakingContract.minStakingDuration = contract.minStakingDuration()
  stakingContract.maxNumInactivityPeriods = contract.maxNumInactivityPeriods()
  stakingContract.livenessPeriod = contract.livenessPeriod()
  stakingContract.timeForEmissions = contract.timeForEmissions()
  stakingContract.numAgentInstances = contract.numAgentInstances()
  stakingContract.agentIds = contract.getAgentIds()
  stakingContract.threshold = contract.threshold()
  stakingContract.configHash = contract.configHash()
  stakingContract.proxyHash = contract.proxyHash()
  stakingContract.serviceRegistry = contract.serviceRegistry()
  stakingContract.activityChecker = contract.activityChecker()

  stakingContract.save()
}

export function handleInstanceRemoved(event: InstanceRemovedEvent): void {
  let entity = new InstanceRemoved(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.instance = event.params.instance

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
  
}

export function handleInstanceStatusChanged(
  event: InstanceStatusChangedEvent
): void {
  let entity = new InstanceStatusChanged(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.instance = event.params.instance
  entity.isEnabled = event.params.isEnabled

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleOwnerUpdated(event: OwnerUpdatedEvent): void {
  let entity = new OwnerUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.owner = event.params.owner

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleVerifierUpdated(event: VerifierUpdatedEvent): void {
  let entity = new VerifierUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.verifier = event.params.verifier

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}