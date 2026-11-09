import {assert, test, beforeEach, afterEach, clearStore, newMockEvent, dataSourceMock} from 'matchstick-as/assembly/index';
import {Address, BigInt, ethereum} from '@graphprotocol/graph-ts';
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
function stake(epoch: i32 = 1): void {
  let e = changetype<V4.ServiceStaked>(createServiceStakedEvent(one, BigInt.fromI32(epoch), contract));
  e.logIndex = one;
  e.parameters.push(new ethereum.EventParam('rewardDistributionInfo', ethereum.Value.fromUnsignedBigInt(BigInt.zero())));
  h.handleServiceStaked(e);
}
function checkpoint(epoch: i32, reward: i32 = 0): void {
  let ids: BigInt[] = reward > 0 ? [one] : [];
  let amounts: BigInt[] = reward > 0 ? [BigInt.fromI32(reward)] : [];
  let e = changetype<V4.Checkpoint>(createCheckpointEvent(BigInt.fromI32(epoch), ids, amounts, contract));
  e.logIndex = BigInt.fromI32(epoch + 10); h.handleCheckpoint(e);
}
function rebaseline(epoch: i32): void {
  let e = changetype<V4.ServicesRebaselined>(newMockEvent());
  e.address = contract; e.logIndex = BigInt.fromI32(100 + epoch);
  e.parameters = [new ethereum.EventParam('epoch', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(epoch)))];
  h.handleServicesRebaselined(e);
}
function claim(amounts: BigInt[], recipients: Address[]): void {
  let e = changetype<V4.RewardClaimed>(createRewardClaimedEvent(one, one, BigInt.zero(), contract));
  e.logIndex = BigInt.fromI32(30); e.parameters = e.parameters.slice(0, 5);
  e.parameters.push(new ethereum.EventParam('receivers', ethereum.Value.fromAddressArray(recipients)));
  e.parameters.push(new ethereum.EventParam('rewardAmounts', ethereum.Value.fromUnsignedBigIntArray(amounts)));
  h.handleRewardClaimed(e);
  let row = RewardClaimed.load(e.transaction.hash.concatI32(30))!;
  let total = BigInt.zero(); for (let i = 0; i < amounts.length; i++) total = total.plus(amounts[i]);
  assert.bigIntEquals(row.reward, total); assert.i32Equals(row.receivers!.length, recipients.length);
  assert.bytesEquals(row.receivers![0], recipients[0]);
}
function unstake(forced: boolean): void {
  let e = changetype<V4.ServiceUnstaked>(createServiceUnstakedEvent(one, one, BigInt.zero(), contract));
  e.logIndex = BigInt.fromI32(31); e.parameters = e.parameters.slice(0, 5);
  e.parameters.push(new ethereum.EventParam('availableRewards', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(100))));
  e.parameters.push(new ethereum.EventParam('enforced', ethereum.Value.fromBoolean(forced)));
  h.handleServiceUnstaked(e);
}
function baseline(missing: boolean, epoch: i32): void {
  let e = newMockEvent(); e.address = contract; e.logIndex = BigInt.fromI32(50 + epoch);
  e.parameters = [new ethereum.EventParam('epoch', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(epoch))), new ethereum.EventParam('serviceId', ethereum.Value.fromUnsignedBigInt(one))];
  if (missing) h.handleServiceBaselineMissing(changetype<V4.ServiceBaselineMissing>(e));
  else h.handleServiceBaselineRecovered(changetype<V4.ServiceBaselineRecovered>(e));
}
beforeEach(() => {
  clearStore(); dataSourceMock.setNetwork('gnosis');
  mockStakingProxyConfig(contract, ['serviceRegistryTokenUtility'], null, '0.4.0');
  handleInstanceCreated(createInstanceCreatedEvent(master, contract, contract));
});
afterEach(() => {clearStore(); dataSourceMock.resetValues();});
test('v0.4 recipient arrays and normal unstake count one payout and preserve earned rewards', () => {
  stake(); checkpoint(1, 100); claim([BigInt.fromI32(40), BigInt.fromI32(60)], [master, agentSafe]); unstake(false);
  assert.fieldEquals('Global', '', 'totalRewards', '100'); assert.fieldEquals('Global', '', 'totalRewardsClaimed', '100');
  assert.fieldEquals('Global', '', 'currentOlasStaked', '0'); assert.fieldEquals('Service', '1', 'olasRewardsClaimed', '100');
  assert.fieldEquals('ServiceRewardsHistory', '1-' + contract.toHexString() + '-1', 'rewardAmount', '100');
  assert.entityCount('ServiceUnstakedV4', 1); assert.entityCount('RewardClaimed', 1); assert.entityCount('RewardUpdate', 2);
});
test('a recipient array can pay the Master Safe directly without an Agent Safe sweep', () => {
  stake(); claim([BigInt.fromI32(50)], [master]); assert.fieldEquals('Global', '', 'totalRewardsClaimed', '50');
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
