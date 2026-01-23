import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Global, TraderAgent, MarketParticipant, DailyProfitStatistic } from "../generated/schema";
import { ONE_DAY } from "./constants";

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
    global.totalTradedSettled = BigInt.zero();
    global.totalFeesSettled = BigInt.zero();
  }
  return global as Global;
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
 * Get the timestamp for the start of the day (UTC midnight)
 */
export function getDayTimestamp(timestamp: BigInt): BigInt {
  return timestamp.div(ONE_DAY).times(ONE_DAY);
}

export function bytesToBigInt(bytes: Bytes): BigInt {
  let reversed = Bytes.fromUint8Array(bytes.slice().reverse());
  return BigInt.fromUnsignedBytes(reversed);
}

/**
 * Get or create daily profit statistic for an agent on a specific day
 */
export function getDailyProfitStatistic(agentAddress: Bytes, timestamp: BigInt): DailyProfitStatistic {
  let dayTimestamp = getDayTimestamp(timestamp);
  let id = agentAddress.toHexString() + "_" + dayTimestamp.toString();
  let statistic = DailyProfitStatistic.load(id);

  if (statistic == null) {
    statistic = new DailyProfitStatistic(id);
    statistic.traderAgent = agentAddress;
    statistic.date = dayTimestamp;
    statistic.totalBets = 0;
    statistic.totalTraded = BigInt.zero();
    statistic.totalFees = BigInt.zero();
    statistic.totalPayout = BigInt.zero();
    statistic.dailyProfit = BigInt.zero();

    statistic.profitParticipants = [];
  }
  return statistic as DailyProfitStatistic;
}

/**
 * add profit participant into profit statistic
 * should be called when profit changes:
 * - on market settlement if bets were incorrect
 * - on payout if bets were correct
 */
export function addProfitParticipant(statistic: DailyProfitStatistic, marketId: Bytes): void {
  let participants = statistic.profitParticipants;
  if (participants.indexOf(marketId) == -1) {
    participants.push(marketId);
    statistic.profitParticipants = participants;
  }
}

/**
 * Consolidates all activity and volume updates into a single pass.
 */
export function processTradeActivity(
  agent: TraderAgent,
  market: Address,
  betId: string,
  amount: BigInt,
  fees: BigInt,
  timestamp: BigInt,
  blockNumber: BigInt,
  txHash: Bytes
): void {
  let global = getGlobal();

  // 1. Update Global
  global.totalBets += 1;
  global.totalTraded = global.totalTraded.plus(amount);
  global.totalFees = global.totalFees.plus(fees);

  // 2. Update TraderAgent
  if (agent.firstParticipation === null) {
    agent.firstParticipation = timestamp;
    global.totalActiveTraderAgents += 1;
  }
  agent.totalBets += 1;
  agent.lastActive = timestamp;
  agent.totalTraded = agent.totalTraded.plus(amount);
  agent.totalFees = agent.totalFees.plus(fees);

  // 3. Update or Create MarketParticipant
  let participantId = agent.id.toHexString() + "_" + market.toHexString();
  let participant = MarketParticipant.load(participantId);
  
  if (participant == null) {
    participant = new MarketParticipant(participantId);
    participant.traderAgent = agent.id;
    participant.fixedProductMarketMaker = market;
    participant.totalBets = 0;
    participant.totalTraded = BigInt.zero();
    participant.totalPayout = BigInt.zero();
    participant.totalFees = BigInt.zero();
    participant.totalTradedSettled = BigInt.zero();
    participant.totalFeesSettled = BigInt.zero();
    participant.createdAt = timestamp;
    participant.bets = [];
  }

  let bets = participant.bets;
  bets.push(betId);
  participant.bets = bets;
  participant.totalBets += 1;
  participant.totalTraded = participant.totalTraded.plus(amount);
  participant.totalFees = participant.totalFees.plus(fees);
  participant.blockTimestamp = timestamp;
  participant.blockNumber = blockNumber;
  participant.transactionHash = txHash;

  // 4. Save all
  global.save();
  agent.save();
  participant.save();
}