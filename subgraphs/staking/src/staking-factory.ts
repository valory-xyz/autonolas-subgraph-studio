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
import { Address, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
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

  let stakingContract = new StakingContract(event.params.instance);

  stakingContract.sender = event.params.sender;
  stakingContract.instance = event.params.instance;
  stakingContract.implementation = event.params.implementation;

  // Implementations expose different getters, so every read is attempted and
  // defaulted. configComplete records whether any of them fell back.
  const contract = StakingProxyContract.bind(event.params.instance);

  const metadataHash = contract.try_metadataHash();
  const maxNumServices = contract.try_maxNumServices();
  const rewardsPerSecond = contract.try_rewardsPerSecond();
  const minStakingDeposit = contract.try_minStakingDeposit();
  const minStakingDuration = contract.try_minStakingDuration();
  const maxNumInactivityPeriods = contract.try_maxNumInactivityPeriods();
  const livenessPeriod = contract.try_livenessPeriod();
  const timeForEmissions = contract.try_timeForEmissions();
  const numAgentInstances = contract.try_numAgentInstances();
  const agentIds = contract.try_getAgentIds();
  const threshold = contract.try_threshold();
  const configHash = contract.try_configHash();
  const proxyHash = contract.try_proxyHash();
  const serviceRegistry = contract.try_serviceRegistry();
  const activityChecker = contract.try_activityChecker();
  const tokenUtility = contract.try_serviceRegistryTokenUtility();
  const stakingToken = contract.try_stakingToken();
  const stakingManager = contract.try_stakingManager();
  const version = contract.try_VERSION();

  stakingContract.metadataHash = bytesOrEmpty(metadataHash);
  stakingContract.maxNumServices = bigIntOrZero(maxNumServices);
  stakingContract.rewardsPerSecond = bigIntOrZero(rewardsPerSecond);
  stakingContract.minStakingDeposit = bigIntOrZero(minStakingDeposit);
  stakingContract.minStakingDuration = bigIntOrZero(minStakingDuration);
  stakingContract.maxNumInactivityPeriods = bigIntOrZero(maxNumInactivityPeriods);
  stakingContract.livenessPeriod = bigIntOrZero(livenessPeriod);
  stakingContract.timeForEmissions = bigIntOrZero(timeForEmissions);
  stakingContract.numAgentInstances = bigIntOrZero(numAgentInstances);
  stakingContract.agentIds = agentIds.reverted ? [] : agentIds.value;
  stakingContract.threshold = bigIntOrZero(threshold);
  stakingContract.configHash = bytesOrEmpty(configHash);
  stakingContract.proxyHash = bytesOrEmpty(proxyHash);
  stakingContract.serviceRegistry = addressOrEmpty(serviceRegistry);
  stakingContract.activityChecker = addressOrEmpty(activityChecker);
  stakingContract.serviceRegistryTokenUtility = tokenUtility.reverted
    ? null
    : tokenUtility.value;
  stakingContract.stakingToken = stakingToken.reverted ? null : stakingToken.value;
  stakingContract.stakingManager = stakingManager.reverted
    ? null
    : stakingManager.value;
  stakingContract.version = version.reverted ? null : version.value;

  // The templated handlers decode the v1.2.x event signatures. From registries
  // v1.3.0, ServiceUnstaked gains a trailing bool and RewardClaimed returns
  // arrays, so neither matches while ServiceStaked still does — indexing such an
  // instance would add stakes that never get subtracted. Skip the template and
  // say so, rather than let the totals drift.
  //
  // An externally managed implementation reports 0.3.0 too, but keeps the v1.2.x
  // signatures; it exposes stakingManager(), which StakingBase never has.
  const versionString = version.reverted ? "" : version.value;
  stakingContract.eventsIndexed =
    version.reverted ||
    versionString == "0.1.0" ||
    versionString == "0.2.0" ||
    (versionString == "0.3.0" && !stakingManager.reverted);

  if (stakingContract.eventsIndexed) {
    StakingProxy.create(event.params.instance);
  } else {
    log.warning(
      "Instance {} reports version {}, whose events do not match the manifest; not indexing its events",
      [event.params.instance.toHexString(), versionString]
    );
  }

  // Guards every OLAS total. A revert is indistinguishable from a genuinely
  // different token, so it is logged: the entity is immutable, and a misread
  // leaves the contract out permanently.
  stakingContract.isOlasStaking =
    !stakingToken.reverted && stakingToken.value.equals(getOlasTokenAddress());
  if (stakingToken.reverted) {
    log.warning(
      "stakingToken() reverted for instance {}, excluding it from the OLAS totals",
      [event.params.instance.toHexString()]
    );
  }

  // stakingManager() is absent on most implementations, so it is not a failed read
  stakingContract.configComplete = !(
    metadataHash.reverted ||
    maxNumServices.reverted ||
    rewardsPerSecond.reverted ||
    minStakingDeposit.reverted ||
    minStakingDuration.reverted ||
    maxNumInactivityPeriods.reverted ||
    livenessPeriod.reverted ||
    timeForEmissions.reverted ||
    numAgentInstances.reverted ||
    agentIds.reverted ||
    threshold.reverted ||
    configHash.reverted ||
    proxyHash.reverted ||
    serviceRegistry.reverted ||
    activityChecker.reverted ||
    tokenUtility.reverted ||
    stakingToken.reverted
  );

  stakingContract.save();
}

function bigIntOrZero(result: ethereum.CallResult<BigInt>): BigInt {
  return result.reverted ? BigInt.zero() : result.value;
}

function bytesOrEmpty(result: ethereum.CallResult<Bytes>): Bytes {
  return result.reverted ? Bytes.empty() : result.value;
}

function addressOrEmpty(result: ethereum.CallResult<Address>): Bytes {
  return result.reverted ? Bytes.empty() : result.value;
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
