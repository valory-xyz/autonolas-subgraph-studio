import { AddNomineeHash as AddNomineeHashEvent } from '../generated/DispenserProxy/DispenserProxy';
import { assert, beforeEach, clearStore, test, newMockEvent } from 'matchstick-as/assembly/index';
import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { handleAddNomineeHash, handleStakingIncentivesClaimed, handleStakingIncentivesBatchClaimed, handleRetained } from '../src/dispenser-proxy';
import { handleClaimCall, handleBatchClaimCall, handleRetainCall, handleAccountingBlock, calculateEpoch, recordRemoval, hashNominee } from '../src/dispenser-accounting';
import { handleStakingRefunded } from '../src/tokenomics';
import { createStakingRefundedEvent } from './tokenomics-utils';
import { PROXY, TARGET, OTHER, RETAINER, CHAIN, SCALE, setup, setEpoch, epochFixture, weights, single, singleCall, retained, retainCall, batch, batchCall } from './dispenser-accounting-utils';

beforeEach(() => { clearStore(); setup(); });
test('allocates a two-epoch single claim without using the final contract cursor', () => {
  handleStakingIncentivesClaimed(single(1, 150, 150, 0)); handleClaimCall(singleCall(10));
  assert.entityCount('StakingIncentive', 2);
  assert.fieldEquals('Epoch', '1', 'totalStakingIncentives', '50'); assert.fieldEquals('Epoch', '2', 'totalStakingIncentives', '100');
  assert.fieldEquals('Epoch', '1', 'availableStakingIncentives', '50'); assert.fieldEquals('Epoch', '2', 'availableStakingIncentives', '100');
  handleAccountingBlock(newMockEvent().block); assert.entityCount('DispenserAccountingOperation', 0);
});
test('full withheld coverage keeps both original allocations and records inflation credit once', () => {
  handleStakingIncentivesClaimed(single(1, 150, 0, 0)); handleClaimCall(singleCall(2));
  const refund = createStakingRefundedEvent(BigInt.fromI32(3), BigInt.fromI32(150));
  // Model the current, unsettled epoch to distinguish refund credit from old allocation.
  epochFixture(3, 0); handleStakingRefunded(refund);
  assert.fieldEquals('Epoch', '3', 'stakingInflationRefunds', '150');
  assert.fieldEquals('Epoch', '3', 'availableStakingIncentives', '0');
  assert.fieldEquals('Epoch', '1', 'totalStakingIncentives', '50'); assert.fieldEquals('Epoch', '2', 'totalStakingIncentives', '100');
});
test('batch partial withheld coverage reconciles returns without double deduction', () => {
  handleStakingIncentivesBatchClaimed(batch(1, 150, 60)); handleBatchClaimCall(batchCall(2));
  assert.fieldEquals('Epoch', '1', 'availableStakingIncentives', '50'); assert.fieldEquals('Epoch', '2', 'availableStakingIncentives', '100');
});
test('two batches in one transaction advance the nominee cursor by their own call ranges', () => {
  handleStakingIncentivesBatchClaimed(batch(1, 50, 50)); handleStakingIncentivesBatchClaimed(batch(2, 100, 100));
  handleBatchClaimCall(batchCall(1)); assert.entityCount('StakingIncentive', 1);
  handleBatchClaimCall(batchCall(1)); assert.entityCount('StakingIncentive', 2);
  assert.fieldEquals('Epoch', '1', 'totalStakingIncentives', '50'); assert.fieldEquals('Epoch', '2', 'totalStakingIncentives', '100');
});
function zeroWeights(): void {
  for (let i = 1; i <= 2; i++) {
    weights(i, TARGET, CHAIN, BigInt.zero(), BigInt.zero()); weights(i, OTHER, CHAIN, BigInt.zero(), BigInt.zero());
    weights(i, RETAINER, BigInt.fromI32(1), BigInt.zero(), BigInt.zero());
  }
}
test('claim-before-retain refunds zero-weight epochs once even with reversed call-handler dispatch', () => {
  zeroWeights(); handleStakingIncentivesClaimed(single(1, 0, 0, 300)); handleRetained(retained(2, 0));
  handleRetainCall(retainCall()); handleClaimCall(singleCall(2));
  assert.entityCount('DispenserZeroWeightRefund', 2); assert.entityCount('DispenserEpochReturn', 0);
  assert.fieldEquals('Epoch', '1', 'totalStakingReturns', '100'); assert.fieldEquals('Epoch', '2', 'totalStakingReturns', '200');
});
test('retain-before-claim consumes zero-weight allocations before other nominees', () => {
  zeroWeights(); handleRetained(retained(1, 300)); handleStakingIncentivesClaimed(single(2, 0, 0, 0));
  handleClaimCall(singleCall(2)); handleRetainCall(retainCall());
  assert.entityCount('DispenserEpochReturn', 2); assert.fieldEquals('Epoch', '1', 'availableStakingIncentives', '0');
  assert.fieldEquals('Epoch', '2', 'availableStakingIncentives', '0');
});
test('different nominees cannot refund the same zero-weight epoch twice', () => {
  zeroWeights(); handleStakingIncentivesClaimed(single(1, 0, 0, 300)); handleStakingIncentivesClaimed(single(2, 0, 0, 0, OTHER));
  handleClaimCall(singleCall(2)); handleClaimCall(singleCall(2, OTHER));
  assert.fieldEquals('Epoch', '1', 'totalStakingReturns', '100'); assert.fieldEquals('Epoch', '2', 'totalStakingReturns', '200');
});
test('retainer refunds preserve final-division rounding across epochs', () => {
  epochFixture(1, 1); epochFixture(2, 1); handleRetained(retained(1, 1)); handleRetainCall(retainCall());
  assert.fieldEquals('Epoch', '1', 'totalStakingReturns', '0'); assert.fieldEquals('Epoch', '2', 'totalStakingReturns', '1');
});
test('removed nominee ranges stop at the removal epoch', () => {
  setEpoch(2); recordRemoval(PROXY, hashNominee(TARGET, CHAIN)); setEpoch(3);
  handleStakingIncentivesClaimed(single(1, 50, 50, 0)); handleClaimCall(singleCall(10));
  assert.entityCount('StakingIncentive', 1); assert.fieldEquals('Epoch', '2', 'availableStakingIncentives', '200');
});
test('rejects emitted totals that cannot be reconciled', () => {
  handleStakingIncentivesClaimed(single(1, 999, 999, 0)); handleClaimCall(singleCall(2));
}, true);
test('missing call traces cannot silently leave raw-only accounting', () => {
  handleStakingIncentivesClaimed(single(1, 150, 150, 0)); handleAccountingBlock(newMockEvent().block);
}, true);
test('weight threshold, inflation cap, programme cap and bridge rounding follow contract arithmetic', () => {
  let amount = calculateEpoch(BigInt.fromI32(100), BigInt.fromI32(100), BigInt.fromI32(6000), SCALE.div(BigInt.fromI32(2)), SCALE, BigInt.fromI32(18));
  assert.bigIntEquals(amount.incentive, BigInt.zero()); assert.bigIntEquals(amount.returned, BigInt.fromI32(50));
  amount = calculateEpoch(BigInt.fromI32(100), BigInt.fromI32(20), BigInt.zero(), SCALE, BigInt.fromI32(40), BigInt.fromI32(18));
  assert.bigIntEquals(amount.incentive, BigInt.fromI32(20)); assert.bigIntEquals(amount.returned, BigInt.fromI32(80));
  amount = calculateEpoch(BigInt.fromString('1999999999999'), BigInt.fromString('2000000000000'), BigInt.zero(), SCALE, SCALE, BigInt.fromI32(6));
  assert.bigIntEquals(amount.incentive, BigInt.fromString('1000000000000')); assert.bigIntEquals(amount.returned, BigInt.fromString('999999999999'));
});

