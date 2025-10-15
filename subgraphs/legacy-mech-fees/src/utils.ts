import { BigInt, Bytes } from '@graphprotocol/graph-ts';
import { Global, DailyFees, MechDaily } from '../generated/schema';

export function getOrCreateGlobal(): Global {
  let global = Global.load('');
  if (global == null) {
    global = new Global('');
    global.totalFeesIn = BigInt.fromI32(0);
    global.totalFeesOut = BigInt.fromI32(0);
    global.totalFeesInLegacyMech = BigInt.fromI32(0);
    global.totalFeesInLegacyMechMarketPlace = BigInt.fromI32(0);
    global.totalFeesOutLegacyMech = BigInt.fromI32(0);
    global.totalFeesOutLegacyMechMarketPlace = BigInt.fromI32(0);
    global.save();
  }
  return global;
}

export function updateGlobalFeesInLegacyMech(amount: BigInt): void {
  if (amount.le(BigInt.fromI32(0))) {
    return;
  }
  const global = getOrCreateGlobal();
  global.totalFeesIn = global.totalFeesIn.plus(amount);
  global.totalFeesInLegacyMech = global.totalFeesInLegacyMech.plus(amount);
  global.save();
}

export function updateGlobalFeesInLegacyMechMarketPlace(amount: BigInt): void {
  if (amount.le(BigInt.fromI32(0))) {
    return;
  }
  const global = getOrCreateGlobal();
  global.totalFeesIn = global.totalFeesIn.plus(amount);
  global.totalFeesInLegacyMechMarketPlace =
    global.totalFeesInLegacyMechMarketPlace.plus(amount);
  global.save();
}

export function updateGlobalFeesOutLegacyMech(amount: BigInt): void {
  if (amount.le(BigInt.fromI32(0))) {
    return;
  }
  const global = getOrCreateGlobal();
  global.totalFeesOut = global.totalFeesOut.plus(amount);
  global.totalFeesOutLegacyMech = global.totalFeesOutLegacyMech.plus(amount);
  global.save();
}

export function updateGlobalFeesOutLegacyMechMarketPlace(amount: BigInt): void {
  if (amount.le(BigInt.fromI32(0))) {
    return;
  }
  const global = getOrCreateGlobal();
  global.totalFeesOut = global.totalFeesOut.plus(amount);
  global.totalFeesOutLegacyMechMarketPlace =
    global.totalFeesOutLegacyMechMarketPlace.plus(amount);
  global.save();
}

function getDateId(timestamp: BigInt): string {
  const dayTimestamp = timestamp.toI32() / 86400;
  return (dayTimestamp * 86400).toString();
}

export function getOrCreateDailyFees(timestamp: BigInt): DailyFees {
  const dateId = getDateId(timestamp);
  let dailyFees = DailyFees.load(dateId);
  if (dailyFees == null) {
    const dayTimestamp = timestamp.toI32() / 86400;
    dailyFees = new DailyFees(dateId);
    dailyFees.date = dayTimestamp * 86400;
    dailyFees.totalFeesInLegacyMech = BigInt.fromI32(0);
    dailyFees.totalFeesInLegacyMechMarketPlace = BigInt.fromI32(0);
    dailyFees.totalFeesOutLegacyMech = BigInt.fromI32(0);
    dailyFees.totalFeesOutLegacyMechMarketPlace = BigInt.fromI32(0);
    dailyFees.save();
  }
  return dailyFees;
}

function getMechDailyId(mechAddress: Bytes, timestamp: BigInt): string {
  const dateId = getDateId(timestamp);
  return mechAddress.toHexString() + '-' + dateId;
}

export function getOrCreateMechDaily(
  mechAddress: Bytes,
  agentId: i32,
  timestamp: BigInt
): MechDaily {
  const id = getMechDailyId(mechAddress, timestamp);
  let mechDaily = MechDaily.load(id);
  if (mechDaily == null) {
    const dayTimestamp = timestamp.toI32() / 86400;
    mechDaily = new MechDaily(id);
    mechDaily.mech = mechAddress;
    mechDaily.agentId = agentId;
    mechDaily.date = dayTimestamp * 86400;
    mechDaily.feesInLegacyMech = BigInt.fromI32(0);
    mechDaily.feesOutLegacyMech = BigInt.fromI32(0);
    mechDaily.feesInLegacyMechMarketPlace = BigInt.fromI32(0);
    mechDaily.feesOutLegacyMechMarketPlace = BigInt.fromI32(0);
    mechDaily.save();
  }
  return mechDaily;
}

export function updateMechDailyFeesInLegacyMech(
  mechAddress: Bytes,
  agentId: i32,
  amount: BigInt,
  timestamp: BigInt
): void {
  if (amount.le(BigInt.fromI32(0))) {
    return;
  }
  const mechDaily = getOrCreateMechDaily(mechAddress, agentId, timestamp);
  mechDaily.feesInLegacyMech = mechDaily.feesInLegacyMech.plus(amount);
  mechDaily.save();
}

export function updateMechDailyFeesOutLegacyMech(
  mechAddress: Bytes,
  agentId: i32,
  amount: BigInt,
  timestamp: BigInt
): void {
  if (amount.le(BigInt.fromI32(0))) {
    return;
  }
  const mechDaily = getOrCreateMechDaily(mechAddress, agentId, timestamp);
  mechDaily.feesOutLegacyMech = mechDaily.feesOutLegacyMech.plus(amount);
  mechDaily.save();
}

export function updateMechDailyFeesInLegacyMechMarketPlace(
  mechAddress: Bytes,
  agentId: i32,
  amount: BigInt,
  timestamp: BigInt
): void {
  if (amount.le(BigInt.fromI32(0))) {
    return;
  }
  const mechDaily = getOrCreateMechDaily(mechAddress, agentId, timestamp);
  mechDaily.feesInLegacyMechMarketPlace =
    mechDaily.feesInLegacyMechMarketPlace.plus(amount);
  mechDaily.save();
}

export function updateMechDailyFeesOutLegacyMechMarketPlace(
  mechAddress: Bytes,
  agentId: i32,
  amount: BigInt,
  timestamp: BigInt
): void {
  if (amount.le(BigInt.fromI32(0))) {
    return;
  }
  const mechDaily = getOrCreateMechDaily(mechAddress, agentId, timestamp);
  mechDaily.feesOutLegacyMechMarketPlace =
    mechDaily.feesOutLegacyMechMarketPlace.plus(amount);
  mechDaily.save();
}
