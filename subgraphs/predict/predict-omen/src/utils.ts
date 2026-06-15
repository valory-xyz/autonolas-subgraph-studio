import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Global, TraderAgent, MarketParticipant, DailyProfitStatistic } from "../generated/schema";
import { ONE_DAY } from "./constants";

// 1e18 — fixed-point scale for impliedProbability and Brier sum.
export const PROBABILITY_SCALE = BigInt.fromString("1000000000000000000");
// 5e17 — half scale, used as the "actual" for invalid-answer markets where payouts are [1, 1].
export const HALF_PROBABILITY_SCALE = BigInt.fromString("500000000000000000");

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
    global.totalExpectedPayout = BigInt.zero();
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
    statistic.dailyTradedSettled = BigInt.zero();
    statistic.dailyFeesSettled = BigInt.zero();
    statistic.dailyProfit = BigInt.zero();
    statistic.brierSum = BigInt.zero();
    statistic.brierCount = 0;

    statistic.profitParticipants = [];
  }
  return statistic as DailyProfitStatistic;
}

/**
 * Implied probability for a trade: amount / outcomeTokenAmount, 1e18-scaled.
 *
 * Expected range: [0, PROBABILITY_SCALE] (i.e. [0, 1e18]). FPMM invariants guarantee
 * the trade price is in [0, 1] collateral per outcome token:
 *   - Buy:  outcomeTokensBought >= investmentAmount (per-token cost ≤ 1)
 *   - Sell: outcomeTokensSold   >= returnAmount     (per-token return ≤ 1)
 * so the ratio cannot exceed 1e18 for any well-formed FPMM trade. No explicit clamp:
 * if the invariant is ever violated upstream we want it to surface, not get masked.
 *
 * Returns zero when the denominator is zero (degenerate — should not happen for valid trades).
 * Brier aggregation skips zero-probability bets.
 */
export function computeImpliedProbability(amount: BigInt, outcomeTokenAmount: BigInt): BigInt {
  if (outcomeTokenAmount.equals(BigInt.zero())) {
    return BigInt.zero();
  }
  return amount.times(PROBABILITY_SCALE).div(outcomeTokenAmount);
}

/**
 * Brier contribution for a single bet, 1e18-scaled. `actual` is in the same 1e18 scale
 * (0, 5e17, or 1e18). Returned value is ((p - actual)^2) / 1e18, in [0, 1e18].
 */
export function brierContribution(impliedProbability: BigInt, actual: BigInt): BigInt {
  let diff = impliedProbability.minus(actual);
  return diff.times(diff).div(PROBABILITY_SCALE);
}

/**
 * Resolve the per-bet `actual` (1e18-scaled) for a given market outcome.
 * Invalid answers use 0.5 (half-scale) per the [1, 1] payout split.
 */
export function actualForOutcome(betOutcomeIndex: BigInt, winningOutcome: BigInt, isInvalid: boolean): BigInt {
  if (isInvalid) {
    return HALF_PROBABILITY_SCALE;
  }
  if (betOutcomeIndex.equals(winningOutcome)) {
    return PROBABILITY_SCALE;
  }
  return BigInt.zero();
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

export function removeProfitParticipant(statistic: DailyProfitStatistic, marketId: Bytes): void {
  let participants = statistic.profitParticipants;
  let index = participants.indexOf(marketId);
  if (index !== -1) {
    participants.splice(index, 1);
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
  txHash: Bytes,
  outcomeIndex: BigInt,
  outcomeTokenAmount: BigInt
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
    participant.outcomeTokenBalance0 = BigInt.zero();
    participant.outcomeTokenBalance1 = BigInt.zero();
    participant.expectedPayout = BigInt.zero();
    participant.brierSumApplied = BigInt.zero();
    participant.brierCountApplied = 0;
    participant.settled = false;
    participant.createdAt = timestamp;
    participant.bets = [];
  }

  let bets = participant.bets;
  bets.push(betId);
  participant.bets = bets;
  participant.totalBets += 1;
  participant.totalTraded = participant.totalTraded.plus(amount);
  participant.totalFees = participant.totalFees.plus(fees);
  if (outcomeIndex.equals(BigInt.zero())) {
    participant.outcomeTokenBalance0 = participant.outcomeTokenBalance0.plus(outcomeTokenAmount);
  } else {
    participant.outcomeTokenBalance1 = participant.outcomeTokenBalance1.plus(outcomeTokenAmount);
  }
  participant.blockTimestamp = timestamp;
  participant.blockNumber = blockNumber;
  participant.transactionHash = txHash;

  // 4. Save all
  global.save();
  agent.save();
  participant.save();
}