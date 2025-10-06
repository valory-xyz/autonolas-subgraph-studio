import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  DepositorLock,
  WeeklyDepositorsUnlock,
  Global,
} from "../generated/schema";

// Constants for time calculations
const WEEK_SECONDS = BigInt.fromI32(7 * 24 * 60 * 60); // 604800 seconds in a week

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
  global: Global,
  wasInactive: boolean,
  becameLocked: boolean,
  currentTimestamp: BigInt
): void {
  if (wasInactive) {
    global.veolasHolderCount = global.veolasHolderCount + 1;
  }

  if (becameLocked) {
    global.activeLockedHolderCount = global.activeLockedHolderCount + 1;
  }

  global.updatedAt = currentTimestamp;
}

export function decrementGlobalCountersForWithdraw(
  global: Global,
  wasLocked: boolean,
  currentTimestamp: BigInt
): void {
  global.veolasHolderCount = global.veolasHolderCount - 1;

  if (wasLocked) {
    global.activeLockedHolderCount = global.activeLockedHolderCount - 1;
  }

  global.updatedAt = currentTimestamp;
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

  for (let i = 0; i < locks.length; i++) {
    if (isLockExpired(locks[i], currentTimestamp)) {
      expiredLocks.push(locks[i]);
    }
  }

  return expiredLocks;
}

