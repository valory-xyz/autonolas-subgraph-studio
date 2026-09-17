import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { ServiceRegistryL2 } from "../generated/templates/StakingProxy/ServiceRegistryL2";
import { ServiceRegistryTokenUtility } from "../generated/templates/StakingProxy/ServiceRegistryTokenUtility";
import {
  Global,
  RewardUpdate,
  CumulativeDailyStakingGlobal,
  Service,
  ServiceRewardsHistory,
  StakingContract,
} from "../generated/schema";

const ONE_DAY = BigInt.fromI32(86400);

export function createRewardUpdate(
  id: string,
  blockNumber: BigInt,
  blockTimestamp: BigInt,
  transactionHash: Bytes,
  type: string,
  amount: BigInt
): void {
  let rewardUpdate = new RewardUpdate(id);
  rewardUpdate.blockNumber = blockNumber;
  rewardUpdate.blockTimestamp = blockTimestamp;
  rewardUpdate.transactionHash = transactionHash;
  rewardUpdate.type = type;
  rewardUpdate.amount = amount;
  rewardUpdate.save();
}

/**
 * OLAS a service has locked: security deposit plus a bond per agent instance,
 * read from ServiceRegistryTokenUtility. Null when a read is unavailable.
 */
function readLockedOlas(
  stakingContract: StakingContract,
  serviceId: BigInt
): BigInt | null {
  const utilityAddress = stakingContract.serviceRegistryTokenUtility;
  if (utilityAddress === null) {
    return null;
  }

  const utility = ServiceRegistryTokenUtility.bind(
    Address.fromBytes(utilityAddress as Bytes)
  );
  const deposit = utility.try_mapServiceIdTokenDeposit(serviceId);
  if (deposit.reverted) {
    return null;
  }
  // value0 is the deposit token, value1 the security deposit
  let total = deposit.value.value1;

  const registry = ServiceRegistryL2.bind(
    Address.fromBytes(stakingContract.serviceRegistry)
  );
  const service = registry.try_getService(serviceId);
  const params = registry.try_getAgentParams(serviceId);
  if (service.reverted || params.reverted) {
    return null;
  }

  const agentIds = service.value.agentIds;
  const agentParams = params.value.value1;
  for (let i = 0; i < agentParams.length && i < agentIds.length; i++) {
    const bond = utility.try_getAgentBond(serviceId, agentIds[i]);
    if (bond.reverted) {
      return null;
    }
    total = total.plus(agentParams[i].slots.times(bond.value));
  }

  return total;
}

/**
 * Stake amount for a service: the amount locked on-chain, falling back to the
 * staking contract's parameters when that read is unavailable.
 */
export function getOlasForStaking(address: Address, serviceId: BigInt): BigInt {
  const stakingContract = StakingContract.load(address);
  if (stakingContract === null) {
    return BigInt.zero();
  }

  // Non-OLAS deposits stay out of the OLAS totals
  if (!stakingContract.isOlasStaking) {
    return BigInt.zero();
  }

  const locked = readLockedOlas(stakingContract, serviceId);
  if (locked !== null) {
    return locked as BigInt;
  }

  return stakingContract.minStakingDeposit.times(
    stakingContract.numAgentInstances.plus(BigInt.fromI32(1))
  );
}

export function getOrCreateGlobal(): Global {
  let global = Global.load("");
  if (global == null) {
    global = new Global("");
    global.cumulativeOlasStaked = BigInt.fromI32(0);
    global.cumulativeOlasUnstaked = BigInt.fromI32(0);
    global.currentOlasStaked = BigInt.fromI32(0);
    global.totalRewards = BigInt.fromI32(0);
    global.totalRewardsClaimed = BigInt.fromI32(0);
    global.lastActiveDayTimestamp = BigInt.fromI32(0);
  }
  return global;
}

export function getDayTimestamp(timestamp: BigInt): BigInt {
  return timestamp.div(ONE_DAY).times(ONE_DAY);
}

/**
 * Get or create a daily global snapshot with forward-filling.
 * Uses the lastActiveDayTimestamp from Global to instantly find the most recent
 * active day for forward-filling, ensuring population continuity.
 */
export function getOrCreateCumulativeDailyStakingGlobal(
  event: ethereum.Event
): CumulativeDailyStakingGlobal {
  const dayTimestamp = getDayTimestamp(event.block.timestamp);
  const id = Bytes.fromUTF8(dayTimestamp.toString());
  let snapshot = CumulativeDailyStakingGlobal.load(id);
  if (snapshot == null) {
    const global = getOrCreateGlobal();

    snapshot = new CumulativeDailyStakingGlobal(id);
    snapshot.timestamp = dayTimestamp;
    // Carry the running cumulative totals forward; callers overwrite their own.
    snapshot.totalRewards = global.totalRewards;
    snapshot.totalRewardsClaimed = global.totalRewardsClaimed;
    snapshot.numServices = 0;
    snapshot.medianCumulativeRewards = BigInt.fromI32(0);

    // Use the last active day timestamp from Global for instant forward-filling
    if (!global.lastActiveDayTimestamp.isZero()) {
      const referenceId = Bytes.fromUTF8(
        global.lastActiveDayTimestamp.toString()
      );
      const referenceSnapshot = CumulativeDailyStakingGlobal.load(referenceId);
      if (referenceSnapshot != null) {
        // Copy metadata from the most recent active day for continuity
        snapshot.numServices = referenceSnapshot.numServices;
        snapshot.medianCumulativeRewards =
          referenceSnapshot.medianCumulativeRewards;
      }
    }
  }
  return snapshot;
}

