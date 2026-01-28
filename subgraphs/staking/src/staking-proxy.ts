import { Address, Bytes, BigInt, log } from "@graphprotocol/graph-ts"
import {
  Checkpoint as CheckpointEvent,
  Deposit as DepositEvent,
  RewardClaimed as RewardClaimedEvent,
  ServiceForceUnstaked as ServiceForceUnstakedEvent,
  ServiceInactivityWarning as ServiceInactivityWarningEvent,
  ServiceStaked as ServiceStakedEvent,
  ServiceUnstaked as ServiceUnstakedEvent,
  ServicesEvicted as ServicesEvictedEvent,
  Withdraw as WithdrawEvent,
} from "../generated/templates/StakingProxy/StakingProxy"
import {
  Checkpoint,
  Deposit,
  RewardClaimed,
  Service,
  ServiceForceUnstaked,
  ServiceInactivityWarning,
  ServiceStaked,
  ServiceUnstaked,
  ServicesEvicted,
  Withdraw,
  ActiveServiceEpoch
} from "../generated/schema"
import { createRewardUpdate, getOrCreateGlobal, getOlasForStaking, upsertCumulativeDailyStakingGlobal, getOrCreateServiceRewardsHistory, processUnstake } from "./utils"

export function handleCheckpoint(event: CheckpointEvent): void {
  let entity = new Checkpoint(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.epoch = event.params.epoch
  entity.availableRewards = event.params.availableRewards
  entity.serviceIds = event.params.serviceIds
  entity.rewards = event.params.rewards
  entity.epochLength = event.params.epochLength
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.contractAddress = event.address
  entity.save()

  let activeKey = event.address.toHexString() + "-" + event.params.epoch.toString();
  let activeTracker = ActiveServiceEpoch.load(activeKey);
  
  let rewardedServices = event.params.serviceIds;
  let rewardedAmounts = event.params.rewards;
  let totalRewards = BigInt.fromI32(0);

  // Map to track which services we've already processed for rewards
  let handledServicesMap = new Map<string, boolean>();
  
  // 1. Process rewarded services directly from the event
  for (let i = 0; i < rewardedServices.length; i++) {
    let serviceId = rewardedServices[i];
    let serviceIdStr = serviceId.toString();
    let reward = rewardedAmounts[i];
    
    totalRewards = totalRewards.plus(reward);
    handledServicesMap.set(serviceIdStr, true);

    // Update individual Service cumulative earnings
    let service = Service.load(serviceIdStr);
    if (service !== null) {
      service.olasRewardsEarned = service.olasRewardsEarned.plus(reward);
      service.save();
    }

    // Create history entry for the service that received rewards
    let history = getOrCreateServiceRewardsHistory(
      serviceId,
      event.address,
      event.params.epoch,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash
    );
    history.rewardAmount = reward;
    history.checkpoint = entity.id;
    history.checkpointedAt = event.block.timestamp;
    history.save();
  }

  // 2. Process "Active but not rewarded" services (Zero Rewards)
  // Only runs if we have the tracker for this epoch
  let allActiveServices: BigInt[] = [];
  if (activeTracker !== null) {
    allActiveServices = activeTracker.activeServiceIds;

    for (let i = 0; i < allActiveServices.length; i++) {
      let serviceId = allActiveServices[i];
      let serviceIdStr = serviceId.toString();

      // Skip if handled in the rewarded loop above
      if (handledServicesMap.has(serviceIdStr)) continue;

      // Check if service has migrated to a different contract
      // If so, stop creating zero-reward entries for this contract
      let service = Service.load(serviceIdStr);
      if (service !== null) {
        if (service.latestStakingContract !== null &&
            service.latestStakingContract!.toHexString() != event.address.toHexString()) {
          continue; // Service has migrated to a different contract
        }
      }

      let history = getOrCreateServiceRewardsHistory(
        serviceId,
        event.address,
        event.params.epoch,
        event.block.number,
        event.block.timestamp,
        event.transaction.hash
      );
      history.rewardAmount = BigInt.fromI32(0);
      history.checkpoint = entity.id;
      history.checkpointedAt = event.block.timestamp;
      history.save();
    }

    // 3. Roll over to next epoch (Merging & Deduplicating to avoid race conditions)
    let nextEpoch = event.params.epoch.plus(BigInt.fromI32(1));
    let nextKey = event.address.toHexString() + "-" + nextEpoch.toString();
    
    let nextTracker = ActiveServiceEpoch.load(nextKey);
    if (nextTracker === null) {
      // Case A: No one has staked for the next epoch yet
      nextTracker = new ActiveServiceEpoch(nextKey);
      nextTracker.contractAddress = event.address;
      nextTracker.epoch = nextEpoch;
      nextTracker.activeServiceIds = allActiveServices; 
    } else {
      // Case B: Some services already staked for next epoch; merge with currently active
      let existingNextServices = nextTracker.activeServiceIds;
      let existingServiceIdSet = new Map<string, boolean>();

      for (let i = 0; i < existingNextServices.length; i++) {
        existingServiceIdSet.set(existingNextServices[i].toString(), true);
      }

      for (let i = 0; i < allActiveServices.length; i++) {
        let id = allActiveServices[i];
        let idStr = id.toString();
        if (!existingServiceIdSet.has(idStr)) {
          existingNextServices.push(id);
          existingServiceIdSet.set(idStr, true);
        }
      }
      nextTracker.activeServiceIds = existingNextServices;
    }
    
    nextTracker.blockNumber = event.block.number;
    nextTracker.blockTimestamp = event.block.timestamp;
    nextTracker.save();
  }

  // 4. Update Global states and rewards
  let global = getOrCreateGlobal();
  global.totalRewards = global.totalRewards.plus(totalRewards);
  global.save();

  upsertCumulativeDailyStakingGlobal(event, global.totalRewards);

  createRewardUpdate(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString(),
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
    "Claimable",
    totalRewards
  );
}

export function handleDeposit(event: DepositEvent): void {
  let entity = new Deposit(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.sender = event.params.sender
  entity.amount = event.params.amount
  entity.balance = event.params.balance
  entity.availableRewards = event.params.availableRewards

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleRewardClaimed(event: RewardClaimedEvent): void {
  let entity = new RewardClaimed(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.epoch = event.params.epoch
  entity.serviceId = event.params.serviceId
  entity.owner = event.params.owner
  entity.multisig = event.params.multisig
  entity.nonces = event.params.nonces
  entity.reward = event.params.reward

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  // Update service claimed rewards
  let service = Service.load(event.params.serviceId.toString());
  if (service !== null) {
    service.olasRewardsClaimed = service.olasRewardsClaimed.plus(event.params.reward);
    service.save();
  }

  // Update claimed staking rewards
  createRewardUpdate(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString(),
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
    "Claimed",
    event.params.reward
  );
}

export function handleServiceForceUnstaked(
  event: ServiceForceUnstakedEvent,
): void {
  let entity = new ServiceForceUnstaked(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.epoch = event.params.epoch
  entity.serviceId = event.params.serviceId
  entity.owner = event.params.owner
  entity.multisig = event.params.multisig
  entity.nonces = event.params.nonces
  entity.reward = event.params.reward
  entity.availableRewards = event.params.availableRewards

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  processUnstake(
    event,
    event.params.serviceId,
    event.params.epoch,
    event.params.reward,
    event.address
  );
}

export function handleServiceInactivityWarning(
  event: ServiceInactivityWarningEvent,
): void {
  let entity = new ServiceInactivityWarning(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.epoch = event.params.epoch
  entity.serviceId = event.params.serviceId
  entity.serviceInactivity = event.params.serviceInactivity

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleServiceStaked(event: ServiceStakedEvent): void {
  let entity = new ServiceStaked(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.epoch = event.params.epoch
  entity.serviceId = event.params.serviceId
  entity.owner = event.params.owner
  entity.multisig = event.params.multisig
  entity.nonces = event.params.nonces

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  // Update service
  let service = Service.load(event.params.serviceId.toString());
  if (service === null) {
    service = new Service(event.params.serviceId.toString())
    service.blockNumber = event.block.number;
    service.blockTimestamp = event.block.timestamp;
    service.currentOlasStaked = BigInt.fromI32(0);
    service.olasRewardsEarned = BigInt.fromI32(0);
    service.olasRewardsClaimed = BigInt.fromI32(0);
    service.global = getOrCreateGlobal().id;
    service.totalEpochsParticipated = 0;
    service.latestStakingContract = null;
  }

  const olasForStaking = getOlasForStaking(event.params._event.address)
  service.currentOlasStaked = service.currentOlasStaked.plus(olasForStaking);

  // Track latest staking contract
  service.latestStakingContract = event.address;
  service.save()

  // Track active services for this epoch
  let activeKey = event.address.toHexString() + "-" + event.params.epoch.toString();
  let activeTracker = ActiveServiceEpoch.load(activeKey);
  if (activeTracker === null) {
    activeTracker = new ActiveServiceEpoch(activeKey);
    activeTracker.contractAddress = event.address;
    activeTracker.epoch = event.params.epoch;
    activeTracker.activeServiceIds = [];
    activeTracker.blockNumber = event.block.number;
    activeTracker.blockTimestamp = event.block.timestamp;
  }

  // Add service to active list if not present
  let serviceIds = activeTracker.activeServiceIds;
  if (serviceIds.indexOf(event.params.serviceId) === -1) {
    serviceIds.push(event.params.serviceId);
    activeTracker.activeServiceIds = serviceIds;
  }
  activeTracker.save();

  // Create epoch history record
  let history = getOrCreateServiceRewardsHistory(
    event.params.serviceId,
    event.address,
    event.params.epoch,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash
  );
  history.save();

  // Update global
  let global = getOrCreateGlobal();
  global.cumulativeOlasStaked = global.cumulativeOlasStaked.plus(olasForStaking)
  global.currentOlasStaked = global.currentOlasStaked.plus(olasForStaking)
  global.save()
}

export function handleServiceUnstaked(event: ServiceUnstakedEvent): void {
  let entity = new ServiceUnstaked(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.epoch = event.params.epoch
  entity.serviceId = event.params.serviceId
  entity.owner = event.params.owner
  entity.multisig = event.params.multisig
  entity.nonces = event.params.nonces
  entity.reward = event.params.reward
  entity.availableRewards = event.params.availableRewards

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  // Update claimed staking rewards
  createRewardUpdate(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString(),
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
    "Claimed",
    event.params.reward
  );

  processUnstake(
    event,
    event.params.serviceId,
    event.params.epoch,
    event.params.reward,
    event.address
  );
}

export function handleServicesEvicted(event: ServicesEvictedEvent): void {
  let entity = new ServicesEvicted(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )

  let owners: Bytes[] = event.params.owners.map<Bytes>(
    (owner: Address): Bytes => owner as Bytes
  );
  let multisigs: Bytes[] = event.params.multisigs.map<Bytes>(
    (multisig: Address): Bytes => multisig as Bytes
  );

  entity.epoch = event.params.epoch
  entity.serviceIds = event.params.serviceIds 
  entity.owners = owners
  entity.multisigs = multisigs
  entity.serviceInactivity = event.params.serviceInactivity

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

}

export function handleWithdraw(event: WithdrawEvent): void {
  let entity = new Withdraw(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  entity.to = event.params.to
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
