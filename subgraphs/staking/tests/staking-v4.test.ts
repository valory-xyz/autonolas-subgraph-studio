import {assert, test, beforeEach, afterEach, clearStore, newMockEvent, dataSourceMock} from 'matchstick-as/assembly/index';
import {Address, BigInt, Bytes, ethereum} from '@graphprotocol/graph-ts';
import * as V4 from '../generated/templates/StakingProxyV4/StakingTokenV4';
import {RewardClaimed} from '../generated/schema';
import * as h from '../src/staking-v4';
import {handleInstanceCreated} from '../src/staking-factory';
import {mockStakingProxyConfig, createInstanceCreatedEvent} from './staking-factory-utils';
import {createServiceStakedEvent, createCheckpointEvent, createRewardClaimedEvent, createServiceUnstakedEvent} from './staking-proxy-utils';
const contract = Address.fromString('0x0000000000000000000000000000000000000034');
const master = Address.fromString('0x0000000000000000000000000000000000000099');
const agentSafe = Address.fromString('0x0000000000000000000000000000000000000098');
const one = BigInt.fromI32(1);
let logCursor: i32 = 1;
let currentTx = Bytes.fromHexString('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
let currentTimestamp = BigInt.fromI32(1000);
function stamp(event: ethereum.Event): void {
  event.logIndex = BigInt.fromI32(logCursor++);
  event.transactionLogIndex = event.logIndex;
  event.transaction.hash = currentTx;
  event.block.number = currentTimestamp;
  event.block.timestamp = currentTimestamp;
}
function nextTransaction(): void {
  currentTx = Bytes.fromHexString('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  currentTimestamp = BigInt.fromI32(1100);
}

function stake(epoch: i32 = 1, serviceId: i32 = 1): V4.ServiceStaked {
  let e = changetype<V4.ServiceStaked>(createServiceStakedEvent(BigInt.fromI32(serviceId), BigInt.fromI32(epoch), contract));
  stamp(e);
  e.parameters.push(new ethereum.EventParam('rewardDistributionInfo', ethereum.Value.fromUnsignedBigInt(BigInt.zero())));
  h.handleServiceStaked(e);
  return e;
}
function checkpoint(epoch: i32, reward: i32 = 0): V4.Checkpoint {
  let ids: BigInt[] = reward > 0 ? [one] : [];
  let amounts: BigInt[] = reward > 0 ? [BigInt.fromI32(reward)] : [];
  let e = changetype<V4.Checkpoint>(createCheckpointEvent(BigInt.fromI32(epoch), ids, amounts, contract));
  stamp(e); h.handleCheckpoint(e);
  return e;
}
function rebaseline(epoch: i32): void {
  let e = changetype<V4.ServicesRebaselined>(newMockEvent());
  e.address = contract; stamp(e);
  e.parameters = [new ethereum.EventParam('epoch', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(epoch)))];
  h.handleServicesRebaselined(e);
}
function claim(amounts: BigInt[], recipients: Address[], epoch: i32 = 1): void {
  let e = changetype<V4.RewardClaimed>(createRewardClaimedEvent(one, BigInt.fromI32(epoch), BigInt.zero(), contract));
  stamp(e); e.parameters = e.parameters.slice(0, 5);
  e.parameters.push(new ethereum.EventParam('receivers', ethereum.Value.fromAddressArray(recipients)));
  e.parameters.push(new ethereum.EventParam('rewardAmounts', ethereum.Value.fromUnsignedBigIntArray(amounts)));
  h.handleRewardClaimed(e);
  let row = RewardClaimed.load(e.transaction.hash.concatI32(e.logIndex.toI32()))!;
  let total = BigInt.zero(); for (let i = 0; i < amounts.length; i++) total = total.plus(amounts[i]);
  assert.bigIntEquals(row.reward, total); assert.i32Equals(row.receivers!.length, recipients.length);
  assert.bytesEquals(row.receivers![0], recipients[0]);
}
function unstake(forced: boolean): void {
  let e = changetype<V4.ServiceUnstaked>(createServiceUnstakedEvent(one, BigInt.fromI32(2), BigInt.zero(), contract));
  stamp(e); e.parameters = e.parameters.slice(0, 5);
  e.parameters.push(new ethereum.EventParam('availableRewards', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(100))));
  e.parameters.push(new ethereum.EventParam('enforced', ethereum.Value.fromBoolean(forced)));
  h.handleServiceUnstaked(e);
}
function baseline(missing: boolean, epoch: i32): void {
  let e = newMockEvent(); e.address = contract; stamp(e);
  e.parameters = [new ethereum.EventParam('epoch', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(epoch))), new ethereum.EventParam('serviceId', ethereum.Value.fromUnsignedBigInt(one))];
  if (missing) h.handleServiceBaselineMissing(changetype<V4.ServiceBaselineMissing>(e));
  else h.handleServiceBaselineRecovered(changetype<V4.ServiceBaselineRecovered>(e));
}
beforeEach(() => {
  clearStore(); dataSourceMock.setNetwork('gnosis');
  logCursor = 1;
  currentTx = Bytes.fromHexString('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  currentTimestamp = BigInt.fromI32(1000);
  mockStakingProxyConfig(contract, ['serviceRegistryTokenUtility'], null, '0.4.0');
  handleInstanceCreated(createInstanceCreatedEvent(master, contract, contract));
});
afterEach(() => {clearStore(); dataSourceMock.resetValues();});
test('v0.4 recipient arrays and normal unstake count one payout and preserve earned rewards', () => {
  stake(); checkpoint(1, 100); claim([BigInt.fromI32(40), BigInt.fromI32(60)], [master, agentSafe], 2); unstake(false);
  assert.fieldEquals('Global', '', 'totalRewards', '100'); assert.fieldEquals('Global', '', 'totalRewardsClaimed', '100');
  assert.fieldEquals('Global', '', 'currentOlasStaked', '0'); assert.fieldEquals('Service', '1', 'olasRewardsClaimed', '100');
  assert.fieldEquals('ServiceRewardsHistory', '1-' + contract.toHexString() + '-1', 'rewardAmount', '100');
  assert.entityCount('ServiceUnstakedV4', 1); assert.entityCount('RewardClaimed', 1); assert.entityCount('RewardUpdate', 2);
});
test('a recipient array can pay the Master Safe directly without an Agent Safe sweep', () => {
  stake(); checkpoint(1, 50); claim([BigInt.fromI32(50)], [master], 2); assert.fieldEquals('Global', '', 'totalRewardsClaimed', '50');
});
test('forced unstake returns no payout and retains checkpoint earnings', () => {
  stake(); checkpoint(1, 100); unstake(true);
  assert.fieldEquals('Global', '', 'totalRewardsClaimed', '0'); assert.entityCount('RewardClaimed', 0);
  assert.fieldEquals('ServiceRewardsHistory', '1-' + contract.toHexString() + '-1', 'rewardAmount', '100');
});
test('rebaseline creates no claimable reward for the unmeasured gap', () => {
  stake(); rebaseline(1); checkpoint(1); assert.entityCount('RewardUpdate', 0);
  assert.fieldEquals('ServiceRewardsHistory', '1-' + contract.toHexString() + '-1', 'isRebaseline', 'true');
  checkpoint(2, 20); assert.fieldEquals('Global', '', 'totalRewards', '20');
});
test('first stake after empty-instance refill retains the emitted next epoch', () => {
  rebaseline(4); checkpoint(4); stake(5); checkpoint(5); assert.entityCount('ServiceRewardsHistory', 1);
  assert.fieldEquals('ServiceRewardsHistory', '1-' + contract.toHexString() + '-5', 'isRebaseline', 'false');
  assert.fieldEquals('ActiveServiceEpoch', contract.toHexString() + '-6', 'epoch', '6');
});
test('missing and recovered baselines earn no back-pay; later measured epochs can earn', () => {
  stake(); baseline(true, 1);
  assert.fieldEquals('ServiceBaselineState', contract.toHexString() + '-1', 'baselineMissing', 'true');
  checkpoint(1); baseline(false, 2); checkpoint(2);
  assert.fieldEquals('ServiceBaselineState', contract.toHexString() + '-1', 'baselineMissing', 'false');
  assert.fieldEquals('Global', '', 'totalRewards', '0'); checkpoint(3, 10); assert.fieldEquals('Global', '', 'totalRewards', '10');
  assert.entityCount('ServicesRebaselined', 0);
});

test('misaligned reward recipients and amounts are rejected', () => {
  stake(); claim([one], []);
}, true);

function combinedRefill(missing: boolean): void {
  stake();
  if (!missing) baseline(true, 1);
  checkpoint(1);
  assert.fieldEquals('Service', '1', 'totalEpochsParticipated', '1');
  // A later refill transaction resets existing services before admitting another.
  nextTransaction();
  baseline(missing, 2);
  rebaseline(2);
  let e = checkpoint(2);
  let checkpointId = e.transaction.hash.concatI32(e.logIndex.toI32());
  assert.fieldEquals('Checkpoint', checkpointId.toHexString(), 'isRebaseline', 'true');
  let historyId = '1-' + contract.toHexString() + '-2';
  assert.fieldEquals('ServiceRewardsHistory', historyId, 'checkpoint', checkpointId.toHexString());
  assert.fieldEquals('ServiceRewardsHistory', historyId, 'isRebaseline', 'true');
  assert.fieldEquals('ServiceRewardsHistory', historyId, 'rewardAmount', '0');
  assert.fieldEquals('ServiceRewardsHistory', historyId, 'blockTimestamp', '1100');
  assert.fieldEquals('ServiceBaselineState', contract.toHexString() + '-1', 'baselineMissing', missing ? 'true' : 'false');
  // The earlier ordinary checkpoint produced one update; the refill produces none.
  assert.entityCount('RewardUpdate', 1);
  assert.notInStore('RewardUpdate', e.transaction.hash.toHexString() + '-' + e.logIndex.toString());
  assert.fieldEquals('Service', '1', 'totalEpochsParticipated', '2');
  // The counter tracks unique history rows, including zero-reward baseline rows.
  let newStake = stake(3, 2);
  assert.fieldEquals('ServiceStaked', newStake.transaction.hash.concatI32(newStake.logIndex.toI32()).toHexString(), 'epoch', '3');
  assert.fieldEquals('Service', '1', 'totalEpochsParticipated', '2');
  assert.fieldEquals('Service', '2', 'totalEpochsParticipated', '1');
  assert.fieldEquals('ServiceRewardsHistory', '1-' + contract.toHexString() + '-1', 'isRebaseline', 'false');
  assert.fieldEquals('ServiceRewardsHistory', '1-' + contract.toHexString() + '-1', 'blockTimestamp', '1000');
  assert.fieldEquals('ServiceRewardsHistory', '1-' + contract.toHexString() + '-1', 'epoch', '1');
  assert.entityCount('ServiceRewardsHistory', 3);
  assert.entityCount('RewardUpdate', 1);
  assert.fieldEquals('Global', '', 'totalRewards', '0');
}
test('same-transaction missing, rebaseline, checkpoint and stake preserve epoch history and count', () => combinedRefill(true));
test('same-transaction recovery, rebaseline, checkpoint and stake preserve epoch history and count', () => combinedRefill(false));

function restakeAfterMissing(forced: boolean): void {
  stake();
  assert.fieldEquals('ServiceBaselineState', contract.toHexString() + '-1', 'baselineMissing', 'false');
  checkpoint(1);
  baseline(true, 2);
  assert.fieldEquals('ServiceBaselineState', contract.toHexString() + '-1', 'baselineMissing', 'true');
  unstake(forced);
  assert.fieldEquals('ServiceBaselineState', contract.toHexString() + '-1', 'baselineMissing', 'false');
  stake(2);
  assert.fieldEquals('ServiceBaselineState', contract.toHexString() + '-1', 'baselineMissing', 'false');
  assert.entityCount('ServiceBaselineEvent', 1);
}
test('normal unstake and restake reset a missing baseline', () => restakeAfterMissing(false));
test('forced unstake and restake reset a missing baseline', () => restakeAfterMissing(true));

test('v0.4 deposit and withdraw preserve values and map receiver to stored to', () => {
  let deposit = changetype<V4.Deposit>(newMockEvent()); stamp(deposit);
  deposit.parameters = [new ethereum.EventParam('sender', ethereum.Value.fromAddress(master)), new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))), new ethereum.EventParam('balance', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(20))), new ethereum.EventParam('availableRewards', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(13)))];
  h.handleDeposit(deposit);
  let depositId = deposit.transaction.hash.concatI32(deposit.logIndex.toI32()).toHexString();
  assert.fieldEquals('Deposit', depositId, 'sender', master.toHexString());
  assert.fieldEquals('Deposit', depositId, 'amount', '7');
  assert.fieldEquals('Deposit', depositId, 'balance', '20');
  assert.fieldEquals('Deposit', depositId, 'availableRewards', '13');
  let withdrawal = changetype<V4.Withdraw>(newMockEvent()); stamp(withdrawal);
  withdrawal.parameters = [new ethereum.EventParam('receiver', ethereum.Value.fromAddress(agentSafe)), new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(9)))];
  h.handleWithdraw(withdrawal);
  let id = withdrawal.transaction.hash.concatI32(withdrawal.logIndex.toI32()).toHexString();
  assert.fieldEquals('Withdraw', id, 'to', agentSafe.toHexString());
  assert.fieldEquals('Withdraw', id, 'amount', '9');
});
test('v0.4 inactivity and eviction pass-throughs preserve their event arrays', () => {
  let warning = changetype<V4.ServiceInactivityWarning>(newMockEvent()); stamp(warning);
  warning.parameters = [new ethereum.EventParam('epoch', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2))), new ethereum.EventParam('serviceId', ethereum.Value.fromUnsignedBigInt(one)), new ethereum.EventParam('serviceInactivity', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(4)))];
  h.handleServiceInactivityWarning(warning);
  let id = warning.transaction.hash.concatI32(warning.logIndex.toI32()).toHexString();
  assert.fieldEquals('ServiceInactivityWarning', id, 'epoch', '2');
  assert.fieldEquals('ServiceInactivityWarning', id, 'serviceId', '1');
  assert.fieldEquals('ServiceInactivityWarning', id, 'serviceInactivity', '4');
  let evicted = changetype<V4.ServicesEvicted>(newMockEvent()); stamp(evicted);
  evicted.parameters = [new ethereum.EventParam('epoch', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2))), new ethereum.EventParam('serviceIds', ethereum.Value.fromUnsignedBigIntArray([one, BigInt.fromI32(2)])), new ethereum.EventParam('owners', ethereum.Value.fromAddressArray([master, agentSafe])), new ethereum.EventParam('multisigs', ethereum.Value.fromAddressArray([agentSafe, master])), new ethereum.EventParam('serviceInactivity', ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(4), BigInt.fromI32(5)]))];
  h.handleServicesEvicted(evicted);
  id = evicted.transaction.hash.concatI32(evicted.logIndex.toI32()).toHexString();
  assert.fieldEquals('ServicesEvicted', id, 'epoch', '2');
  assert.fieldEquals('ServicesEvicted', id, 'serviceIds', '[1, 2]');
  assert.fieldEquals('ServicesEvicted', id, 'owners', '[' + master.toHexString() + ', ' + agentSafe.toHexString() + ']');
  assert.fieldEquals('ServicesEvicted', id, 'multisigs', '[' + agentSafe.toHexString() + ', ' + master.toHexString() + ']');
  assert.fieldEquals('ServicesEvicted', id, 'serviceInactivity', '[4, 5]');
});
