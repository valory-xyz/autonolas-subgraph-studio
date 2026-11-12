import { Address, BigInt, Bytes, ethereum, crypto, store } from '@graphprotocol/graph-ts';
import { DispenserProxy, ClaimStakingIncentivesCall, ClaimStakingIncentivesBatchCall, RetainCall } from '../generated/DispenserProxy/DispenserProxy';
import { StakingAccountingViews } from '../generated/DispenserProxy/StakingAccountingViews';
import { DispenserAccountingPending, DispenserAccountingOperation, DispenserAccountingTransaction, DispenserAccountingConfig, DispenserProcessor, TokenomicsAccountingState, DispenserNomineeCursor, DispenserZeroWeightRefund, DispenserEpochReturn, Epoch, StakingIncentive, StakingIncentivesClaimed, StakingIncentivesBatchClaimed, StakingIncentivesBatch, Retained } from '../generated/schema';
const ZERO = BigInt.zero();
const ONE = BigInt.fromI32(1);
const SCALE = BigInt.fromString('1000000000000000000');
function currentEpoch(): BigInt {
  const state = TokenomicsAccountingState.load('epoch');
  assert(state !== null, 'Missing Tokenomics epoch history: full reindex required');
  return state!.currentEpoch;
}
function key(proxy: Address, hash: Bytes): string { return proxy.toHexString() + ':' + hash.toHexString(); }
export function hashNominee(target: Bytes, chain: BigInt): Bytes {
  const tuple = new ethereum.Tuple();
  tuple.push(ethereum.Value.fromFixedBytes(target));
  tuple.push(ethereum.Value.fromUnsignedBigInt(chain));
  return Bytes.fromByteArray(crypto.keccak256(ethereum.encode(ethereum.Value.fromTuple(tuple))!));
}
export function recordNomination(proxy: Address, hash: Bytes): void {
  const c = new DispenserNomineeCursor(key(proxy, hash));
  c.nextEpoch = currentEpoch(); c.removedEpoch = ZERO; c.save();
}
export function recordRemoval(proxy: Address, hash: Bytes): void {
  const c = DispenserNomineeCursor.load(key(proxy, hash));
  assert(c !== null, 'Missing nomination history');
  c!.removedEpoch = currentEpoch(); c!.save();
}
export function recordVoteWeighting(proxy: Address, votes: Address): void {
  const c = new DispenserAccountingConfig(proxy); c.voteWeighting = votes; c.save();
}
export function recordProcessors(proxy: Address, chains: BigInt[], processors: Address[]): void {
  for (let i = 0; i < chains.length; i++) {
    const r = new DispenserProcessor(proxy.toHexString() + ':' + chains[i].toString());
    r.processor = processors[i]; r.save();
  }
}
export function queueOperation(event: ethereum.Event, kind: string, chains: BigInt[]): DispenserAccountingOperation {
  const op = new DispenserAccountingOperation(event.transaction.hash.concatI32(event.logIndex.toI32()));
  op.kind = kind; op.logIndex = event.logIndex; op.currentEpoch = currentEpoch();
  const config = DispenserAccountingConfig.load(event.address);
  assert(config !== null || kind == 'nominate' || kind == 'remove', 'Missing VoteWeighting configuration history');
  op.voteWeighting = config === null ? Address.zero() : config.voteWeighting;
  const decimals = new Array<BigInt>();
  for (let i = 0; i < chains.length; i++) {
    const route = DispenserProcessor.load(event.address.toHexString() + ':' + chains[i].toString());
    assert(route !== null, 'Missing processor route history');
    decimals.push(StakingAccountingViews.bind(Address.fromBytes(route!.processor)).getBridgingDecimals());
  }
  op.decimals = decimals; op.save();
  const id = event.address.concat(event.transaction.hash);
  let queue = DispenserAccountingTransaction.load(id);
  if (queue === null) {
    queue = new DispenserAccountingTransaction(id); queue.operations = []; queue.nextOperation = 0;
    let pending = DispenserAccountingPending.load('transactions');
    if (pending === null) { pending = new DispenserAccountingPending('transactions'); pending.transactions = []; }
    const transactions = pending.transactions; transactions.push(id); pending.transactions = transactions; pending.save();
  }
  const ids = queue.operations; ids.push(op.id); queue.operations = ids; queue.save();
  return op;
}
// Graph runs event triggers before call triggers. Match traces within each
// method, then replay all operations in emitted-log order, even if Graph groups
// different call-handler types differently. Never infer a cursor from end-of-block state.
function bindOperation(call: ethereum.Call, kind: string, count: BigInt): DispenserAccountingOperation {
  const q = DispenserAccountingTransaction.load(call.to.concat(call.transaction.hash));
  assert(q !== null, 'Missing event for successful call trace');
  for (let i = 0; i < q!.operations.length; i++) {
    const op = DispenserAccountingOperation.load(q!.operations[i])!;
    if (op.kind == kind && op.claimedEpochs === null) {
      op.claimedEpochs = count; op.save();
      return op;
    }
  }
  assert(false, 'Missing matching event or duplicate call');
  return new DispenserAccountingOperation(Bytes.empty());
}
function completeTransaction(call: ethereum.Call): void {
  const q = DispenserAccountingTransaction.load(call.to.concat(call.transaction.hash))!;
  for (let i = q.nextOperation; i < q.operations.length; i++) {
    const op = DispenserAccountingOperation.load(q.operations[i])!;
    if (op.claimedEpochs === null) break;
    if (op.kind == 'nominate') {
      const c = new DispenserNomineeCursor(key(call.to, op.nomineeHash!));
      c.nextEpoch = op.currentEpoch; c.removedEpoch = ZERO; c.save();
    } else if (op.kind == 'remove') {
      const c = DispenserNomineeCursor.load(key(call.to, op.nomineeHash!));
      assert(c !== null, 'Missing nomination history'); c!.removedEpoch = op.currentEpoch; c!.save();
    } else if (op.kind == 'single') processSingle(call, op);
    else if (op.kind == 'batch') processBatch(call, op);
    else processRetain(call, op);
    q.nextOperation = i + 1;
  }
  q.save();
}
export function queueNomineeChange(event: ethereum.Event, hash: Bytes, removed: boolean): void {
  const op = queueOperation(event, removed ? 'remove' : 'nominate', []);
  op.nomineeHash = hash; op.claimedEpochs = ZERO; op.save();
  completeTransaction(new ethereum.Call(event.address, event.transaction.from, event.block, event.transaction, [], []));
}

