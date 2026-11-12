import { createMockedFunction, newMockEvent, newMockCall } from 'matchstick-as/assembly/index';
import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { Epoch, TokenomicsAccountingState } from '../generated/schema';
import { recordVoteWeighting, recordProcessors, recordNomination, hashNominee } from '../src/dispenser-accounting';
import { ClaimStakingIncentivesCall, ClaimStakingIncentivesBatchCall, RetainCall, StakingIncentivesClaimed, StakingIncentivesBatchClaimed, Retained } from '../generated/DispenserProxy/DispenserProxy';
export const PROXY = Address.fromString('0x78Bd94F48CAe623CC74828eCbFEBE3bDF428D83D');
export const TOKENOMICS = Address.fromString('0x0000000000000000000000000000000000000010');
export const VOTES = Address.fromString('0x0000000000000000000000000000000000000020');
export const PROCESSOR = Address.fromString('0x0000000000000000000000000000000000000030');
export const ACCOUNT = Address.fromString('0x0000000000000000000000000000000000000001');
export const TARGET = Bytes.fromHexString('0x0000000000000000000000000000000000000000000000000000000000000001');
export const OTHER = Bytes.fromHexString('0x0000000000000000000000000000000000000000000000000000000000000002');
export const RETAINER = Bytes.fromHexString('0x0000000000000000000000000000000000000000000000000000000000000003');
export const CHAIN = BigInt.fromString('5000000000');
export const SCALE = BigInt.fromString('1000000000000000000');
export function u(n: i32): ethereum.Value { return ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(n)); }
export function param(n: string, v: ethereum.Value): ethereum.EventParam { return new ethereum.EventParam(n, v); }
export function setEpoch(n: i32): void { const s = new TokenomicsAccountingState('epoch'); s.currentEpoch = BigInt.fromI32(n); s.save(); }
export function setup(): void {
  setEpoch(1); recordVoteWeighting(PROXY, VOTES); recordProcessors(PROXY, [CHAIN], [PROCESSOR]);
  recordNomination(PROXY, hashNominee(TARGET, CHAIN)); recordNomination(PROXY, hashNominee(OTHER, CHAIN));
  recordNomination(PROXY, hashNominee(RETAINER, BigInt.fromI32(1))); setEpoch(3);
  createMockedFunction(PROCESSOR, 'getBridgingDecimals', 'getBridgingDecimals():(uint256)').returns([u(18)]);
  createMockedFunction(PROXY, 'tokenomics', 'tokenomics():(address)').returns([ethereum.Value.fromAddress(TOKENOMICS)]);
  createMockedFunction(PROXY, 'retainer', 'retainer():(bytes32)').returns([ethereum.Value.fromFixedBytes(RETAINER)]);
  createMockedFunction(PROXY, 'retainerHash', 'retainerHash():(bytes32)').returns([ethereum.Value.fromFixedBytes(hashNominee(RETAINER, BigInt.fromI32(1)))]);
  createMockedFunction(PROXY, 'maxNumClaimingEpochs', 'maxNumClaimingEpochs():(uint256)').returns([u(10)]);
  epochFixture(1, 100); epochFixture(2, 200);
}
export function epochFixture(n: i32, inflation: i32): void {
  const e = new Epoch(n.toString()); e.counter = n; e.startBlock = BigInt.fromI32(1); e.accountTopUps = BigInt.zero(); e.availableDevIncentives = BigInt.zero(); e.availableStakingIncentives = BigInt.fromI32(inflation); e.save();
  createMockedFunction(TOKENOMICS, 'mapEpochStakingPoints', 'mapEpochStakingPoints(uint256):(uint96,uint96,uint16,uint8)').withArgs([u(n)]).returns([u(inflation), u(10000), u(1), u(0)]);
  createMockedFunction(TOKENOMICS, 'getEpochEndTime', 'getEpochEndTime(uint256):(uint256)').withArgs([u(n)]).returns([u(n * 100)]);
  weights(n, TARGET, CHAIN, SCALE.div(BigInt.fromI32(2)), SCALE);
  weights(n, OTHER, CHAIN, BigInt.zero(), SCALE);
  weights(n, RETAINER, BigInt.fromI32(1), SCALE.div(BigInt.fromI32(2)), SCALE);
}
export function weights(n: i32, target: Bytes, chain: BigInt, weight: BigInt, total: BigInt): void {
  createMockedFunction(VOTES, 'nomineeRelativeWeight', 'nomineeRelativeWeight(bytes32,uint256,uint256):(uint256,uint256)').withArgs([ethereum.Value.fromFixedBytes(target), ethereum.Value.fromUnsignedBigInt(chain), u(n * 100)]).returns([ethereum.Value.fromUnsignedBigInt(weight), ethereum.Value.fromUnsignedBigInt(total)]);
}
export function single(index: i32, incentive: i32, transfer: i32, returned: i32, target: Bytes = TARGET): StakingIncentivesClaimed {
  const e = changetype<StakingIncentivesClaimed>(newMockEvent()); e.address = PROXY; e.logIndex = BigInt.fromI32(index);
  e.parameters = [param('account', ethereum.Value.fromAddress(ACCOUNT)), param('chainId', ethereum.Value.fromUnsignedBigInt(CHAIN)), param('stakingTarget', ethereum.Value.fromFixedBytes(target)), param('stakingIncentive', u(incentive)), param('transferAmount', u(transfer)), param('returnAmount', u(returned))]; return e;
}
export function singleCall(count: i32, target: Bytes = TARGET): ClaimStakingIncentivesCall {
  const c = changetype<ClaimStakingIncentivesCall>(newMockCall()); c.to = PROXY;
  c.inputValues = [param('numClaimedEpochs', u(count)), param('chainId', ethereum.Value.fromUnsignedBigInt(CHAIN)), param('stakingTarget', ethereum.Value.fromFixedBytes(target)), param('bridgePayload', ethereum.Value.fromBytes(Bytes.empty()))]; return c;
}
export function retained(index: i32, returned: i32): Retained {
  const e = changetype<Retained>(newMockEvent()); e.address = PROXY; e.logIndex = BigInt.fromI32(index);
  e.parameters = [param('account', ethereum.Value.fromAddress(ACCOUNT)), param('returnAmount', u(returned))]; return e;
}
export function retainCall(): RetainCall { const c = changetype<RetainCall>(newMockCall()); c.to = PROXY; return c; }
export function batch(index: i32, amount: i32, transfer: i32): StakingIncentivesBatchClaimed {
  const e = changetype<StakingIncentivesBatchClaimed>(newMockEvent()); e.address = PROXY; e.logIndex = BigInt.fromI32(index);
  e.parameters = [param('account', ethereum.Value.fromAddress(ACCOUNT)), param('chainIds', ethereum.Value.fromUnsignedBigIntArray([CHAIN])), param('stakingTargets', ethereum.Value.fromArray([ethereum.Value.fromFixedBytesArray([TARGET])])), param('stakingIncentives', ethereum.Value.fromArray([ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(amount)])])), param('totalStakingIncentive', u(amount)), param('totalTransferAmount', u(transfer)), param('totalReturnAmount', u(amount - transfer))]; return e;
}
export function batchCall(count: i32): ClaimStakingIncentivesBatchCall {
  const c = changetype<ClaimStakingIncentivesBatchCall>(newMockCall()); c.to = PROXY;
  c.inputValues = [param('numClaimedEpochs', u(count)), param('chainIds', ethereum.Value.fromUnsignedBigIntArray([CHAIN])), param('stakingTargets', ethereum.Value.fromArray([ethereum.Value.fromFixedBytesArray([TARGET])])), param('bridgePayloads', ethereum.Value.fromBytesArray([Bytes.empty()])), param('valueAmounts', ethereum.Value.fromUnsignedBigIntArray([BigInt.zero()]))]; return c;
}
