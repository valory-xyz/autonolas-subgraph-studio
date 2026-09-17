import {
  InstanceCreated as InstanceCreatedEvent,
  InstanceRemoved as InstanceRemovedEvent,
  InstanceStatusChanged as InstanceStatusChangedEvent,
  OwnerUpdated as OwnerUpdatedEvent,
  VerifierUpdated as VerifierUpdatedEvent,
} from "../generated/StakingFactory/StakingFactory";
import {
  InstanceCreated,
  InstanceRemoved,
  InstanceStatusChanged,
  OwnerUpdated,
  VerifierUpdated,
  StakingContract,
} from "../generated/schema";
import { StakingProxy } from "../generated/templates";
import { StakingProxy as StakingProxyContract } from "../generated/templates/StakingProxy/StakingProxy";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { getOlasTokenAddress } from "../../../shared/constants";

export function handleInstanceCreated(event: InstanceCreatedEvent): void {
  let entity = new InstanceCreated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.sender = event.params.sender;
  entity.instance = event.params.instance;
  entity.implementation = event.params.implementation;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();

  StakingProxy.create(event.params.instance);

  let stakingContract = new StakingContract(event.params.instance);

  stakingContract.sender = event.params.sender;
  stakingContract.instance = event.params.instance;
  stakingContract.implementation = event.params.implementation;

  // Implementations expose different getters, so every read is attempted and
  // defaulted. configComplete records whether any of them fell back.
  const contract = StakingProxyContract.bind(event.params.instance);
  let configComplete = true;

  const metadataHash = contract.try_metadataHash();
  if (metadataHash.reverted) configComplete = false;
  stakingContract.metadataHash = metadataHash.reverted
    ? Bytes.empty()
    : metadataHash.value;

  const maxNumServices = contract.try_maxNumServices();
  if (maxNumServices.reverted) configComplete = false;
  stakingContract.maxNumServices = maxNumServices.reverted
    ? BigInt.zero()
    : maxNumServices.value;

  const rewardsPerSecond = contract.try_rewardsPerSecond();
  if (rewardsPerSecond.reverted) configComplete = false;
  stakingContract.rewardsPerSecond = rewardsPerSecond.reverted
    ? BigInt.zero()
    : rewardsPerSecond.value;

  const minStakingDeposit = contract.try_minStakingDeposit();
  if (minStakingDeposit.reverted) configComplete = false;
  stakingContract.minStakingDeposit = minStakingDeposit.reverted
    ? BigInt.zero()
    : minStakingDeposit.value;

  const minStakingDuration = contract.try_minStakingDuration();
  if (minStakingDuration.reverted) configComplete = false;
  stakingContract.minStakingDuration = minStakingDuration.reverted
    ? BigInt.zero()
    : minStakingDuration.value;

  const maxNumInactivityPeriods = contract.try_maxNumInactivityPeriods();
  if (maxNumInactivityPeriods.reverted) configComplete = false;
  stakingContract.maxNumInactivityPeriods = maxNumInactivityPeriods.reverted
    ? BigInt.zero()
    : maxNumInactivityPeriods.value;

  const livenessPeriod = contract.try_livenessPeriod();
  if (livenessPeriod.reverted) configComplete = false;
  stakingContract.livenessPeriod = livenessPeriod.reverted
    ? BigInt.zero()
    : livenessPeriod.value;

  const timeForEmissions = contract.try_timeForEmissions();
  if (timeForEmissions.reverted) configComplete = false;
  stakingContract.timeForEmissions = timeForEmissions.reverted
    ? BigInt.zero()
    : timeForEmissions.value;

  const numAgentInstances = contract.try_numAgentInstances();
  if (numAgentInstances.reverted) configComplete = false;
  stakingContract.numAgentInstances = numAgentInstances.reverted
    ? BigInt.zero()
    : numAgentInstances.value;

  const agentIds = contract.try_getAgentIds();
  if (agentIds.reverted) configComplete = false;
  stakingContract.agentIds = agentIds.reverted ? [] : agentIds.value;

  const threshold = contract.try_threshold();
  if (threshold.reverted) configComplete = false;
  stakingContract.threshold = threshold.reverted
    ? BigInt.zero()
    : threshold.value;

  const configHash = contract.try_configHash();
  if (configHash.reverted) configComplete = false;
  stakingContract.configHash = configHash.reverted
    ? Bytes.empty()
    : configHash.value;

  const proxyHash = contract.try_proxyHash();
  if (proxyHash.reverted) configComplete = false;
  stakingContract.proxyHash = proxyHash.reverted
    ? Bytes.empty()
    : proxyHash.value;

  const serviceRegistry = contract.try_serviceRegistry();
  if (serviceRegistry.reverted) configComplete = false;
  stakingContract.serviceRegistry = serviceRegistry.reverted
    ? Bytes.empty()
    : serviceRegistry.value;

  const activityChecker = contract.try_activityChecker();
  if (activityChecker.reverted) configComplete = false;
  stakingContract.activityChecker = activityChecker.reverted
    ? Bytes.empty()
    : activityChecker.value;

  // Deposits and agent bonds sit here, not on the staking contract
  const tokenUtility = contract.try_serviceRegistryTokenUtility();
  if (tokenUtility.reverted) configComplete = false;
  stakingContract.serviceRegistryTokenUtility = tokenUtility.reverted
    ? null
    : tokenUtility.value;

  // Non-OLAS deposits must not reach the OLAS totals
  const stakingToken = contract.try_stakingToken();
  stakingContract.stakingToken = stakingToken.reverted ? null : stakingToken.value;
  stakingContract.isOlasStaking =
    !stakingToken.reverted && stakingToken.value.equals(getOlasTokenAddress());

  // Not exposed by every implementation
  const stakingManager = contract.try_stakingManager();
  stakingContract.stakingManager = stakingManager.reverted
    ? null
    : stakingManager.value;

  stakingContract.configComplete = configComplete;

  stakingContract.save();
}

export function handleInstanceRemoved(event: InstanceRemovedEvent): void {
  let entity = new InstanceRemoved(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.instance = event.params.instance;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleInstanceStatusChanged(
  event: InstanceStatusChangedEvent
): void {
  let entity = new InstanceStatusChanged(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.instance = event.params.instance;
  entity.isEnabled = event.params.isEnabled;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
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

export function handleVerifierUpdated(event: VerifierUpdatedEvent): void {
  let entity = new VerifierUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.verifier = event.params.verifier;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}
