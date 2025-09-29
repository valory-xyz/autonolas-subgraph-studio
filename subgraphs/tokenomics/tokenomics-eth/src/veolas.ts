import { BigInt, store } from "@graphprotocol/graph-ts";
import { Deposit, Withdraw } from "../generated/veOLAS/veOLAS";
import { Global, VeolasDepositor } from "../generated/schema";

const BIGINT_ZERO = BigInt.fromI32(0);

function getOrCreateGlobalStats(): Global {
  let stats = Global.load("");

  if (stats == null) {
    stats = new Global("");
    stats.veolasHolderCount = 0;
    stats.updatedAt = BIGINT_ZERO;
  }

  return stats;
}

export function handleDeposit(event: Deposit): void {
  let depositor = VeolasDepositor.load(event.params.account);
  let isNewDepositor = false;

  if (depositor == null) {
    depositor = new VeolasDepositor(event.params.account);
    isNewDepositor = true;
  }

  depositor.unlockTimestamp = event.params.locktime;
  depositor.save();

  let stats = getOrCreateGlobalStats();
  if (isNewDepositor) {
    stats.veolasHolderCount = stats.veolasHolderCount + 1;
  }
  stats.updatedAt = event.block.timestamp;
  stats.save();
}

export function handleWithdraw(event: Withdraw): void {
  let depositor = VeolasDepositor.load(event.params.account);
  if (depositor != null) {
    store.remove("VeolasDepositor", event.params.account.toHexString());
    let stats = getOrCreateGlobalStats();
    stats.veolasHolderCount = stats.veolasHolderCount - 1;
    stats.updatedAt = event.block.timestamp;
    stats.save();
  }
} 