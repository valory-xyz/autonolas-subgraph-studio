import { BigInt } from "@graphprotocol/graph-ts";
import { Global } from "../generated/schema";

/**
 * Return global entity for updates
 * Create new if doesn't exist
 */
export function getGlobal(): Global {
  let global = Global.load("");
  if (global == null) {
    global = new Global("");
    global.totalTraderAgents = 0;
    global.totalActiveTraderAgents = 0;
    global.totalBets = 0;
    global.totalTraded = BigInt.zero();
    global.totalFees = BigInt.zero();
    global.totalPayout = BigInt.zero();
  }
  return global as Global;
}
