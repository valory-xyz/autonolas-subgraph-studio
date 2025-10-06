import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  DepositorLock,
  WeeklyDepositorsUnlock,
  Global,
} from "../generated/schema";

// Constants for time calculations
export const WEEK_SECONDS = BigInt.fromI32(7 * 24 * 60 * 60); // 604800 seconds in a week

export function getWeekStart(timestamp: BigInt): BigInt {
  return timestamp.div(WEEK_SECONDS).times(WEEK_SECONDS);
}

export function isTimestampExpired(
  timestamp: BigInt,
  currentBlockTimestamp: BigInt
): boolean {
  return timestamp.le(currentBlockTimestamp);
}


// Entity Management Utilities

export function loadOrCreateDepositorLock(account: Bytes): DepositorLock {
  let accountId = account.toHexString();
  let depositorLock = DepositorLock.load(accountId);

  if (depositorLock == null) {
    depositorLock = new DepositorLock(accountId);
    depositorLock.account = account;
    depositorLock.unlockTimestamp = BigInt.zero();
    depositorLock.isVeOlasHolder = false;
    depositorLock.isLocked = false;
    depositorLock.weeklyUnlock = null;
  }

  return depositorLock;
}

export function loadOrCreateWeeklyDepositorsUnlock(
  weekStart: BigInt
): WeeklyDepositorsUnlock {
  let weekId = weekStart.toString();
  let weeklyEntity = WeeklyDepositorsUnlock.load(weekId);

  if (weeklyEntity == null) {
    weeklyEntity = new WeeklyDepositorsUnlock(weekId);
    weeklyEntity.startTimestamp = weekStart;
  }

  return weeklyEntity;
}

export function getOrCreateGlobalMetrics(): Global {
  let global = Global.load("global");

  if (global == null) {
    global = new Global("global");
    global.veolasHolderCount = 0;
    global.activeLockedHolderCount = 0;
    global.updatedAt = BigInt.zero();
  }

  return global;
}

function subtractWithFloor(current: i32, decrement: i32): i32 {
  if (decrement <= 0) {
    return current;
  }

  const next = current - decrement;
  if (next < 0) {
    log.warning("veOLAS counters would underflow: current={}, decrement={}", [
      current.toString(),
      decrement.toString(),
    ]);
    return 0;
  }

  return next;
}

export function updateDepositorLockForDeposit(
  depositorLock: DepositorLock,
  unlockTimestamp: BigInt,
  currentBlockTimestamp: BigInt
): DepositorLock {
  depositorLock.unlockTimestamp = unlockTimestamp;
  depositorLock.isVeOlasHolder = true;

  // Check if the lock is currently locked (not expired)
  const isLocked = !isTimestampExpired(unlockTimestamp, currentBlockTimestamp);
  depositorLock.isLocked = isLocked;

  if (isLocked) {
    let weekStart = getWeekStart(unlockTimestamp);
    let weeklyEntity = loadOrCreateWeeklyDepositorsUnlock(weekStart);
    weeklyEntity.save();
    depositorLock.weeklyUnlock = weeklyEntity.id;
  } else {
    depositorLock.weeklyUnlock = null;
  }

  return depositorLock;
}

export function updateDepositorLockForWithdraw(
  depositorLock: DepositorLock
): DepositorLock {
  depositorLock.isVeOlasHolder = false;
  depositorLock.isLocked = false;
  depositorLock.weeklyUnlock = null;

  return depositorLock;
}

export function updateDepositorLockForExpiry(
  depositorLock: DepositorLock
): DepositorLock {
  depositorLock.isLocked = false;
  depositorLock.weeklyUnlock = null;

  return depositorLock;
}

export function incrementGlobalCountersForDeposit(
  wasInactive: boolean,
  becameLocked: boolean,
  currentTimestamp: BigInt
): void {
  let global = getOrCreateGlobalMetrics();

  if (wasInactive) {
    global.veolasHolderCount = global.veolasHolderCount + 1;
  }

  if (becameLocked) {
    global.activeLockedHolderCount = global.activeLockedHolderCount + 1;
  }

  global.updatedAt = currentTimestamp;
  global.save();
}

export function decrementGlobalCountersForWithdraw(
  wasHolder: boolean,
  wasLocked: boolean,
  currentTimestamp: BigInt
): void {
  let global = getOrCreateGlobalMetrics();

  if (wasHolder) {
    global.veolasHolderCount = subtractWithFloor(
      global.veolasHolderCount,
      1
    );
  }

  if (wasLocked) {
    global.activeLockedHolderCount = subtractWithFloor(
      global.activeLockedHolderCount,
      1
    );
  }

  global.updatedAt = currentTimestamp;
  global.save();
}

export function loadLocksFromWeek(weekStart: BigInt): DepositorLock[] {
  let weekId = weekStart.toString();
  let weeklyEntity = WeeklyDepositorsUnlock.load(weekId);

  if (weeklyEntity == null) {
    return [];
  }

  // Load the derived locks for this week
  return weeklyEntity.locks.load();
}

export function isLockExpired(
  lock: DepositorLock,
  currentTimestamp: BigInt
): boolean {
  return (
    lock.isVeOlasHolder &&
    lock.isLocked &&
    isTimestampExpired(lock.unlockTimestamp, currentTimestamp)
  );
}

export function getExpiredLocks(
  locks: DepositorLock[],
  currentTimestamp: BigInt
): DepositorLock[] {
  let expiredLocks: DepositorLock[] = [];

  for (let index = 0; index < locks.length; index++) {
    if (isLockExpired(locks[index], currentTimestamp)) {
      expiredLocks.push(locks[index]);
    }
  }

  return expiredLocks;
}

export function processExpiredLocks(
  expiredLocks: DepositorLock[],
  currentTimestamp: BigInt
): void {
  if (expiredLocks.length == 0) {
    return;
  }

  let globalMetrics = getOrCreateGlobalMetrics();
  let expiredCount = 0;

  for (let index = 0; index < expiredLocks.length; index++) {
    let depositorLock = expiredLocks[index];

    if (depositorLock.isVeOlasHolder && depositorLock.isLocked) {
      depositorLock = updateDepositorLockForExpiry(depositorLock);
      depositorLock.save();
      expiredCount++;
    }
  }

  if (expiredCount == 0) {
    return;
  }

  globalMetrics.activeLockedHolderCount = subtractWithFloor(
    globalMetrics.activeLockedHolderCount,
    expiredCount
  );
  globalMetrics.updatedAt = currentTimestamp;
  globalMetrics.save();
}

