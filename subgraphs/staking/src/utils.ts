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

export function upsertDailyStakingGlobal(event: ethereum.Event, totalRewards: BigInt): void {
  const dayTimestamp = getDayTimestamp(event.block.timestamp);
  const id = Bytes.fromUTF8(dayTimestamp.toString());
  let snapshot = DailyStakingGlobal.load(id);
  if (snapshot == null) {
    snapshot = new DailyStakingGlobal(id);
    snapshot.timestamp = dayTimestamp;
  }
  snapshot.block = event.block.number;
  snapshot.totalRewards = totalRewards;
  snapshot.save();
}
