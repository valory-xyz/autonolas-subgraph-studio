import { BigInt } from "@graphprotocol/graph-ts";
import { Deposit, Withdraw } from "../generated/veOLAS/veOLAS";
import { VeolasDepositor, DepositorLock } from "../generated/schema";
import { ethereum } from "@graphprotocol/graph-ts";
import {
  loadOrCreateDepositorLock,
  getOrCreateGlobalMetrics,
  updateDepositorLockForDeposit,
  incrementGlobalCountersForDeposit,
  updateDepositorLockForWithdraw,
  decrementGlobalCountersForWithdraw,
  getWeekStart,
  loadLocksFromWeek,
  getExpiredLocks,
  updateDepositorLockForExpiry,
} from "./veolas-utils";

export function handleDeposit(event: Deposit): void {
  let depositor = VeolasDepositor.load(event.params.account);
  if (depositor == null) {
    depositor = new VeolasDepositor(event.params.account);
  }
  depositor.unlockTimestamp = event.params.locktime;
  depositor.isVeOlasHolder = true;
  depositor.save();

  let depositorLock = loadOrCreateDepositorLock(event.params.account);

  const wasInactive = !depositorLock.isVeOlasHolder;
  const wasLocked = depositorLock.isLocked;

  depositorLock = updateDepositorLockForDeposit(
    depositorLock,
    event.params.locktime,
    event.block.timestamp
  );

  depositorLock.save();

  let globalMetrics = getOrCreateGlobalMetrics();
  const becameLocked = depositorLock.isLocked && !wasLocked;
  incrementGlobalCountersForDeposit(
    globalMetrics,
    wasInactive,
    becameLocked,
    event.block.timestamp
  );
  globalMetrics.save();
}

export function handleWithdraw(event: Withdraw): void {
  let depositor = VeolasDepositor.load(event.params.account);
  if (depositor != null && depositor.isVeOlasHolder) {
    depositor.isVeOlasHolder = false;
    depositor.save();
  }

  let depositorLock = loadOrCreateDepositorLock(event.params.account);

  if (!depositorLock.isVeOlasHolder) {
    return;
  }

  const wasLocked = depositorLock.isLocked;

  depositorLock = updateDepositorLockForWithdraw(depositorLock);

  depositorLock.save();

  let globalMetrics = getOrCreateGlobalMetrics();
  decrementGlobalCountersForWithdraw(
    globalMetrics,
    wasLocked,
    event.block.timestamp
  );
  globalMetrics.save();
}

export function handleBlock(block: ethereum.Block): void {
  const currentTimestamp = block.timestamp;

  const currentWeekStart = getWeekStart(currentTimestamp);
  const WEEK_SECONDS = BigInt.fromI32(7 * 24 * 60 * 60);
  const weekStarts: BigInt[] = [currentWeekStart, currentWeekStart.minus(WEEK_SECONDS)];

  for (let i = 0; i < weekStarts.length; i++) {
    const locks = loadLocksFromWeek(weekStarts[i]);
    if (locks.length == 0) {
      continue;
    }
    const expiredLocks = getExpiredLocks(locks, currentTimestamp);
    if (expiredLocks.length == 0) {
      continue;
    }
    processExpiredLocksBatch(expiredLocks, currentTimestamp);
  }
}

function processExpiredLocksBatch(
  expiredLocks: DepositorLock[],
  currentTimestamp: BigInt
): void {
  let globalMetrics = getOrCreateGlobalMetrics();

  let expiredCount = 0;

  for (let i = 0; i < expiredLocks.length; i++) {
    let lock = expiredLocks[i];

    if (lock.isVeOlasHolder && lock.isLocked) {
      lock = updateDepositorLockForExpiry(lock);

      lock.save();

      expiredCount++;
    }
  }

  if (expiredCount > 0) {
    globalMetrics.activeLockedHolderCount =
      globalMetrics.activeLockedHolderCount - expiredCount;

    globalMetrics.updatedAt = currentTimestamp;

    globalMetrics.save();
  }
}