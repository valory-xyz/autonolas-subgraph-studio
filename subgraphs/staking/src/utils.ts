import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Global, RewardUpdate } from "../generated/schema";
import { StakingProxy as StakingProxyContract } from "../generated/templates/StakingProxy/StakingProxy";

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
  }
  return global;
}
