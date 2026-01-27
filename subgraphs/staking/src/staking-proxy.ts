import { Address, Bytes, BigInt } from "@graphprotocol/graph-ts"
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
import { createRewardUpdate, getOrCreateGlobal, getOlasForStaking, upsertCumulativeDailyStakingGlobal, getOrCreateServiceRewardsHistory } from "./utils"

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
  let totalRewards = BigInt.fromI32(0);

  if (activeTracker !== null) {
    let allActiveServices = activeTracker.activeServiceIds;
    let rewardedServices = event.params.serviceIds;
    let rewardedAmounts = event.params.rewards;

    // 1. Create a Lookup Map for rewarded services
    let rewardedMap = new Map<string, BigInt>();
    for (let i = 0; i < rewardedServices.length; i++) {
      rewardedMap.set(rewardedServices[i].toString(), rewardedAmounts[i]);
    }

    // 2. Process every service that was active this epoch
    for (let i = 0; i < allActiveServices.length; i++) {
      let serviceId = allActiveServices[i];
      let serviceIdStr = serviceId.toString();
      
      let history = getOrCreateServiceRewardsHistory(
        serviceId,
        event.address,
        event.params.epoch,
        event.block.number,
        event.block.timestamp,
        event.transaction.hash
      );

      // Check if this specific service earned rewards
      if (rewardedMap.has(serviceIdStr)) {
        let reward = rewardedMap.get(serviceIdStr);
        history.rewardAmount = reward;
        totalRewards = totalRewards.plus(reward);

        // Update the Service entity cumulative earnings
        let service = Service.load(serviceIdStr);
        if (service !== null) {
          service.olasRewardsEarned = service.olasRewardsEarned.plus(reward);
          service.save();
        }
      } else {
        // Service was active but did NOT meet KPI
        history.rewardAmount = BigInt.fromI32(0);
      }

      history.checkpoint = entity.id;
      history.checkpointedAt = event.block.timestamp;
      history.save();
    }

    // 3. Carry forward active services to the next epoch tracker
    let nextEpoch = event.params.epoch.plus(BigInt.fromI32(1));
    let nextKey = event.address.toHexString() + "-" + nextEpoch.toString();
    let nextTracker = new ActiveServiceEpoch(nextKey);
    nextTracker.contractAddress = event.address;
    nextTracker.epoch = nextEpoch;
    nextTracker.activeServiceIds = allActiveServices; 
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

  const olasForStaking = getOlasForStaking(event.params._event.address)
  // Update service
  let service = Service.load(event.params.serviceId.toString());
  if (service !== null) {
    service.latestStakingContract = null;
    service.olasRewardsClaimed = service.olasRewardsClaimed.plus(event.params.reward);
    service.currentOlasStaked = service.currentOlasStaked.minus(olasForStaking);
    service.save()
  }

  // Remove from active services
  let activeKey = event.address.toHexString() + "-" + event.params.epoch.toString();
  let activeTracker = ActiveServiceEpoch.load(activeKey);
  if (activeTracker !== null) {
    let serviceIds = activeTracker.activeServiceIds;
    let index = serviceIds.indexOf(event.params.serviceId);
    if (index !== -1) {
      let newIds: BigInt[] = [];
      for (let i = 0; i < serviceIds.length; i++) {
        if (i !== index) newIds.push(serviceIds[i]);
      }
      activeTracker.activeServiceIds = newIds;
      activeTracker.save();
    }
  }

  // Update global
  let global = getOrCreateGlobal();
  global.cumulativeOlasUnstaked = global.cumulativeOlasUnstaked.plus(olasForStaking);
  global.currentOlasStaked = global.currentOlasStaked.minus(olasForStaking);
  global.save();
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

  const olasForStaking = getOlasForStaking(event.params._event.address)

  // Update service
  let service = Service.load(event.params.serviceId.toString());
  if (service !== null) {
    service.latestStakingContract = null;
    service.olasRewardsClaimed = service.olasRewardsClaimed.plus(event.params.reward);
    service.currentOlasStaked = service.currentOlasStaked.minus(olasForStaking);
    service.save()
  }

  // Remove from active services
  let activeKey = event.address.toHexString() + "-" + event.params.epoch.toString();
  let activeTracker = ActiveServiceEpoch.load(activeKey);
  if (activeTracker !== null) {
    let serviceIds = activeTracker.activeServiceIds;
    let index = serviceIds.indexOf(event.params.serviceId);
    if (index !== -1) {
      let newIds: BigInt[] = [];
      for (let i = 0; i < serviceIds.length; i++) {
        if (i !== index) newIds.push(serviceIds[i]);
      }
      activeTracker.activeServiceIds = newIds;
      activeTracker.save();
    }
  }

  // Update global
  let global = getOrCreateGlobal();
  global.cumulativeOlasUnstaked = global.cumulativeOlasUnstaked.plus(olasForStaking);
  global.currentOlasStaked = global.currentOlasStaked.minus(olasForStaking);
  global.save();
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

  // --- Logic to stop tracking rewards for evicted services ---
  let activeKey = event.address.toHexString() + "-" + event.params.epoch.toString();
  let activeTracker = ActiveServiceEpoch.load(activeKey);
  
  if (activeTracker !== null) {
    let currentActiveIds = activeTracker.activeServiceIds;
    let evictedIds = event.params.serviceIds;
    
    // Create a new array to hold the services that remain active
    let nextActiveIds: BigInt[] = [];
    
    for (let i = 0; i < currentActiveIds.length; i++) {
      let id = currentActiveIds[i];
      // Only keep the service if it is NOT in the evicted list
      if (!evictedIds.includes(id)) {
        nextActiveIds.push(id);
      }
    }
    
    activeTracker.activeServiceIds = nextActiveIds;
    activeTracker.save();
  }
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