test('fraction-zero epochs with carried incentives are still allocated', () => {
  // All fixture stakingFraction values are zero, while the incentive is nonzero.
  handleStakingIncentivesClaimed(single(1, 150, 150, 0)); handleClaimCall(singleCall(2));
  assert.fieldEquals('Epoch', '1', 'totalStakingIncentives', '50');
});
test('consecutive single claims in the same transaction retain separate epoch histories', () => {
  handleStakingIncentivesClaimed(single(1, 50, 50, 0)); handleStakingIncentivesClaimed(single(2, 100, 100, 0));
  handleClaimCall(singleCall(1)); handleClaimCall(singleCall(1));
  assert.entityCount('StakingIncentive', 2); assert.fieldEquals('Epoch', '2', 'totalStakingIncentives', '100');
});

test('later nomination events cannot overwrite the cursor of an earlier claim in the same transaction', () => {
  handleStakingIncentivesClaimed(single(1, 150, 150, 0));
  const event = changetype<AddNomineeHashEvent>(newMockEvent()); event.address = PROXY; event.logIndex = BigInt.fromI32(2);
  event.parameters = [new ethereum.EventParam('nomineeHash', ethereum.Value.fromFixedBytes(hashNominee(TARGET, CHAIN)))];
  handleAddNomineeHash(event); handleClaimCall(singleCall(2));
  assert.fieldEquals('Epoch', '1', 'totalStakingIncentives', '50'); assert.fieldEquals('Epoch', '2', 'totalStakingIncentives', '100');
});