/**
 * Upsert a daily global snapshot with the latest total rewards, median, and service count.
 * Updates the Global entity's lastActiveDayTimestamp for efficient forward-filling.
 * Saves the snapshot before returning.
 */
export function upsertCumulativeDailyStakingGlobal(
  event: ethereum.Event,
  totalRewards: BigInt
): CumulativeDailyStakingGlobal {
  const snapshot = getOrCreateCumulativeDailyStakingGlobal(event);
  snapshot.block = event.block.number;
  snapshot.totalRewards = totalRewards;

  // Compute median from ALL services in the system
  snapshot.medianCumulativeRewards = computeMedianOfAllServices();

  // Update service count
  const global = getOrCreateGlobal();
  snapshot.totalRewardsClaimed = global.totalRewardsClaimed;
  snapshot.numServices = global.services.load().length;

  // Update Global to track this as the most recent active day for future forward-filling
  global.lastActiveDayTimestamp = snapshot.timestamp;
  global.save();

  // Save the complete snapshot
  snapshot.save();

  return snapshot;
}

/**
 * Adds a payout to the Global accumulator and today's snapshot. Skips the
 * median and service-count recompute, which only change on a checkpoint.
 */
export function recordRewardsClaimed(
  event: ethereum.Event,
  reward: BigInt
): void {
  const global = getOrCreateGlobal();
  global.totalRewardsClaimed = global.totalRewardsClaimed.plus(reward);
  global.save();

  const snapshot = getOrCreateCumulativeDailyStakingGlobal(event);
  snapshot.block = event.block.number;
  snapshot.totalRewardsClaimed = global.totalRewardsClaimed;
  snapshot.save();
}

/**
 * Compute the median of cumulative rewards from ALL Service entities in the system.
 * This gives us the true ecosystem median representing all services' reward levels.
 * Returns 0 if no services exist.
 */
export function computeMedianOfAllServices(): BigInt {
  const global = getOrCreateGlobal();
  const allServices = global.services.load();

  if (allServices.length == 0) {
    return BigInt.fromI32(0);
  }

  // Extract current cumulative rewards from each service entity
  const rewards = new Array<BigInt>();
  for (let i = 0; i < allServices.length; i++) {
    rewards.push(allServices[i].olasRewardsEarned);
  }

  if (rewards.length == 0) {
    return BigInt.fromI32(0);
  }

  // Sort rewards in ascending order (smallest to largest)
  rewards.sort((firstReward: BigInt, secondReward: BigInt) => {
    if (firstReward.lt(secondReward)) {
      return -1;
    } else if (firstReward.gt(secondReward)) {
      return 1;
    } else {
      return 0;
    }
  });

  const n = rewards.length;
  const mid = n / 2;

  // If odd length, return middle element; if even, average the two middle elements
  if (n % 2 === 1) {
    return rewards[mid];
  }
  return rewards[mid - 1].plus(rewards[mid]).div(BigInt.fromI32(2));
}

export function getOrCreateServiceRewardsHistory(
  serviceId: BigInt,
  contractAddress: Bytes,
  epoch: BigInt,
  blockNumber: BigInt,
  blockTimestamp: BigInt,
  transactionHash: Bytes
): ServiceRewardsHistory {
  let historyId = serviceId.toString() + "-"
                  + contractAddress.toHexString() + "-"
                  + epoch.toString();

  let history = ServiceRewardsHistory.load(historyId);
  if (history === null) {
    history = new ServiceRewardsHistory(historyId);
    history.service = serviceId.toString();
    history.epoch = epoch;
    history.contractAddress = contractAddress;
    history.checkpoint = null;
    history.rewardAmount = BigInt.fromI32(0);
    history.checkpointedAt = null;
    history.blockNumber = blockNumber;
    history.blockTimestamp = blockTimestamp;
    history.transactionHash = transactionHash;

    let service = Service.load(serviceId.toString());
    if (service !== null) {
      service.totalEpochsParticipated = service.totalEpochsParticipated + 1;
      service.save();
    }
  }

  return history;
}

export function processUnstake(
  event: ethereum.Event,
  serviceId: BigInt,
  epoch: BigInt,
  reward: BigInt,
  contractAddress: Address
): void {
  let serviceIdStr = serviceId.toString();

  // Release exactly what was recorded on stake, so the totals cannot drift
  let service = Service.load(serviceIdStr);
  const olasForStaking =
    service === null ? BigInt.zero() : service.currentStakeAmount;

  // 1. Update service
  if (service !== null) {
    service.latestStakingContract = null;
    service.olasRewardsClaimed = service.olasRewardsClaimed.plus(reward);
    service.currentOlasStaked = service.currentOlasStaked.minus(olasForStaking);
    service.currentStakeAmount = BigInt.zero();
    service.save();
  }

  // 2. Close the history for this epoch
  let history = getOrCreateServiceRewardsHistory(
    serviceId,
    contractAddress,
    epoch,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash
  );
  history.rewardAmount = reward;
  history.save();

  // 4. Update Global
  let global = getOrCreateGlobal();
  global.cumulativeOlasUnstaked = global.cumulativeOlasUnstaked.plus(olasForStaking);
  global.currentOlasStaked = global.currentOlasStaked.minus(olasForStaking);
  global.save();

  // 5. The accrued reward is paid out, so it counts as claimed
  recordRewardsClaimed(event, reward);
}