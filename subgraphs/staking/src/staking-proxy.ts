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
  Withdraw
} from "../generated/schema"
import { createRewardUpdate, getGlobal, getOlasForStaking } from "./utils"

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

  let totalRewards = BigInt.fromI32(0);
  for (let i = 0; i < event.params.rewards.length; i++) {
    // Calculate total rewards for this checkpoint
    totalRewards = totalRewards.plus(event.params.rewards[i]);

    // and update each service cumulative rewards
    let service = Service.load(event.params.serviceIds[i].toString());
    if (service !== null) {
      service.olasRewardsEarned = service.olasRewardsEarned.plus(
        event.params.rewards[i]
      );
      service.save();
    }
  }

  // Update claimable staking rewards
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
    service.currentOlasStaked = service.currentOlasStaked.minus(olasForStaking);
    service.save()
  }

  // Update global
  let global = getGlobal();
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
  }

  const olasForStaking = getOlasForStaking(event.params._event.address)
  service.currentOlasStaked = service.currentOlasStaked.plus(olasForStaking);
  service.save()

  // Update global
  let global = getGlobal();
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
    service.currentOlasStaked = service.currentOlasStaked.minus(olasForStaking);
    service.save()
  }

  // Update global
  let global = getGlobal();
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
