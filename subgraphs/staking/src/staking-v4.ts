import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import * as V4 from '../generated/templates/StakingProxyV4/StakingTokenV4';
import * as Legacy from '../generated/templates/StakingProxy/StakingProxy';
import { ServiceUnstakedV4, ServicesRebaselined, ServiceBaselineEvent, ServiceBaselineState } from '../generated/schema';
import * as legacy from './staking-proxy';
import { processUnstake } from './utils';

function baselineKey(event: ethereum.Event, serviceId: BigInt): string {
  return event.address.toHexString() + '-' + serviceId.toString();
}
function setBaseline(event: ethereum.Event, serviceId: BigInt, epoch: BigInt, missing: boolean): void {
  let row = new ServiceBaselineState(baselineKey(event, serviceId));
  row.serviceId = serviceId;
  row.contractAddress = event.address;
  row.baselineMissing = missing;
  row.epoch = epoch;
  row.save();
}
export function handleServiceStaked(event: V4.ServiceStaked): void {
  // The first five fields match legacy. Use the emitted epoch unchanged, including
  // the extra checkpoint increment on the first stake after refill.
  legacy.processServiceStaked(changetype<Legacy.ServiceStaked>(event), event.params.rewardDistributionInfo);
  setBaseline(event, event.params.serviceId, event.params.epoch, false);
}
export function handleRewardClaimed(event: V4.RewardClaimed): void {
  let amounts = event.params.rewardAmounts;
  let addresses = event.params.receivers;
  assert(addresses.length == amounts.length, 'Reward recipient/amount length mismatch');
  let total = BigInt.zero();
  let receivers = new Array<Bytes>();
  for (let i = 0; i < amounts.length; i++) {
    total = total.plus(amounts[i]);
    receivers.push(addresses[i]);
  }
  // Normalize only for shared accounting; retain the actual recipient arrays.
  let normalized = changetype<Legacy.RewardClaimed>(new ethereum.Event(event.address, event.logIndex, event.transactionLogIndex, event.logType, event.block, event.transaction, event.parameters, event.receipt));
  normalized.address = event.address;
  normalized.block = event.block;
  normalized.transaction = event.transaction;
  normalized.logIndex = event.logIndex;
  normalized.parameters = event.parameters.slice(0, 5);
  normalized.parameters.push(new ethereum.EventParam('reward', ethereum.Value.fromUnsignedBigInt(total)));
  legacy.processRewardClaimed(normalized, receivers, amounts);
}
export function handleServiceUnstaked(event: V4.ServiceUnstaked): void {
  let row = new ServiceUnstakedV4(event.transaction.hash.concatI32(event.logIndex.toI32()));
  row.epoch = event.params.epoch;
  row.serviceId = event.params.serviceId;
  row.owner = event.params.owner;
  row.multisig = event.params.multisig;
  row.nonces = event.params.nonces;
  row.availableRewards = event.params.availableRewards;
  row.enforced = event.params.enforced;
  row.contractAddress = event.address;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();
  // RewardClaimed is the sole payout record, including normal unstaking. Forced
  // returns have no amount in this event; do not invent a payout or overwrite earnings.
  processUnstake(event, event.params.serviceId, event.params.epoch, BigInt.zero(), event.address, false, false);
  setBaseline(event, event.params.serviceId, event.params.epoch, false);
}
export function handleServicesRebaselined(event: V4.ServicesRebaselined): void {
  let row = new ServicesRebaselined(event.address.toHexString() + '-' + event.params.epoch.toString());
  row.epoch = event.params.epoch;
  row.contractAddress = event.address;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();
}
export function handleCheckpoint(event: V4.Checkpoint): void {
  let marker = ServicesRebaselined.load(event.address.toHexString() + '-' + event.params.epoch.toString());
  let isRebaseline = marker !== null;
  if (isRebaseline) assert(event.params.serviceIds.length == 0 && event.params.rewards.length == 0, 'Rebaseline cannot allocate rewards');
  legacy.processCheckpoint(changetype<Legacy.Checkpoint>(event), isRebaseline);
}
function baselineEvent(event: ethereum.Event, epoch: BigInt, serviceId: BigInt, missing: boolean): void {
  let row = new ServiceBaselineEvent(event.transaction.hash.concatI32(event.logIndex.toI32()));
  row.epoch = epoch;
  row.serviceId = serviceId;
  row.kind = missing ? 'Missing' : 'Recovered';
  row.contractAddress = event.address;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();
  setBaseline(event, serviceId, epoch, missing);
}
export function handleServiceBaselineMissing(event: V4.ServiceBaselineMissing): void {
  baselineEvent(event, event.params.epoch, event.params.serviceId, true);
}
export function handleServiceBaselineRecovered(event: V4.ServiceBaselineRecovered): void {
  baselineEvent(event, event.params.epoch, event.params.serviceId, false);
}
// These event layouts are unchanged in v0.4.
export function handleDeposit(event: V4.Deposit): void { legacy.handleDeposit(changetype<Legacy.Deposit>(event)); }
export function handleWithdraw(event: V4.Withdraw): void { legacy.handleWithdraw(changetype<Legacy.Withdraw>(event)); }
export function handleServicesEvicted(event: V4.ServicesEvicted): void { legacy.handleServicesEvicted(changetype<Legacy.ServicesEvicted>(event)); }
export function handleServiceInactivityWarning(event: V4.ServiceInactivityWarning): void { legacy.handleServiceInactivityWarning(changetype<Legacy.ServiceInactivityWarning>(event)); }
