import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Global, RewardUpdate, CumulativeDailyStakingGlobal, Service } from "../generated/schema";
import { StakingProxy as StakingProxyContract } from "../generated/templates/StakingProxy/StakingProxy";

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

export function getOlasForStaking(address: Address): BigInt {
  const contract = StakingProxyContract.bind(address);
  const numAgentInstances = contract.numAgentInstances();
  const minStakingDeposit = contract.minStakingDeposit();
  const stakeAmount = minStakingDeposit.times(numAgentInstances.plus(BigInt.fromI32(1)));

  return stakeAmount;
}


/**
 * Get or create the global staking entity (singleton).
 * Initializes all fields to zero on first access.
 */
export function getOrCreateGlobal(): Global {
  let global = Global.load('');
  if (global == null) {
    global = new Global('');
    global.cumulativeOlasStaked = BigInt.fromI32(0);
    global.cumulativeOlasUnstaked = BigInt.fromI32(0);
    global.currentOlasStaked = BigInt.fromI32(0);
    global.totalRewards = BigInt.fromI32(0);
    global.lastActiveDayTimestamp = BigInt.fromI32(0);
  }
  return global;
}


export function getDayTimestamp(timestamp: BigInt): BigInt {
  return timestamp.div(ONE_DAY).times(ONE_DAY);
}

/**
 * Get or create a daily global snapshot with efficient forward-filling.
 * Uses the lastActiveDayTimestamp from Global to instantly find the most recent
 * active day for forward-filling, ensuring population continuity.
 */
export function getOrCreateCumulativeDailyStakingGlobal(event: ethereum.Event): CumulativeDailyStakingGlobal {
  const dayTimestamp = getDayTimestamp(event.block.timestamp);
  const id = Bytes.fromUTF8(dayTimestamp.toString());
  let snapshot = CumulativeDailyStakingGlobal.load(id);
  if (snapshot == null) {
    snapshot = new CumulativeDailyStakingGlobal(id);
    snapshot.timestamp = dayTimestamp;
    snapshot.totalRewards = BigInt.fromI32(0);
    snapshot.numServices = 0;
    snapshot.medianCumulativeRewards = BigInt.fromI32(0);

    // Use the last active day timestamp from Global for instant forward-filling
    const global = getOrCreateGlobal();
    if (!global.lastActiveDayTimestamp.isZero()) {
      const referenceId = Bytes.fromUTF8(global.lastActiveDayTimestamp.toString());
      const referenceSnapshot = CumulativeDailyStakingGlobal.load(referenceId);
      if (referenceSnapshot != null) {
        // Copy metadata from the most recent active day for continuity
        snapshot.numServices = referenceSnapshot.numServices;
        snapshot.medianCumulativeRewards = referenceSnapshot.medianCumulativeRewards;
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
export function upsertCumulativeDailyStakingGlobal(event: ethereum.Event, totalRewards: BigInt): CumulativeDailyStakingGlobal {
  const snapshot = getOrCreateCumulativeDailyStakingGlobal(event);
  snapshot.block = event.block.number;
  snapshot.totalRewards = totalRewards;

  // Compute median from ALL services in the system
  snapshot.medianCumulativeRewards = computeMedianOfAllServices();
  
  // Update service count
  const global = getOrCreateGlobal();
  snapshot.numServices = global.services.load().length;

  // Update Global to track this as the most recent active day for future forward-filling
  global.lastActiveDayTimestamp = snapshot.timestamp;
  global.save();

  // Save the complete snapshot
  snapshot.save();

  return snapshot;
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
