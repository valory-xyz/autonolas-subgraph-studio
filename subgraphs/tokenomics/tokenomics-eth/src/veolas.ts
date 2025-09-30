import { BigInt } from "@graphprotocol/graph-ts";
import { Deposit, Withdraw } from "../generated/veOLAS/veOLAS";
import { Global, VeolasDepositor } from "../generated/schema";

function getOrCreateGlobalStats(): Global {
  let stats = Global.load("");

  if (stats == null) {
    stats = new Global("");
    stats.veolasHolderCount = 0;
    stats.updatedAt = BigInt.zero();
  }

  return stats;
}

export function handleDeposit(event: Deposit): void {
  let depositor = VeolasDepositor.load(event.params.account);
  const isNewDepositor = depositor == null;
  const wasInactive = depositor !== null && !depositor.isActive;

  if (depositor == null) {
    depositor = new VeolasDepositor(event.params.account);
  }

  depositor.unlockTimestamp = event.params.locktime;
  depositor.isActive = true;
  depositor.save();

  if (isNewDepositor || wasInactive) {
    let stats = getOrCreateGlobalStats();
    stats.veolasHolderCount = stats.veolasHolderCount + 1;
    stats.updatedAt = event.block.timestamp;
    stats.save();
  }
}

export function handleWithdraw(event: Withdraw): void {
  let depositor = VeolasDepositor.load(event.params.account);
  if (depositor != null && depositor.isActive) {
    depositor.isActive = false;
    depositor.save();

    let stats = getOrCreateGlobalStats();
    stats.veolasHolderCount = stats.veolasHolderCount - 1;
    stats.updatedAt = event.block.timestamp;
    stats.save();
  }
}