test('a later epoch settlement cannot extend an earlier claim range in the same transaction', () => {
  handleStakingIncentivesClaimed(single(1, 150, 150, 0)); setEpoch(4);
  handleClaimCall(singleCall(10)); assert.entityCount('StakingIncentive', 2);
});

test('a multi-target batch preserves separate allocations and aggregate withheld credit', () => {
  weights(1, OTHER, CHAIN, SCALE.div(BigInt.fromI32(2)), SCALE);
  weights(2, OTHER, CHAIN, SCALE.div(BigInt.fromI32(2)), SCALE);
  const event = batch(1, 150, 100);
  const params = event.parameters;
  params[2] = new ethereum.EventParam('stakingTargets', ethereum.Value.fromArray([ethereum.Value.fromFixedBytesArray([TARGET, OTHER])]));
  params[3] = new ethereum.EventParam('stakingIncentives', ethereum.Value.fromArray([ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(150), BigInt.fromI32(150)])]));
  params[4] = new ethereum.EventParam('totalStakingIncentive', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(300)));
  params[6] = new ethereum.EventParam('totalReturnAmount', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(200)));
  event.parameters = params;
  const call = batchCall(2); const inputs = call.inputValues;
  inputs[2] = params[2]; call.inputValues = inputs;
  handleStakingIncentivesBatchClaimed(event); handleBatchClaimCall(call);
  assert.entityCount('StakingIncentive', 4);
  assert.fieldEquals('Epoch', '1', 'availableStakingIncentives', '0'); assert.fieldEquals('Epoch', '2', 'availableStakingIncentives', '0');
});
test('nonzero retainer weights consume only the residual original allocations', () => {
  handleRetained(retained(1, 150)); handleStakingIncentivesClaimed(single(2, 150, 150, 0));
  handleClaimCall(singleCall(2)); handleRetainCall(retainCall());
  assert.fieldEquals('Epoch', '1', 'totalStakingReturns', '50'); assert.fieldEquals('Epoch', '2', 'totalStakingReturns', '100');
  assert.fieldEquals('Epoch', '1', 'availableStakingIncentives', '0'); assert.fieldEquals('Epoch', '2', 'availableStakingIncentives', '0');
});
