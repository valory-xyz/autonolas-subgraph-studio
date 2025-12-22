import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Global, TraderAgent, MarketParticipant, DailyProfitStatistic } from "../generated/schema";
import { ONE_DAY } from "./constants";

/**
 * Track agent activity (first and latest participation) and total agent bets
 * */
export function updateTraderAgentActivity(address: Address, blockTimestamp: BigInt): void {
  let agent = TraderAgent.load(address);
  if (agent !== null) {
    if (agent.firstParticipation === null) {
      agent.firstParticipation = blockTimestamp;
      let global = getGlobal();
      global.totalActiveTraderAgents += 1;
      global.save();
    }

    agent.totalBets += 1;
    agent.lastActive = blockTimestamp;
    agent.save();
  }
}

/**
 * Track payment for market in case of won bet
 **/
export function updateTraderAgentPayout(address: Address, payout: BigInt): void {
  let agent = TraderAgent.load(address);
  if (agent !== null) {
    agent.totalPayout = agent.totalPayout.plus(payout);
    agent.save();
  }
}

/**
 * Track activity of each participant of a market (all done bets)
 * Traded and fees are updated on market settlement (log new anser)
 * Payouts are added separately if won
 **/
export function updateMarketParticipantActivity(
  trader: Address,
  market: Address,
  betId: string,
  blockTimestamp: BigInt,
  blockNumber: BigInt,
  txHash: Bytes
): void {
  let participantId = trader.toHexString() + "_" + market.toHexString();
  let participant = MarketParticipant.load(participantId);
  if (participant == null) {
    participant = new MarketParticipant(participantId);
    participant.traderAgent = trader;
    participant.fixedProductMarketMaker = market;
    participant.totalBets = 0;
    participant.totalTraded = BigInt.zero();
    participant.totalPayout = BigInt.zero();
    participant.totalFees = BigInt.zero();
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
 * Update market participant payout in case of winning
 **/
export function updateMarketParticipantPayout(trader: Address, market: Bytes, payout: BigInt): void {
  let participantId = trader.toHexString() + "_" + market.toHexString();
  let participant = MarketParticipant.load(participantId);
  if (participant != null) {
    participant.totalPayout = participant.totalPayout.plus(payout);
    participant.save();
  }
}

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
 * Increase total bets in global entity
 */
export function incrementGlobalTotalBets(): void {
  let global = getGlobal();
  global.totalBets += 1;
  global.save();
}

/**
 * Update total payout in global entity
 * Should be used only for payouts for our markets
 */
export function updateGlobalPayout(payout: BigInt): void {
  let global = getGlobal();
  global.totalPayout = global.totalPayout.plus(payout);
  global.save();
}

/**
 * Get the timestamp for the start of the day (UTC midnight)
 */
function getDayTimestamp(timestamp: BigInt): BigInt {
  return timestamp.div(ONE_DAY).times(ONE_DAY);
}

export function bytesToBigInt(bytes: Bytes): BigInt {
  let reversed = Bytes.fromUint8Array(bytes.slice().reverse());
  return BigInt.fromUnsignedBytes(reversed);
}

/**
 * Get daily profit entity
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
