import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  Global,
  TraderAgent,
  MarketParticipant,
  DailyProfitStatistic,
  Question,
  Bet,
  QuestionResolution,
  MarketParticipated,
  PayoutRedemption,
} from "../generated/schema";
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
    global.totalExpectedPayout = BigInt.zero();
    global.totalMarketsParticipated = 0;
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
 * Add profit participant into profit statistic (deduplicated)
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
 * Tracks outcome share positions on MarketParticipant.
 */
export function processTradeActivity(
  agent: TraderAgent,
  conditionId: Bytes,
  betId: Bytes,
  amount: BigInt,
  timestamp: BigInt,
  blockNumber: BigInt,
  txHash: Bytes,
  outcomeIndex: BigInt,
  sharesAmount: BigInt,
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
    participant.question = conditionId;
    participant.totalBets = 0;
    participant.totalTraded = BigInt.zero();
    participant.totalTradedSettled = BigInt.zero();
    participant.totalPayout = BigInt.zero();
    participant.outcomeShares0 = BigInt.zero();
    participant.outcomeShares1 = BigInt.zero();
    participant.expectedPayout = BigInt.zero();
    participant.settled = false;
    participant.createdAt = timestamp;
    participant.bets = [];

    // 3a. Track unique market participation
    let marketActivity = MarketParticipated.load(conditionId);
    if (marketActivity == null) {
      marketActivity = new MarketParticipated(conditionId);
      marketActivity.save();
      global.totalMarketsParticipated += 1;
    }
  }

  let bets = participant.bets;
  bets.push(betId);
  participant.bets = bets;
  participant.totalBets += 1;
  participant.totalTraded = participant.totalTraded.plus(amount);

  // Track outcome share positions (buys add, sells subtract via negative sharesAmount)
  if (outcomeIndex.equals(BigInt.zero())) {
    participant.outcomeShares0 = participant.outcomeShares0.plus(sharesAmount);
  } else {
    participant.outcomeShares1 = participant.outcomeShares1.plus(sharesAmount);
  }

  participant.blockTimestamp = timestamp;
  participant.blockNumber = blockNumber;
  participant.transactionHash = txHash;

  // 4. Save all
  global.save();
  agent.save();
  participant.save();
}

