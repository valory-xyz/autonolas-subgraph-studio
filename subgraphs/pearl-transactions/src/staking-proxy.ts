import { Address, BigInt, ethereum, log } from "@graphprotocol/graph-ts";
import {
  RewardClaimed as RewardClaimedEvent,
  ServiceForceUnstaked as ServiceForceUnstakedEvent,
  ServiceStaked as ServiceStakedEvent,
  ServiceUnstaked as ServiceUnstakedEvent,
  ServicesEvicted as ServicesEvictedEvent,
} from "../generated/templates/StakingProxy/StakingProxy";
import { FundsMovement, Service } from "../generated/schema";
import {
  CATEGORY_SERVICE_EVICTED,
  CATEGORY_STAKING_REWARD_CLAIM,
  CATEGORY_UNSTAKE_REWARD,
  SERVICE_STATE_STAKED,
  SERVICE_STATE_UNSTAKED,
  SOURCE_SEMANTIC,
  getOlasAddress,
} from "./constants";
import {
  addDailyOlasReward,
  currentNetwork,
  fundsMovementId,
  getOrCreateAgentSafe,
  getOrCreateMasterSafe,
  getOrCreateService,
} from "./utils";

// handleServiceStaked — service NFT moved into the staking proxy.
// Both owner (Master Safe) and multisig (Agent Safe) are first-class
// event params, so this is the canonical Master Safe + Agent Safe
// discovery path (the NFT-Transfer path is secondary).
export function handleServiceStaked(event: ServiceStakedEvent): void {
  const serviceId = event.params.serviceId;
  const owner = event.params.owner;
  const multisig = event.params.multisig;
  const epoch = event.params.epoch;

  const service = getOrCreateService(serviceId, event);
  service.state = SERVICE_STATE_STAKED;
  service.currentStakingContract = event.address;
  service.updatedTimestamp = event.block.timestamp;
  service.save();

  // `owner` is the Master Safe (ServiceStaked carries it explicitly), so
  // this is the canonical discovery path. getOrCreateMasterSafe returns
  // null only if `owner` isn't a Safe (non-Pearl service / EOA owner) —
  // skip the link in that case rather than crash.
  const masterSafe = getOrCreateMasterSafe(owner, event);
  if (masterSafe != null) {
    service.masterSafe = masterSafe.id;
  }

  const agentSafe = getOrCreateAgentSafe(multisig, service, event);
  service.agentSafe = agentSafe.id;
  service.save();
}

// handleRewardClaimed — OLAS reward transferred from the staking proxy
// to the Agent Safe. Records a FundsMovement(STAKING_REWARD_CLAIM)
// and bumps both the per-service cumulative and the daily-bucket
// rollup.
export function handleRewardClaimed(event: RewardClaimedEvent): void {
  const serviceId = event.params.serviceId;
  const owner = event.params.owner; // Master Safe
  const multisig = event.params.multisig; // Agent Safe
  const reward = event.params.reward;
  const epoch = event.params.epoch;

  const service = getOrCreateService(serviceId, event);

  const row = new FundsMovement(fundsMovementId(event));
  row.service = service.id;
  if (service.masterSafe !== null) {
    row.masterSafe = service.masterSafe;
  } else {
    row.masterSafe = owner;
  }
  if (service.agentSafe !== null) {
    row.agentSafe = service.agentSafe;
  } else {
    row.agentSafe = multisig;
  }
  row.stakingContract = event.address;
  row.epoch = epoch;
  row.category = CATEGORY_STAKING_REWARD_CLAIM;
  row.source = SOURCE_SEMANTIC;
  row.token = getOlasAddress(currentNetwork());
  row.amount = reward;
  row.from = event.address; // staking proxy
  row.to = multisig;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();

  addDailyOlasReward(service, reward, event.block.timestamp);
  service.updatedTimestamp = event.block.timestamp;
  service.save();
}

function handleAnyUnstake(
  serviceId: BigInt,
  owner: Address,
  multisig: Address,
  reward: BigInt,
  epoch: BigInt,
  event: ethereum.Event
): void {
  const service = getOrCreateService(serviceId, event);

  const row = new FundsMovement(fundsMovementId(event));
  row.service = service.id;
  if (service.masterSafe !== null) {
    row.masterSafe = service.masterSafe;
  } else {
    row.masterSafe = owner;
  }
  if (service.agentSafe !== null) {
    row.agentSafe = service.agentSafe;
  } else {
    row.agentSafe = multisig;
  }
  row.stakingContract = event.address;
  row.epoch = epoch;
  row.category = CATEGORY_UNSTAKE_REWARD;
  row.source = SOURCE_SEMANTIC;
  row.token = getOlasAddress(currentNetwork());
  row.amount = reward;
  row.from = event.address;
  row.to = multisig;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();

  if (reward.gt(BigInt.zero())) {
    addDailyOlasReward(service, reward, event.block.timestamp);
  }
  service.state = SERVICE_STATE_UNSTAKED;
  service.currentStakingContract = null;
  service.updatedTimestamp = event.block.timestamp;
  service.save();
}

export function handleServiceUnstaked(event: ServiceUnstakedEvent): void {
  handleAnyUnstake(
    event.params.serviceId,
    event.params.owner,
    event.params.multisig,
    event.params.reward,
    event.params.epoch,
    event
  );
}

export function handleServiceForceUnstaked(
  event: ServiceForceUnstakedEvent
): void {
  handleAnyUnstake(
    event.params.serviceId,
    event.params.owner,
    event.params.multisig,
    event.params.reward,
    event.params.epoch,
    event
  );
}

// handleServicesEvicted — informational. Eviction itself does not
// move funds; we record one zero-amount FundsMovement(SERVICE_EVICTED)
// per affected service so the consumer wallet UI can render an
// "Evicted from staking" history row. The follow-up reward/refund
// transfers (if any) fire as their own typed events.
export function handleServicesEvicted(event: ServicesEvictedEvent): void {
  const serviceIds = event.params.serviceIds;
  const owners = event.params.owners;
  const multisigs = event.params.multisigs;
  const epoch = event.params.epoch;

  for (let i = 0; i < serviceIds.length; i++) {
    const serviceId = serviceIds[i];
    const owner = i < owners.length ? owners[i] : Address.zero();
    const multisig = i < multisigs.length ? multisigs[i] : Address.zero();

    const service = getOrCreateService(serviceId, event);

    // Unique-id per (tx, logIndex, serviceId-slot) since ServicesEvicted
    // is one event affecting many services. Use logIndex + i.
    const id = event.transaction.hash.concatI32(event.logIndex.toI32() + i);
    const row = new FundsMovement(id);
    row.service = service.id;
    if (service.masterSafe !== null) {
      row.masterSafe = service.masterSafe;
    } else {
      row.masterSafe = owner;
    }
    if (service.agentSafe !== null) {
      row.agentSafe = service.agentSafe;
    } else {
      row.agentSafe = multisig;
    }
    row.stakingContract = event.address;
    row.epoch = epoch;
    row.category = CATEGORY_SERVICE_EVICTED;
    row.source = SOURCE_SEMANTIC;
    row.amount = BigInt.zero();
    row.from = event.address;
    row.to = multisig;
    row.blockNumber = event.block.number;
    row.blockTimestamp = event.block.timestamp;
    row.transactionHash = event.transaction.hash;
    row.save();
  }
}
