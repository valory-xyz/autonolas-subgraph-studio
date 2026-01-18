import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Global, TraderAgent } from "../generated/schema";

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

/**
 * Track agent activity (first and latest participation)
 * Updates global active agent count on first participation
 */
export function updateTraderAgentActivity(
  address: Bytes,
  blockTimestamp: BigInt
): void {
  let agent = TraderAgent.load(address);
  if (agent !== null) {
    // First participation check
    if (agent.firstParticipation === null) {
      agent.firstParticipation = blockTimestamp;

      // Increment global active agent counter
      let global = getGlobal();
      global.totalActiveTraderAgents += 1;
      global.save();
    }

    // Always update last active
    agent.lastActive = blockTimestamp;
    agent.save();
  }
}