export function handleClaimCall(call: ClaimStakingIncentivesCall): void {
  const op = bindOperation(call, 'single', call.inputs.numClaimedEpochs);
  const event = StakingIncentivesClaimed.load(op.id)!;
  assert(event.chainId.equals(call.inputs.chainId) && event.stakingTarget.equals(call.inputs.stakingTarget), 'Claim call/event mismatch');
  completeTransaction(call);
}
export function handleBatchClaimCall(call: ClaimStakingIncentivesBatchCall): void {
  const op = bindOperation(call, 'batch', call.inputs.numClaimedEpochs);
  assert(op.decimals.length == call.inputs.chainIds.length, 'Batch chain count mismatch');
  for (let i = 0; i < call.inputs.chainIds.length; i++) {
    const batch = StakingIncentivesBatch.load(call.to.toHexString() + '_' + op.id.toHexString() + '_' + i.toString())!;
    assert(batch.chainId.equals(call.inputs.chainIds[i]) && batch.stakingTargets.length == call.inputs.stakingTargets[i].length, 'Batch call/event mismatch');
    for (let j = 0; j < batch.stakingTargets.length; j++) assert(batch.stakingTargets[j].equals(call.inputs.stakingTargets[i][j]), 'Batch target mismatch');
  }
  completeTransaction(call);
}
export function handleRetainCall(call: RetainCall): void {
  bindOperation(call, 'retain', DispenserProxy.bind(call.to).maxNumClaimingEpochs());
  completeTransaction(call);
}
export class EpochAmounts {
  incentive: BigInt; returned: BigInt;
  constructor(incentive: BigInt, returned: BigInt) { this.incentive = incentive; this.returned = returned; }
}
// Mirrors Dispenser.calculateStakingIncentives at tokenomics 0a5ac87d,
// preserving the contract's integer division order and bridge rounding.
export function calculateEpoch(inflation: BigInt, maximum: BigInt, minimum: BigInt, weight: BigInt, totalWeight: BigInt, decimals: BigInt): EpochAmounts {
  if (inflation.equals(ZERO)) return new EpochAmounts(ZERO, ZERO);
  if (totalWeight.equals(ZERO)) return new EpochAmounts(ZERO, inflation);
  const available = inflation.gt(totalWeight) ? totalWeight : inflation;
  const diff = inflation.minus(available);
  if (weight.lt(minimum.times(BigInt.fromString('100000000000000')))) return new EpochAmounts(ZERO, inflation.times(weight).div(SCALE));
  let incentive = available.times(weight).div(SCALE);
  let returned = diff.times(weight).div(SCALE);
  if (incentive.gt(maximum)) { returned = returned.plus(incentive.minus(maximum)); incentive = maximum; }
  if (decimals.lt(BigInt.fromI32(18))) {
    const factor = BigInt.fromI32(10).pow(<u8>(18 - decimals.toI32()));
    const normalized = incentive.div(factor).times(factor);
    returned = returned.plus(incentive.minus(normalized)); incentive = normalized;
  }
  return new EpochAmounts(incentive, returned);
}
function epochKey(proxy: Address, e: BigInt): string { return proxy.toHexString() + ':' + e.toString(); }
function reduceAllocation(e: BigInt, incentive: BigInt, returned: BigInt): void {
  const epoch = Epoch.load(e.toString()); assert(epoch !== null, 'Missing settled epoch');
  const oldTotal = epoch!.totalStakingIncentives; const oldReturns = epoch!.totalStakingReturns;
  epoch!.totalStakingIncentives = (oldTotal === null ? ZERO : oldTotal).plus(incentive);
  epoch!.totalStakingReturns = (oldReturns === null ? ZERO : oldReturns).plus(returned);
  const available = epoch!.availableStakingIncentives; assert(available !== null, 'Missing epoch allocation');
  const remaining = available!.minus(incentive).minus(returned); assert(remaining.ge(ZERO), 'Epoch allocation overspent');
  epoch!.availableStakingIncentives = remaining; epoch!.save();
}
function endEpoch(cursor: DispenserNomineeCursor, op: DispenserAccountingOperation, count: BigInt): BigInt {
  let end = cursor.nextEpoch.plus(count);
  if (end.gt(op.currentEpoch)) end = op.currentEpoch;
  if (cursor.removedEpoch.gt(ZERO) && end.gt(cursor.removedEpoch)) end = cursor.removedEpoch;
  assert(end.ge(cursor.nextEpoch), 'Invalid claim cursor'); return end;
}
function claimTarget(call: ethereum.Call, op: DispenserAccountingOperation, account: Bytes, chain: BigInt, target: Bytes, count: BigInt, decimals: BigInt): EpochAmounts {
  const cursor = DispenserNomineeCursor.load(key(call.to, hashNominee(target, chain))); assert(cursor !== null, 'Missing nominee cursor');
  const end = endEpoch(cursor!, op, count);
  const tokenomics = StakingAccountingViews.bind(DispenserProxy.bind(call.to).tokenomics());
  const votes = StakingAccountingViews.bind(Address.fromBytes(op.voteWeighting));
  let total = ZERO; let refunds = ZERO;
  for (let e = cursor!.nextEpoch; e.lt(end); e = e.plus(ONE)) {
    let amount = new EpochAmounts(ZERO, ZERO);
    if (DispenserZeroWeightRefund.load(epochKey(call.to, e)) === null) {
      const point = tokenomics.mapEpochStakingPoints(e);
      if (!point.value0.equals(ZERO)) {
        const weight = votes.nomineeRelativeWeight(target, chain, tokenomics.getEpochEndTime(e));
        amount = calculateEpoch(point.value0, point.value1, BigInt.fromI32(point.value2), weight.value0, weight.value1, decimals);
        if (weight.value1.equals(ZERO)) new DispenserZeroWeightRefund(epochKey(call.to, e)).save();
      }
    }
    const row = new StakingIncentive(call.to.toHexString() + ':' + op.id.toHexString() + ':' + chain.toString() + ':' + target.toHexString() + ':' + e.toString());
    row.epoch = e.toString(); row.account = account; row.chainId = chain; row.stakingTarget = target;
    row.stakingIncentive = amount.incentive; row.dispenser = call.to; row.returnAmount = amount.returned;
    row.transactionHash = call.transaction.hash; row.logIndex = op.logIndex; row.save();
    reduceAllocation(e, amount.incentive, amount.returned);
    total = total.plus(amount.incentive); refunds = refunds.plus(amount.returned);
  }
  cursor!.nextEpoch = end; cursor!.save(); return new EpochAmounts(total, refunds);
}
function processSingle(call: ethereum.Call, op: DispenserAccountingOperation): void { const event = StakingIncentivesClaimed.load(op.id)!;
  const amount = claimTarget(call, op, event.account, event.chainId, event.stakingTarget, op.claimedEpochs!, op.decimals[0]);
  assert(amount.incentive.equals(event.stakingIncentive) && amount.returned.equals(event.returnAmount), 'Claim epoch sums differ from event');
  // Withheld-credit refunds are recorded once by Tokenomics.StakingRefunded;
  // they do not reduce the original allocation a second time.
}
function processBatch(call: ethereum.Call, op: DispenserAccountingOperation): void { const event = StakingIncentivesBatchClaimed.load(op.id)!;
  let total = ZERO; let returned = ZERO;
  for (let i = 0; i < op.decimals.length; i++) {
    const batch = StakingIncentivesBatch.load(call.to.toHexString() + '_' + op.id.toHexString() + '_' + i.toString())!;
    for (let j = 0; j < batch.stakingTargets.length; j++) {
      const amount = claimTarget(call, op, event.account, batch.chainId, batch.stakingTargets[j], op.claimedEpochs!, op.decimals[i]);
      assert(amount.incentive.equals(batch.stakingIncentives[j]), 'Target epoch sums differ from batch');
      total = total.plus(amount.incentive); returned = returned.plus(amount.returned);
    }
  }
  assert(total.equals(event.totalStakingIncentive), 'Batch incentive mismatch');
  assert(returned.plus(total.minus(event.totalTransferAmount)).equals(event.totalReturnAmount), 'Batch refund mismatch');
}
function processRetain(call: ethereum.Call, op: DispenserAccountingOperation): void { const event = Retained.load(op.id)!;
  const proxy = DispenserProxy.bind(call.to);
  const cursor = DispenserNomineeCursor.load(key(call.to, proxy.retainerHash())); assert(cursor !== null, 'Missing retainer nomination');
  const end = endEpoch(cursor!, op, op.claimedEpochs!);
  const tokenomics = StakingAccountingViews.bind(proxy.tokenomics());
  const votes = StakingAccountingViews.bind(Address.fromBytes(op.voteWeighting));
  let numerator = ZERO; let accounted = ZERO;
  for (let e = cursor!.nextEpoch; e.lt(end); e = e.plus(ONE)) {
    if (DispenserZeroWeightRefund.load(epochKey(call.to, e)) !== null) continue;
    const point = tokenomics.mapEpochStakingPoints(e);
    const weight = votes.nomineeRelativeWeight(proxy.retainer(), ONE, tokenomics.getEpochEndTime(e));
    if (weight.value1.equals(ZERO)) {
      new DispenserZeroWeightRefund(epochKey(call.to, e)).save(); numerator = numerator.plus(point.value0.times(SCALE));
    } else numerator = numerator.plus(point.value0.times(weight.value0));
    // retain divides only after accumulation; carry fractional dust forward
    // in epoch order so the sum of attributed rows equals the exact refund.
    const cumulative = numerator.div(SCALE); const amount = cumulative.minus(accounted); accounted = cumulative;
    const row = new DispenserEpochReturn(call.to.toHexString() + ':' + op.id.toHexString() + ':' + e.toString());
    row.dispenser = call.to; row.epoch = e.toString(); row.amount = amount; row.transactionHash = call.transaction.hash; row.logIndex = op.logIndex; row.save();
    reduceAllocation(e, ZERO, amount);
  }
  assert(accounted.equals(event.returnAmount), 'Retain epoch sums differ from event');
  cursor!.nextEpoch = end; cursor!.save();
}

// Refuse to serve silently incomplete accounting if call traces were omitted.
export function handleAccountingBlock(block: ethereum.Block): void {
  const pending = DispenserAccountingPending.load('transactions');
  if (pending === null) return;
  for (let i = 0; i < pending.transactions.length; i++) {
    const queue = DispenserAccountingTransaction.load(pending.transactions[i])!;
    assert(queue.nextOperation == queue.operations.length, 'Missing Dispenser call traces: configure trace-capable Ethereum RPC');
    for (let j = 0; j < queue.operations.length; j++) store.remove('DispenserAccountingOperation', queue.operations[j].toHexString());
    store.remove('DispenserAccountingTransaction', queue.id.toHexString());
  }
  store.remove('DispenserAccountingPending', 'transactions');
}