/**
 * Handles market resolution — calculates expectedPayout and profit for ALL participants.
 * All profit/loss is attributed to the resolution day.
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

  // 2. Load question and its participants
  let question = Question.load(conditionId);
  if (question == null) return;

  let participants = question.participants.load();
  if (participants.length == 0) return;

  // 3. Initialize caches and delta accumulators
  let global = getGlobal();
  let agentCache = new Map<string, TraderAgent>();
  let dailyStatsCache = new Map<string, DailyProfitStatistic>();

  let globalTradedSettledDelta = BigInt.zero();
  let globalExpectedPayoutDelta = BigInt.zero();

  let isAnswer0 = winningOutcome.equals(BigInt.zero());
  let isAnswer1 = winningOutcome.equals(BigInt.fromI32(1));
  let TWO = BigInt.fromI32(2);

  // 4. Iterate ALL participants
  for (let i = 0; i < participants.length; i++) {
    let participant = participants[i];

    // Skip already settled (idempotency)
    if (participant.settled) continue;

    let agentId = participant.traderAgent.toHexString();
    let agent = agentCache.has(agentId)
      ? agentCache.get(agentId)!
      : TraderAgent.load(participant.traderAgent);
    if (agent === null) continue;

    // 4a. Calculate expectedPayout from outcome share balances
    let expectedPayout = BigInt.zero();
    if (isAnswer0) {
      let balance = participant.outcomeShares0;
      expectedPayout = balance.gt(BigInt.zero()) ? balance : BigInt.zero();
    } else if (isAnswer1) {
      let balance = participant.outcomeShares1;
      expectedPayout = balance.gt(BigInt.zero()) ? balance : BigInt.zero();
    } else {
      // Invalid answer — each share worth 1/2 collateral
      let b0 = participant.outcomeShares0;
      let b1 = participant.outcomeShares1;
      let payout0 = b0.gt(BigInt.zero()) ? b0.div(TWO) : BigInt.zero();
      let payout1 = b1.gt(BigInt.zero()) ? b1.div(TWO) : BigInt.zero();
      expectedPayout = payout0.plus(payout1);
    }

    // 4b. Calculate settlement amounts and profit
    let amountToSettle = participant.totalTraded.minus(participant.totalTradedSettled);
    let profit = expectedPayout.minus(amountToSettle);

    // 4c. Update participant
    participant.expectedPayout = expectedPayout;
    participant.totalTradedSettled = participant.totalTraded;
    participant.settled = true;
    participant.save();

    // 4d. Update agent (via cache)
    agent.totalTradedSettled = agent.totalTradedSettled.plus(amountToSettle);
    agent.totalExpectedPayout = agent.totalExpectedPayout.plus(expectedPayout);
    agentCache.set(agentId, agent);

    // 4e. Update daily stat (via cache)
    let statId = agentId + "_" + getDayTimestamp(event.block.timestamp).toString();
    let dailyStat = dailyStatsCache.has(statId)
      ? dailyStatsCache.get(statId)!
      : getDailyProfitStatistic(participant.traderAgent, event.block.timestamp);

    dailyStat.dailyProfit = dailyStat.dailyProfit.plus(profit);
    addProfitParticipant(dailyStat, conditionId);
    dailyStatsCache.set(statId, dailyStat);

    // 4f. Accumulate global deltas
    globalTradedSettledDelta = globalTradedSettledDelta.plus(amountToSettle);
    globalExpectedPayoutDelta = globalExpectedPayoutDelta.plus(expectedPayout);

    // 4g. Mark individual bets as counted
    let betIds = participant.bets;
    for (let j = 0; j < betIds.length; j++) {
      let bet = Bet.load(betIds[j]);
      if (bet !== null && !bet.countedInProfit) {
        bet.countedInProfit = true;
        bet.countedInTotal = true;
        bet.save();
      }
    }
  }

  // 5. Batch save cached entities
  saveMapValues(agentCache);
  saveMapValues(dailyStatsCache);

  // 6. Apply global deltas
  if (!globalTradedSettledDelta.equals(BigInt.zero())) {
    global.totalTradedSettled = global.totalTradedSettled.plus(globalTradedSettledDelta);
  }
  if (!globalExpectedPayoutDelta.equals(BigInt.zero())) {
    global.totalExpectedPayout = global.totalExpectedPayout.plus(globalExpectedPayoutDelta);
  }
  global.save();
}

/**
 * Handles payout redemption — only tracks actual payouts claimed.
 * No profit calculation (that's done at resolution time).
 * Creates immutable PayoutRedemption entity for debugging.
 */
export function processRedemption(
  redeemer: Bytes,
  conditionId: Bytes,
  payoutAmount: BigInt,
  timestamp: BigInt,
  blockNumber: BigInt,
  txHash: Bytes,
  logIndex: i32,
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

  // 3. Create immutable PayoutRedemption entity
  let logEntity = new PayoutRedemption(txHash.concat(Bytes.fromI32(logIndex)));
  logEntity.redeemer = redeemer;
  logEntity.conditionId = conditionId;
  logEntity.question = conditionId;
  logEntity.payoutAmount = payoutAmount;
  logEntity.blockNumber = blockNumber;
  logEntity.blockTimestamp = timestamp;
  logEntity.transactionHash = txHash;
  logEntity.save();

  // 4. Update Payout Totals (NO profit calculation)
  agent.totalPayout = agent.totalPayout.plus(payoutAmount);
  participant.totalPayout = participant.totalPayout.plus(payoutAmount);
  global.totalPayout = global.totalPayout.plus(payoutAmount);

  // 5. Update Daily Statistics (only payout, NO dailyProfit change)
  let dailyStat = getDailyProfitStatistic(redeemer, timestamp);
  dailyStat.totalPayout = dailyStat.totalPayout.plus(payoutAmount);

  // 6. Save
  agent.save();
  participant.save();
  global.save();
  dailyStat.save();
}
