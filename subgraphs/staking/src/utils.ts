import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Global, RewardUpdate, DailyStakingGlobal } from "../generated/schema";
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


export function getGlobal(): Global {
  let global = Global.load('');
  if (global == null) {
    global = new Global('');
    global.cumulativeOlasStaked = BigInt.fromI32(0);
    global.cumulativeOlasUnstaked = BigInt.fromI32(0);
    global.currentOlasStaked = BigInt.fromI32(0);
    global.totalRewards = BigInt.fromI32(0);
  }
  return global;
}


export function getDayTimestamp(timestamp: BigInt): BigInt {
  return timestamp.div(ONE_DAY).times(ONE_DAY);
}

export function getOrCreateDailyStakingGlobal(event: ethereum.Event): DailyStakingGlobal {
  const dayTimestamp = getDayTimestamp(event.block.timestamp);
  const id = Bytes.fromUTF8(dayTimestamp.toString());
  let snapshot = DailyStakingGlobal.load(id);
  if (snapshot == null) {
    snapshot = new DailyStakingGlobal(id);
    snapshot.timestamp = dayTimestamp;
    // forward-fill arrays from previous day if present
    const prevId = Bytes.fromUTF8(dayTimestamp.minus(ONE_DAY).toString());
    const prev = DailyStakingGlobal.load(prevId);
    if (prev != null) {
      snapshot.serviceIds = prev.serviceIds;
      snapshot.cumulativeRewards = prev.cumulativeRewards;
      snapshot.numServices = prev.numServices;
      snapshot.medianCumulativeRewards = prev.medianCumulativeRewards;
    } else {
      snapshot.serviceIds = new Array<BigInt>();
      snapshot.cumulativeRewards = new Array<BigInt>();
      snapshot.numServices = 0;
      snapshot.medianCumulativeRewards = BigInt.fromI32(0);
    }
  }
  return snapshot;
}

export function upsertDailyStakingGlobal(event: ethereum.Event, totalRewards: BigInt): DailyStakingGlobal {
  const snapshot = getOrCreateDailyStakingGlobal(event)
  snapshot.block = event.block.number
  snapshot.totalRewards = totalRewards
  return snapshot
}

// Helpers to maintain sorted cumulativeRewards with paired serviceIds
function findIndex(serviceIds: BigInt[], target: BigInt): i32 {
  for (let i = 0; i < serviceIds.length; i++) {
    if (serviceIds[i].equals(target)) return i as i32;
  }
  return -1;
}

function swapParallel(values: BigInt[], ids: BigInt[], i: i32, j: i32): void {
  const v = values[i];
  values[i] = values[j];
  values[j] = v;
  const s = ids[i];
  ids[i] = ids[j];
  ids[j] = s;
}

function moveLeftUntilSorted(values: BigInt[], ids: BigInt[], startIndex: i32): void {
  let index = startIndex;
  while (index > 0 && values[index].lt(values[index - 1])) {
    swapParallel(values, ids, index, index - 1);
    index -= 1;
  }
}

function moveRightUntilSorted(values: BigInt[], ids: BigInt[], startIndex: i32): void {
  let index = startIndex;
  const length = values.length;
  while (index + 1 < length && values[index].gt(values[index + 1])) {
    swapParallel(values, ids, index, index + 1);
    index += 1;
  }
}

export function upsertServiceValue(snapshot: DailyStakingGlobal, serviceId: BigInt, newValue: BigInt): void {
  const serviceIds = snapshot.serviceIds;
  const rewardTotals = snapshot.cumulativeRewards;

  const existingIndex = findIndex(serviceIds, serviceId);
  if (existingIndex >= 0) {
    const previousValue = rewardTotals[existingIndex];
    if (previousValue.equals(newValue)) return;
    if (newValue.lt(previousValue)) return;
    rewardTotals[existingIndex] = newValue;
    moveRightUntilSorted(rewardTotals, serviceIds, existingIndex);
    snapshot.cumulativeRewards = rewardTotals;
    snapshot.serviceIds = serviceIds;
    return;
  }

  serviceIds.push(serviceId);
  rewardTotals.push(newValue);
  const appendedIndex = (rewardTotals.length - 1) as i32;
  moveLeftUntilSorted(rewardTotals, serviceIds, appendedIndex);

  snapshot.serviceIds = serviceIds;
  snapshot.cumulativeRewards = rewardTotals;
}

export function computeMedianSorted(values: BigInt[]): BigInt {
  const n = values.length;
  if (n == 0) return BigInt.fromI32(0);
  const mid = n / 2;
  // If n is odd, return the middle element (array is sorted)
  if (n % 2 === 1) {
    return values[mid];
  }
  return values[mid - 1].plus(values[mid]).div(BigInt.fromI32(2));
}
