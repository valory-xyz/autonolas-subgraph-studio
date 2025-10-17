import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Global, RewardUpdate, CumulativeDailyStakingGlobal, Service } from "../generated/schema";
import { StakingProxy as StakingProxyContract } from "../generated/templates/StakingProxy/StakingProxy";

export const SECONDS_PER_DAY = BigInt.fromI32(86400);
export const OPTIMUS_LAUNCH_TS = BigInt.fromI32(1717545600); // June 5, 2024 00:00:00 UTC

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



export function getOrCreateGlobal(): Global {
  let global = Global.load('');
  if (global == null) {
    global = new Global('');
    global.cumulativeOlasStaked = BigInt.fromI32(0);
    global.cumulativeOlasUnstaked = BigInt.fromI32(0);
    global.currentOlasStaked = BigInt.fromI32(0);
    global.totalRewards = BigInt.fromI32(0);
    global.minDailyPayout = BigInt.fromI32(0);
    global.lastActiveDayTimestamp = BigInt.fromI32(0);
  }
  return global;
}


export function getDayTimestamp(timestamp: BigInt): BigInt {
  return timestamp.div(SECONDS_PER_DAY).times(SECONDS_PER_DAY);
}

/**
 * Get or create a daily global snapshot with forward-filling.
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
    snapshot.numEligibleServices = 0;
    snapshot.medianCumulativeRewardsEligibleServices = BigInt.fromI32(0);

    // Use the last active day timestamp from Global for instant forward-filling
    const global = getOrCreateGlobal();
    if (!global.lastActiveDayTimestamp.isZero()) {
      const referenceId = Bytes.fromUTF8(global.lastActiveDayTimestamp.toString());
      const referenceSnapshot = CumulativeDailyStakingGlobal.load(referenceId);
      if (referenceSnapshot != null) {
        // Copy metadata from the most recent active day for continuity
        snapshot.numEligibleServices = referenceSnapshot.numEligibleServices;
        snapshot.medianCumulativeRewardsEligibleServices = referenceSnapshot.medianCumulativeRewardsEligibleServices;
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

  // Compute filtered median and service count
  const global = getOrCreateGlobal();
  const eligibleRewards = loadEligibleRewards(global);
  const numEligibleServices = eligibleRewards.length;

  snapshot.medianCumulativeRewardsEligibleServices = median(eligibleRewards);
  snapshot.numEligibleServices = numEligibleServices;

  // Update Global to track this as the most recent active day for future forward-filling
  global.lastActiveDayTimestamp = snapshot.timestamp;
  global.save();

  // Save the complete snapshot
  snapshot.save();

  return snapshot;
}


/**
 * Update the global minimum daily payout if the provided value is smaller.
 */
export function maybeUpdateMinDailyPayout(dailyPayout: BigInt): void {
  if (dailyPayout.le(BigInt.fromI32(0))) {
    return;
  }

  const global = getOrCreateGlobal();
  if (global.minDailyPayout.isZero() || dailyPayout.lt(global.minDailyPayout)) {
    global.minDailyPayout = dailyPayout;
    global.save();
  }
}


function median(values: Array<BigInt>): BigInt {
  if (values.length == 0) {
    return BigInt.fromI32(0);
  }

  // Sort the values in ascending order
  values.sort((a: BigInt, b: BigInt) => {
    if (a.lt(b)) {
      return -1;
    }
    if (a.gt(b)) {
      return 1;
    }
    return 0;
  });

  const n = values.length;
  const mid = n / 2;

  if (n % 2 == 1) {
    return values[mid];
  }

  return values[mid - 1].plus(values[mid]).div(BigInt.fromI32(2));
}


function loadEligibleRewards(global: Global): Array<BigInt> {
  const rewards = new Array<BigInt>();
  const services = global.services.load();
  const threshold = global.minDailyPayout;

  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    if (service == null) {
      continue;
    }

    if (!threshold.isZero() && service.olasRewardsEarnedSinceOptimus.lt(threshold)) {
      continue;
    }

    rewards.push(service.olasRewardsEarnedSinceOptimus);
  }

  return rewards;
}
