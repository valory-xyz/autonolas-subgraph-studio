import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import { Global, TraderAgent, MarketParticipant } from "../generated/schema";

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
    global.totalTradedSettled = BigInt.zero();
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

/**
 * Convert bytes to BigInt (needed for UMA answer comparison)
 */
export function bytesToBigInt(bytes: Bytes): BigInt {
  let reversed = Bytes.fromUint8Array(bytes.slice().reverse());
  return BigInt.fromUnsignedBytes(reversed);
}

/**
 * Helper for saving entities in maps (batch save optimization)
 */
export function saveMapValues<T>(map: Map<string, T>): void {
  let values = map.values();
  // @ts-ignore - AssemblyScript Map.values() returns array-like structure
  for (let i = 0; i < values.length; i++) {
    // @ts-ignore - Graph-cli entities have a .save() method
    values[i].save();
  }
}

/**
 * Update agent payout when they redeem winnings
 */
export function updateTraderAgentPayout(address: Address, payout: BigInt): void {
  let agent = TraderAgent.load(address);
  if (agent !== null) {
    agent.totalPayout = agent.totalPayout.plus(payout);
    agent.save();
  }
}

/**
 * Update global payout total
 */
export function updateGlobalPayout(payout: BigInt): void {
  let global = getGlobal();
  global.totalPayout = global.totalPayout.plus(payout);
  global.save();
}

/**
 * Track activity of each participant in a market
 * Called when a bet is placed
 */
export function updateMarketParticipantActivity(
  trader: Address,
  conditionId: Bytes,
  betId: string,
  blockTimestamp: BigInt,
  blockNumber: BigInt,
  txHash: Bytes
): void {
  let participantId = trader.toHexString() + "_" + conditionId.toHexString();
  let participant = MarketParticipant.load(participantId);
  if (participant == null) {
    participant = new MarketParticipant(participantId);
    participant.traderAgent = trader;
    participant.question = conditionId;
    participant.totalBets = 0;
    participant.totalTraded = BigInt.zero();
    participant.totalTradedSettled = BigInt.zero();
    participant.totalFees = BigInt.zero();
    participant.totalPayout = BigInt.zero();
    participant.createdAt = blockTimestamp;
    participant.bets = [];
  }
  let bets = participant.bets;
  bets.push(betId);
  participant.bets = bets;
  participant.totalBets += 1;
  participant.blockTimestamp = blockTimestamp;
  participant.blockNumber = blockNumber;
  participant.transactionHash = txHash;
  participant.save();
}

/**
 * Update market participant payout when they win
 */
export function updateMarketParticipantPayout(trader: Address, conditionId: Bytes, payout: BigInt): void {
  let participantId = trader.toHexString() + "_" + conditionId.toHexString();
  let participant = MarketParticipant.load(participantId);
  if (participant != null) {
    participant.totalPayout = participant.totalPayout.plus(payout);
    participant.save();
  }
}
