import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Global, TraderAgent, MarketParticipant, DailyProfitStatistic, Question, Bet, QuestionResolution } from "../generated/schema";
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
    global.totalTradedSettled = BigInt.zero();
    global.totalPayout = BigInt.zero();
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

/**
 * Get or create daily profit statistic for an agent on a specific day
 */
export function getDailyProfitStatistic(
  agentAddress: Bytes,
  timestamp: BigInt
): DailyProfitStatistic {
  let dayTimestamp = getDayTimestamp(timestamp);
  let id = agentAddress.toHexString() + "_" + dayTimestamp.toString();
  let statistic = DailyProfitStatistic.load(id);

  if (statistic == null) {
    statistic = new DailyProfitStatistic(id);
    statistic.traderAgent = agentAddress;
    statistic.date = dayTimestamp;
    statistic.totalBets = 0;
    statistic.totalTraded = BigInt.zero();
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
export function addProfitParticipant(
  statistic: DailyProfitStatistic,
  questionId: Bytes
): void {
  let participants = statistic.profitParticipants;
  if (participants.indexOf(questionId) == -1) {
    participants.push(questionId);
    statistic.profitParticipants = participants;
  }
}

/**
 * Consolidates all activity and volume updates into a single pass.
 */
export function processTradeActivity(
  agent: TraderAgent,
  conditionId: Bytes,
  betId: Bytes,
  amount: BigInt,
  timestamp: BigInt,
  blockNumber: BigInt,
  txHash: Bytes
): void {
  let global = getGlobal();

  // 1. Update Global
  global.totalBets += 1;
  global.totalTraded = global.totalTraded.plus(amount);

  // 2. Update TraderAgent
  if (agent.firstParticipation === null) {
    agent.firstParticipation = timestamp;
    global.totalActiveTraderAgents += 1;
  }
  agent.totalBets += 1;
  agent.lastActive = timestamp;
  agent.totalTraded = agent.totalTraded.plus(amount);

  // 3. Update or Create MarketParticipant
  let participantId = agent.id.toHexString() + "_" + conditionId.toHexString();
  let participant = MarketParticipant.load(participantId);
  
  if (participant == null) {
    participant = new MarketParticipant(participantId);
    participant.traderAgent = agent.id;
    participant.question = conditionId; // Polymarket uses 'question' as the field name
    participant.totalBets = 0;
    participant.totalTraded = BigInt.zero();
    participant.totalTradedSettled = BigInt.zero();
    participant.totalPayout = BigInt.zero();
    participant.createdAt = timestamp;
    participant.bets = [];
  }

  let bets = participant.bets;
  bets.push(betId);
  participant.bets = bets;
  participant.totalBets += 1;
  participant.totalTraded = participant.totalTraded.plus(amount);
  participant.blockTimestamp = timestamp;
  participant.blockNumber = blockNumber;
  participant.transactionHash = txHash;

  // 4. Save all
  global.save();
  agent.save();
  participant.save();
}

/**
 * Handles market resolution
 * Updates totalSettleds for loosing bets
 */
export function processMarketResolution(
  conditionId: Bytes,
  winningOutcome: BigInt,
  settledPrice: BigInt,
  payouts: BigInt[],
  event: ethereum.Event
): void {
  // 1. Create the Resolution entity
  let resolution = new QuestionResolution(conditionId);
  resolution.question = conditionId;
  resolution.winningIndex = winningOutcome;
  resolution.settledPrice = settledPrice;
  resolution.payouts = payouts;
  resolution.blockNumber = event.block.number;
  resolution.blockTimestamp = event.block.timestamp;
  resolution.transactionHash = event.transaction.hash;
  resolution.save();

  // 2. Process Totals using Caching
  let global = getGlobal();
  let agentCache = new Map<string, TraderAgent>();
  let participantCache = new Map<string, MarketParticipant>();
  let dailyStatsCache = new Map<string, DailyProfitStatistic>();

  let question = Question.load(conditionId);
  if (question == null) return;

  let bets = question.bets.load();
  for (let i = 0; i < bets.length; i++) {
    let bet = bets[i];
    let agentId = bet.bettor.toHexString();

    let agent = agentCache.has(agentId) ? agentCache.get(agentId)! : TraderAgent.load(bet.bettor);
    if (agent === null) continue;

    // Settle losses: Only if there is a clear winner (0 or 1) and this bet was on a different index
    if (winningOutcome.ge(BigInt.zero()) && !bet.outcomeIndex.equals(winningOutcome)) {
      
      // Update Settlement Totals
      if (!bet.countedInTotal) {
        agent.totalTradedSettled = agent.totalTradedSettled.plus(bet.amount);
        global.totalTradedSettled = global.totalTradedSettled.plus(bet.amount);

        let participantId = agentId + "_" + conditionId.toHexString();
        let participant = participantCache.has(participantId) ? participantCache.get(participantId)! : MarketParticipant.load(participantId);
        if (participant != null) {
          participant.totalTradedSettled = participant.totalTradedSettled.plus(bet.amount);
          participantCache.set(participantId, participant);
        }
        bet.countedInTotal = true;
      }

      // Update Daily Statistics (Record the Loss)
      if (!bet.countedInProfit) {
        let statId = agentId + "_" + getDayTimestamp(event.block.timestamp).toString();
        let dailyStat = dailyStatsCache.has(statId) ? dailyStatsCache.get(statId)! : getDailyProfitStatistic(bet.bettor, event.block.timestamp);

        dailyStat.dailyProfit = dailyStat.dailyProfit.minus(bet.amount);
        addProfitParticipant(dailyStat, conditionId);
        dailyStatsCache.set(statId, dailyStat);
        bet.countedInProfit = true;
      }

      agentCache.set(agentId, agent);
      bet.save();
    }
  }

  saveMapValues(agentCache);
  saveMapValues(participantCache);
  saveMapValues(dailyStatsCache);
  global.save();
}

/**
 * Handles payout redemption when an agent claims winnings
 * Updates totalSettleds and payout for winning bets
 */
export function processRedemption(
  redeemer: Bytes,
  conditionId: Bytes,
  payoutAmount: BigInt,
  timestamp: BigInt,
): void {
  // 1. Validation: Only process if it's one of our agents
  let agent = TraderAgent.load(redeemer);
  if (agent == null) return;

  // 2. Validation: Only process if it's a market we track
  let question = Question.load(conditionId);
  if (question == null) return;

  let participantId = redeemer.toHexString() + "_" + conditionId.toHexString();
  let participant = MarketParticipant.load(participantId);
  if (participant == null) return;

  let global = getGlobal();

  // 3. Identify the amount that needs to be moved to 'Settled'
  let amountToSettle = participant.totalTraded.minus(participant.totalTradedSettled);

  if (amountToSettle.gt(BigInt.zero())) {
    agent.totalTradedSettled = agent.totalTradedSettled.plus(amountToSettle);
    participant.totalTradedSettled = participant.totalTradedSettled.plus(amountToSettle);
    global.totalTradedSettled = global.totalTradedSettled.plus(amountToSettle);
  }

  // 4. Update Payout Totals
  agent.totalPayout = agent.totalPayout.plus(payoutAmount);
  participant.totalPayout = participant.totalPayout.plus(payoutAmount);
  global.totalPayout = global.totalPayout.plus(payoutAmount);

  // 5. Update Bets
  let betIds = participant.bets;
  for (let i = 0; i < betIds.length; i++) {
    let bet = Bet.load(betIds[i]);
    if (bet !== null && !bet.countedInProfit) {
      bet.countedInProfit = true;
      bet.countedInTotal = true; 
      bet.save();
    }
  }

  // 6. Update Daily Statistics
  let dailyStat = getDailyProfitStatistic(redeemer, timestamp);
  dailyStat.totalPayout = dailyStat.totalPayout.plus(payoutAmount);
  dailyStat.dailyProfit = dailyStat.dailyProfit.plus(payoutAmount.minus(amountToSettle));
  addProfitParticipant(dailyStat, conditionId);

  // 7. Save
  agent.save();
  participant.save();
  global.save();
  dailyStat.save();
}
