import { BigInt } from "@graphprotocol/graph-ts";
import { Deposit, Withdraw } from "../generated/veOLAS/veOLAS";
import { VeolasDepositor } from "../generated/schema";
import { ethereum } from "@graphprotocol/graph-ts";
import {
  loadOrCreateDepositorLock,
  updateDepositorLockForDeposit,
  incrementGlobalCountersForDeposit,
  updateDepositorLockForWithdraw,
  decrementGlobalCountersForWithdraw,
  getWeekStart,
  loadLocksFromWeek,
  getExpiredLocks,
  WEEK_SECONDS,
  processExpiredLocks,
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

  const becameLocked = depositorLock.isLocked && !wasLocked;
  incrementGlobalCountersForDeposit(
    wasInactive,
    becameLocked,
    event.block.timestamp
  );
}

export function handleWithdraw(event: Withdraw): void {
  let depositor = VeolasDepositor.load(event.params.account);
  if (depositor != null && depositor.isVeOlasHolder) {
    depositor.isVeOlasHolder = false;
    depositor.save();
  }

  let depositorLock = loadOrCreateDepositorLock(event.params.account);
  const wasLocked = depositorLock.isLocked;

  depositorLock = updateDepositorLockForWithdraw(depositorLock);

  depositorLock.save();

  decrementGlobalCountersForWithdraw(
    wasLocked,
    event.block.timestamp
  );
}

export function handleBlock(block: ethereum.Block): void {
  const currentTimestamp = block.timestamp;

  const currentWeekStart = getWeekStart(currentTimestamp);
  const weekStarts: BigInt[] = [currentWeekStart, currentWeekStart.minus(WEEK_SECONDS)];

  for (let i = 0; i < weekStarts.length; i++) {
    const locks = loadLocksFromWeek(weekStarts[i]);
    if (locks.length == 0) {
      continue;
    }
    const expiredLocks = getExpiredLocks(locks, currentTimestamp);
    processExpiredLocks(expiredLocks, currentTimestamp);
  }
}