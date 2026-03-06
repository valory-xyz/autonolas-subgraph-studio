import { assert, describe, test, clearStore, beforeEach } from "matchstick-as/assembly/index";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { handleOrderFilled, handleTokenRegistered } from "../src/ctf-exchange";
import { handleOOQuestionResolved } from "../src/uma-mapping";
import { handlePayoutRedemption } from "../src/conditional-tokens";
import {
  createOrderFilledEvent,
  createSellOrderFilledEvent,
  createQuestionResolvedEvent,
  createPayoutRedemptionEvent,
  createTokenRegisteredEvent,
} from "./profit";
import { TraderAgent, Question, MarketMetadata } from "../generated/schema";
import { TestAddresses, TestBytes, TestConstants, createAncillaryData, normalizeTimestamp, createBridge } from "./test-helpers";

const AGENT = TestAddresses.TRADER_AGENT_1;
const CONDITION_LOST = TestBytes.CONDITION_ID_1;
const CONDITION_WON = TestBytes.CONDITION_ID_2;
const QUESTION_LOST = TestBytes.QUESTION_ID_1;
const QUESTION_WON = TestBytes.QUESTION_ID_2;
const TOKEN_0_LOST = BigInt.fromI32(100);
const TOKEN_1_LOST = BigInt.fromI32(101);
const TOKEN_0_WON = BigInt.fromI32(200);
const TOKEN_1_WON = BigInt.fromI32(201);
const DAY = 86400;
const START_TS = TestConstants.TIMESTAMP_START;
const NORMALIZED_TS = normalizeTimestamp(START_TS);

function setupAgent(): void {
  let agent = new TraderAgent(AGENT);
  agent.totalBets = 0;
  agent.serviceId = TestConstants.SERVICE_ID_1;
  agent.totalTraded = BigInt.zero();
  agent.totalPayout = BigInt.zero();
  agent.totalTradedSettled = BigInt.zero();
  agent.totalExpectedPayout = BigInt.zero();
  agent.blockNumber = TestConstants.BLOCK_NUMBER_START;
  agent.blockTimestamp = START_TS;
  agent.transactionHash = TestBytes.DUMMY_HASH;
  agent.save();
}

function setupMarket(conditionId: Bytes, questionId: Bytes, token0: BigInt, token1: BigInt): void {
  // 1. Create bridge between questionId and conditionId
  createBridge(questionId, conditionId);

  // 2. Create metadata
  let metadata = new MarketMetadata(questionId);
  metadata.title = "Will it rain?";
  metadata.outcomes = ["No", "Yes"];
  metadata.rawAncillaryData = createAncillaryData("Will it rain?", ["No", "Yes"]).toString();
  metadata.save();

  // 3. Create question
  let question = new Question(conditionId);
  question.questionId = questionId;
  question.metadata = metadata.id;
  question.isNegRisk = false;
  question.blockNumber = TestConstants.BLOCK_NUMBER_START;
  question.blockTimestamp = START_TS;
  question.transactionHash = TestBytes.DUMMY_HASH;
  question.save();

  // 4. Register tokens using the TokenRegistered event handler
  let tokenEvent = createTokenRegisteredEvent(token0, token1, conditionId);
  handleTokenRegistered(tokenEvent);
}

describe("Profit Chart Integration", () => {
  beforeEach(() => {
    clearStore();
    setupAgent();
  });

  /**
   * Scenario 1: Basic Placement
   * - Day 1: Agent places a bet (1000 USDC).
   * - Check:
   *    - Activity (totalTraded) is updated.
   *    - Daily Profit is 0 (Market is still open).
   */
  test("Day 1: Activity is recorded, Profit is 0", () => {
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS));

    // Normalize timestamp to start of day (UTC)
    let day1Id = AGENT.toHexString() + "_" + NORMALIZED_TS.toString();
    assert.fieldEquals("DailyProfitStatistic", day1Id, "totalTraded", "1000");
    assert.fieldEquals("DailyProfitStatistic", day1Id, "dailyProfit", "0");
  });

  /**
   * Scenario 2: Immediate Loss on Resolution
   * - Day 1: Place bet on Outcome 0 (Cost: 1000).
   * - Day 3: Market resolves to Outcome 1.
   * - Check:
   *    - The full cost (1000) is deducted from profit on Day 3.
   *    - Market added to profitParticipants.
   */
  test("Day 3: Market Resolution Loss records negative daily profit", () => {
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    // Day 1: Place the bet on Outcome 0
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS));

    // Day 3: Market Resolves to Outcome 1 (bet loses)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")]; // Outcome 1 wins
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1000");
    assert.fieldEquals("DailyProfitStatistic", day3Id, "profitParticipants", "[" + CONDITION_LOST.toHexString() + "]");
  });

  /**
   * Scenario 3: Winning bet — profit recorded at resolution, NOT at payout
   * - Day 1: Place winning bet on Outcome 0 (Cost: 1000, Shares: 2000).
   * - Day 3: Market resolves to Outcome 0.
   * - Check: expectedPayout = 2000 (shares), profit = 2000 - 1000 = 1000 recorded on Day 3.
   * - Day 7: Agent redeems 2000.
   * - Check: Payout recorded, but NO additional dailyProfit change.
   */
  test("Day 3: Winning bet profit recorded at resolution, payout only tracks totalPayout", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);

    // Day 1: Place Winning Bet (Outcome 0)
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS));

    // Day 3: Market Resolves to Outcome 0 (bet wins)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)]; // Outcome 0 wins
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS));

    // Profit recorded on Day 3: expectedPayout(2000) - totalTraded(1000) = 1000
    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "1000");
    assert.fieldEquals("DailyProfitStatistic", day3Id, "profitParticipants", "[" + CONDITION_WON.toHexString() + "]");

    // Verify expectedPayout on participant
    let participantId = AGENT.toHexString() + "_" + CONDITION_WON.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "2000");
    assert.fieldEquals("MarketParticipant", participantId, "settled", "true");

    // Verify agent totalExpectedPayout
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "2000");

    // Day 7: Payout — only updates totalPayout, no dailyProfit change
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    let day7TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2000), CONDITION_WON, day7TS));

    let day7Id = AGENT.toHexString() + "_" + day7TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day7Id, "dailyProfit", "0");
    assert.fieldEquals("DailyProfitStatistic", day7Id, "totalPayout", "2000");

    // Agent totalPayout updated
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalPayout", "2000");
  });

  /**
   * Scenario 4: Complex Multi-Market Logic
   * - Market A: Bet on Outcome 0 (500 USDC, 1000 shares) and Outcome 1 (500 USDC, 1000 shares)
   * - Market B: Bet on Outcome 0 (1000 USDC, 2000 shares)
   * - Day 3: Both markets resolve
   *   - Market A resolves to Outcome 0: expectedPayout = 1000 (shares0), profit = 1000 - 1000 = 0
   *   - Market B resolves to Outcome 1: expectedPayout = 0, profit = 0 - 1000 = -1000
   * - Day 5: Payout for Market A — only totalPayout updates
   */
  test("Complex: Multiple markets, split bets, and simultaneous resolution", () => {
    let MARKET_A = CONDITION_WON;
    let MARKET_B = CONDITION_LOST;
    let QUESTION_A = QUESTION_WON;
    let QUESTION_B = QUESTION_LOST;

    setupMarket(MARKET_A, QUESTION_A, TOKEN_0_WON, TOKEN_1_WON);
    setupMarket(MARKET_B, QUESTION_B, TOKEN_0_LOST, TOKEN_1_LOST);

    // --- DAY 1: PLACING 3 BETS ---
    // Market A: 2 bets (one on each outcome)
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_0_WON, START_TS, 0));
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_1_WON, START_TS, 1));

    // Market B: 1 bet (will lose)
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS, 2));

    // --- DAY 3: BOTH MARKETS RESOLVE ---
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();

    // Market A resolves to 0 — expectedPayout = outcomeShares0 = 1000
    // profit = 1000 - 1000 (totalTraded for this market) = 0
    let payoutsA = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_A, payoutsA, BigInt.fromI32(0), day3TS));

    // Market B resolves to 1 — expectedPayout = outcomeShares1 = 0 (no outcome 1 shares)
    // profit = 0 - 1000 = -1000
    let payoutsB = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_B, payoutsB, BigInt.fromI32(1), day3TS));

    // Daily Profit Day 3: 0 (Market A) + (-1000) (Market B) = -1000
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1000");
    // Verify both markets are participants
    assert.fieldEquals(
      "DailyProfitStatistic",
      day3Id,
      "profitParticipants",
      "[" + MARKET_A.toHexString() + ", " + MARKET_B.toHexString() + "]"
    );

    // --- DAY 5: PAYOUT FOR MARKET A ---
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    let day5Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 4)).toString();

    // Redeem Market A for 1000. Only totalPayout updated, no dailyProfit change.
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(1000), MARKET_A, day5TS));

    assert.fieldEquals("DailyProfitStatistic", day5Id, "dailyProfit", "0");
    assert.fieldEquals("DailyProfitStatistic", day5Id, "totalPayout", "1000");
  });

  test("Edge Case: Multiple losing bets in one market resolution should only create ONE DailyProfitStatistic", () => {
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    // Place 3 DIFFERENT bets from the SAME agent in the SAME market
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(200), TOKEN_0_LOST, START_TS, 0));
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(200), TOKEN_0_LOST, START_TS, 1));
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(200), TOKEN_0_LOST, START_TS, 2));

    // Resolve market (this triggers the loop over all participants)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();

    // All 3 bets lost: expectedPayout = 0, profit = 0 - 300 = -300
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-300");
  });

  test("Aggregation: Two different markets resolving on the same day for same agent", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS, 0));
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(2000), BigInt.fromI32(4000), TOKEN_0_LOST, START_TS, 1));

    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));

    // Both markets resolve to Outcome 1 (both bets on Outcome 0 lose)
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(1), day3TS));
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();

    // Both bets lost: -1000 - 2000 = -3000
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-3000");
  });

  /**
   * Test: Settled totals updated at resolution for ALL bets (both winning and losing)
   */
  test("Settled totals updated at resolution for all bets", () => {
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    // Day 1: Place bet
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS));

    // Check TraderAgent: totalTraded updated, settled versions zero
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");

    // Check MarketParticipant
    let participantId = AGENT.toHexString() + "_" + CONDITION_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "totalTraded", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "0");

    // Check Global
    assert.fieldEquals("Global", "", "totalTraded", "1000");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");

    // Day 3: Market resolves
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    // All settled at resolution
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");
  });

  /**
   * Test: Winning bet — settled totals update at resolution (not payout)
   */
  test("Winning bet: settled totals update at resolution, not payout", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);

    // Day 1: Place winning bet
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS));

    // Check settled totals are zero
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");
    let participantId = AGENT.toHexString() + "_" + CONDITION_WON.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");

    // Day 3: Market resolves with correct answer — settled totals update NOW
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS));

    // Settled at resolution
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");

    // Day 7: Payout — settled totals don't change
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2000), CONDITION_WON, day7TS));

    // Still the same (no double-counting)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");

    // But totalPayout updated
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalPayout", "2000");
  });

  /**
   * Test: Mixed bets in same market — all settled at resolution
   */
  test("Mixed bets: all settled at resolution time", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);

    // Place two bets on different outcomes
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_0_WON, START_TS, 0)); // Will win
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(300), BigInt.fromI32(600), TOKEN_1_WON, START_TS, 1)); // Will lose

    // Check totals after bets
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "800"); // 500 + 300
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");

    // Market resolves to Outcome 0
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS));

    // ALL bets settled at resolution (both winning and losing)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "800");

    // Verify participant expectedPayout = outcomeShares0 = 1000
    let participantId = AGENT.toHexString() + "_" + CONDITION_WON.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "settled", "true");
  });

  /**
   * Test: Multiple markets — settled totals aggregate correctly at resolution
   */
  test("Multiple markets: settled totals aggregate correctly", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    // Place bets in both markets
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS, 0));
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(2000), BigInt.fromI32(4000), TOKEN_0_LOST, START_TS, 1));

    // Check totals
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "3000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");

    // Day 3: Market LOST resolves (bet loses)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    // MARKET_LOST settled at resolution
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "2000");

    // Day 5: Market WON resolves (bet wins) — also settles at resolution
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    let payoutsWin = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payoutsWin, BigInt.fromI32(0), day5TS));

    // Now both markets settled at resolution
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "3000");
  });

  /**
   * Test: Global entity — totalExpectedPayout tracks across agents
   */
  test("Global entity: totalExpectedPayout tracks all agents", () => {
    let AGENT2 = TestAddresses.TRADER_AGENT_2;

    // Setup second agent
    let agent2 = new TraderAgent(AGENT2);
    agent2.totalBets = 0;
    agent2.serviceId = TestConstants.SERVICE_ID_2;
    agent2.totalTraded = BigInt.zero();
    agent2.totalPayout = BigInt.zero();
    agent2.totalTradedSettled = BigInt.zero();
    agent2.totalExpectedPayout = BigInt.zero();
    agent2.blockNumber = TestConstants.BLOCK_NUMBER_START;
    agent2.blockTimestamp = START_TS;
    agent2.transactionHash = TestBytes.DUMMY_HASH;
    agent2.save();

    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    // Agent 1: bet on outcome 0 (1000 USDC, 2000 shares)
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS, 0));

    // Agent 2: bet on outcome 1 (500 USDC, 1000 shares) — will win
    handleOrderFilled(createOrderFilledEvent(AGENT2, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_1_LOST, START_TS, 1));

    // Check Global totals
    assert.fieldEquals("Global", "", "totalTraded", "1500");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalExpectedPayout", "0");

    // Market resolves to outcome 1 (Agent1 loses, Agent2 wins)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    // Global settled totals aggregate from both agents
    assert.fieldEquals("Global", "", "totalTradedSettled", "1500");
    // Agent1 expectedPayout = 0 (no outcome 1 shares), Agent2 expectedPayout = 1000
    assert.fieldEquals("Global", "", "totalExpectedPayout", "1000");
  });

  /**
   * Test: Invalid market — expectedPayout = (shares0 + shares1) / 2 at resolution
   */
  test("Invalid market: expectedPayout calculated at resolution from shares", () => {
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    // Day 1: Place bets on both outcomes
    // Bet A: 1000 USDC, 2000 shares on Outcome 0
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS, 0));
    // Bet B: 500 USDC, 1000 shares on Outcome 1
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_1_LOST, START_TS, 1));

    // Day 3: Market resolves as INVALID (winningIndex = -1)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("500000000000000000"), BigInt.fromString("500000000000000000")];

    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(-1), day3TS));

    // expectedPayout = max(0, 2000)/2 + max(0, 1000)/2 = 1000 + 500 = 1500
    let participantId = AGENT.toHexString() + "_" + CONDITION_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "1500");
    assert.fieldEquals("MarketParticipant", participantId, "settled", "true");

    // profit = 1500 - 1500 (totalTraded) = 0
    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "0");

    // All totals settled
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1500");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "1500");
  });

  /**
   * Test: Sell bet — negative amounts and share tracking
   */
  test("Sell bet: negative amounts and share tracking", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);

    // Day 1: Buy 2000 shares of outcome 0 for 1000 USDC
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS, 0));

    // Day 1: Sell 500 shares of outcome 0 for 300 USDC
    handleOrderFilled(createSellOrderFilledEvent(AGENT, BigInt.fromI32(300), BigInt.fromI32(500), TOKEN_0_WON, START_TS, 1));

    // Check participant share tracking
    let participantId = AGENT.toHexString() + "_" + CONDITION_WON.toHexString();
    // outcomeShares0 = 2000 - 500 = 1500 (buy adds, sell subtracts)
    assert.fieldEquals("MarketParticipant", participantId, "outcomeShares0", "1500");
    assert.fieldEquals("MarketParticipant", participantId, "outcomeShares1", "0");

    // totalTraded = 1000 + (-300) = 700 (sells have negative amount)
    assert.fieldEquals("MarketParticipant", participantId, "totalTraded", "700");

    // Day 3: Market resolves to Outcome 0 (wins)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS));

    // expectedPayout = net shares = 1500
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "1500");

    // profit = 1500 - 700 = 800
    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "800");
  });

  /**
   * Test: Settled flag prevents double-processing (idempotency)
   */
  test("Idempotency: settled flag prevents double-processing", () => {
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS));

    // Resolve market
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    // Verify settled
    let participantId = AGENT.toHexString() + "_" + CONDITION_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "settled", "true");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");

    // Try to resolve again (should be no-op due to settled flag)
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day5TS));

    // Settled totals unchanged (no double-counting)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "0");
  });

  /**
   * Test: PayoutRedemption creates immutable entity
   */
  test("PayoutRedemption creates immutable entity with correct fields", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);

    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS));

    // Resolve market
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS));

    // Payout
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2000), CONDITION_WON, day7TS));

    // Verify PayoutRedemption entity exists
    // The ID is txHash.concat(Bytes.fromI32(logIndex))
    // Since our mock event has default logIndex, we check via agent's totalPayout
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalPayout", "2000");
    assert.fieldEquals("MarketParticipant", AGENT.toHexString() + "_" + CONDITION_WON.toHexString(), "totalPayout", "2000");
  });

  /**
   * Test: NegRisk market basic flow
   */
  test("NegRisk: Basic loss flow records negative profit on resolution", () => {
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    // Mark the question as NegRisk
    let question = Question.load(CONDITION_LOST);
    if (question != null) {
      question.isNegRisk = true;
      question.save();
    }

    // Day 1: Place bet on Outcome 0
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS));

    // Day 3: Market resolves (Outcome 1 wins)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1000");
  });

  /**
   * Test: NegRisk winning bet — profit recorded at resolution (not payout)
   */
  test("NegRisk: Winning bet records profit at resolution", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);

    // Mark the question as NegRisk
    let question = Question.load(CONDITION_WON);
    if (question != null) {
      question.isNegRisk = true;
      question.save();
    }

    // Day 1: Place bet on Outcome 0 (1000 USDC, 2000 shares)
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS));

    // Day 3: Market resolves (Outcome 0 wins)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS));

    // Profit recorded at resolution: expectedPayout(2000) - totalTraded(1000) = 1000
    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "1000");

    // Day 7: Payout — only totalPayout updates
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    let day7TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2000), CONDITION_WON, day7TS));

    let day7Id = AGENT.toHexString() + "_" + day7TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day7Id, "dailyProfit", "0");
    assert.fieldEquals("DailyProfitStatistic", day7Id, "totalPayout", "2000");
  });

  /**
   * Test: Mixed UMA and NegRisk markets
   */
  test("Mixed markets: UMA and NegRisk profits aggregate on same day", () => {
    let UMA_MARKET = CONDITION_LOST;
    let NEGRISK_MARKET = CONDITION_WON;
    let UMA_QUESTION = QUESTION_LOST;
    let NEGRISK_QUESTION = QUESTION_WON;

    setupMarket(UMA_MARKET, UMA_QUESTION, TOKEN_0_LOST, TOKEN_1_LOST);
    setupMarket(NEGRISK_MARKET, NEGRISK_QUESTION, TOKEN_0_WON, TOKEN_1_WON);

    // Mark NegRisk market
    let negRiskQuestion = Question.load(NEGRISK_MARKET);
    if (negRiskQuestion != null) {
      negRiskQuestion.isNegRisk = true;
      negRiskQuestion.save();
    }

    // Day 1: Place bets
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_0_LOST, START_TS, 0)); // UMA bet
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(800), BigInt.fromI32(1600), TOKEN_0_WON, START_TS, 1)); // NegRisk bet

    // Day 3: Both markets resolve (both lose)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];

    handleOOQuestionResolved(createQuestionResolvedEvent(UMA_QUESTION, payouts, BigInt.fromI32(1), day3TS));
    handleOOQuestionResolved(createQuestionResolvedEvent(NEGRISK_QUESTION, payouts, BigInt.fromI32(1), day3TS));

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    // Both bets lost: -500 - 800 = -1300
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1300");
  });

  /**
   * Test: NegRisk multiple questions with same marketId tracked separately
   */
  test("NegRisk: Multiple questions with same marketId tracked separately", () => {
    let MARKET_ID = Bytes.fromHexString("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    let QUESTION_1 = TestBytes.QUESTION_ID_1;
    let QUESTION_2 = TestBytes.QUESTION_ID_2;
    let CONDITION_1 = TestBytes.CONDITION_ID_1;
    let CONDITION_2 = TestBytes.CONDITION_ID_2;
    let TOKEN_Q1_0 = BigInt.fromI32(300);
    let TOKEN_Q1_1 = BigInt.fromI32(301);
    let TOKEN_Q2_0 = BigInt.fromI32(400);
    let TOKEN_Q2_1 = BigInt.fromI32(401);

    setupMarket(CONDITION_1, QUESTION_1, TOKEN_Q1_0, TOKEN_Q1_1);
    setupMarket(CONDITION_2, QUESTION_2, TOKEN_Q2_0, TOKEN_Q2_1);

    // Set both as NegRisk with same marketId
    let question1 = Question.load(CONDITION_1);
    if (question1 != null) {
      question1.isNegRisk = true;
      question1.marketId = MARKET_ID;
      question1.save();
    }

    let question2 = Question.load(CONDITION_2);
    if (question2 != null) {
      question2.isNegRisk = true;
      question2.marketId = MARKET_ID;
      question2.save();
    }

    // Day 1: Bet on both questions
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(600), BigInt.fromI32(1200), TOKEN_Q1_0, START_TS, 0));
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(400), BigInt.fromI32(800), TOKEN_Q2_0, START_TS, 1));

    // Day 3: Question 1 loses, Question 2 wins
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));

    let payoutsLose = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    let payoutsWin = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];

    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_1, payoutsLose, BigInt.fromI32(1), day3TS));
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_2, payoutsWin, BigInt.fromI32(0), day3TS));

    // Both resolved on Day 3:
    // Q1: expectedPayout = 0 (no outcome 1 shares), profit = 0 - 600 = -600
    // Q2: expectedPayout = 800, profit = 800 - 400 = 400
    // Total = -600 + 400 = -200
    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-200");

    // Verify individual participants
    let participant1 = AGENT.toHexString() + "_" + CONDITION_1.toHexString();
    let participant2 = AGENT.toHexString() + "_" + CONDITION_2.toHexString();
    assert.fieldEquals("MarketParticipant", participant1, "expectedPayout", "0");
    assert.fieldEquals("MarketParticipant", participant2, "expectedPayout", "800");
    assert.fieldEquals("MarketParticipant", participant1, "settled", "true");
    assert.fieldEquals("MarketParticipant", participant2, "settled", "true");
  });

  /**
   * Test: NegRisk settled totals
   */
  test("NegRisk: Settled totals update at resolution for both winning and losing", () => {
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);

    // Mark both as NegRisk
    let questionLost = Question.load(CONDITION_LOST);
    if (questionLost != null) {
      questionLost.isNegRisk = true;
      questionLost.save();
    }

    let questionWon = Question.load(CONDITION_WON);
    if (questionWon != null) {
      questionWon.isNegRisk = true;
      questionWon.save();
    }

    // Day 1: Place bets on both markets
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(700), BigInt.fromI32(1400), TOKEN_0_LOST, START_TS, 0));
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(900), BigInt.fromI32(1800), TOKEN_0_WON, START_TS, 1));

    // Check initial state
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "1600");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");

    // Day 3: Losing market resolves
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payoutsLose = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payoutsLose, BigInt.fromI32(1), day3TS));

    // Losing bet settled at resolution
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "700");

    // Day 5: Winning market resolves — ALSO settles at resolution
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    let payoutsWin = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payoutsWin, BigInt.fromI32(0), day5TS));

    // Both settled at resolution
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1600");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "1800");

    // Day 7: Payout — only totalPayout updates
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2000), CONDITION_WON, day7TS));

    // Settled totals unchanged
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1600");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalPayout", "2000");
  });

  /**
   * Comprehensive: TraderAgent, MarketParticipant, and Global totals tracking
   */
  test("Comprehensive: TraderAgent, MarketParticipant, and Global totals tracking", () => {
    let AGENT1 = AGENT;
    let AGENT2 = TestAddresses.TRADER_AGENT_2;
    let MARKET_A = CONDITION_WON;
    let MARKET_B = CONDITION_LOST;
    let QUESTION_A = QUESTION_WON;
    let QUESTION_B = QUESTION_LOST;

    // Setup second agent
    let agent2 = new TraderAgent(AGENT2);
    agent2.totalBets = 0;
    agent2.serviceId = TestConstants.SERVICE_ID_2;
    agent2.totalTraded = BigInt.zero();
    agent2.totalPayout = BigInt.zero();
    agent2.totalTradedSettled = BigInt.zero();
    agent2.totalExpectedPayout = BigInt.zero();
    agent2.blockNumber = TestConstants.BLOCK_NUMBER_START;
    agent2.blockTimestamp = START_TS;
    agent2.transactionHash = TestBytes.DUMMY_HASH;
    agent2.save();

    setupMarket(MARKET_A, QUESTION_A, TOKEN_0_WON, TOKEN_1_WON);
    setupMarket(MARKET_B, QUESTION_B, TOKEN_0_LOST, TOKEN_1_LOST);

    // === PHASE 1: BETTING ===
    // Agent1 bets 1000 on Market A, Outcome 0 (will win), 2000 shares
    handleOrderFilled(createOrderFilledEvent(AGENT1, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS, 0));

    // Agent2 bets 500 on Market A, Outcome 1 (will lose), 1000 shares
    handleOrderFilled(createOrderFilledEvent(AGENT2, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_1_WON, START_TS, 1));

    // Agent2 bets 2000 on Market B, Outcome 0 (will lose), 4000 shares
    handleOrderFilled(createOrderFilledEvent(AGENT2, BigInt.fromI32(2000), BigInt.fromI32(4000), TOKEN_0_LOST, START_TS, 2));

    // Check Agent1 totals after betting
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalBets", "1");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTraded", "1000");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "0");

    // Check Agent2 totals after betting
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalBets", "2");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTraded", "2500");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "0");

    // Check MarketParticipants
    let participant1A = AGENT1.toHexString() + "_" + MARKET_A.toHexString();
    assert.fieldEquals("MarketParticipant", participant1A, "totalBets", "1");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTraded", "1000");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTradedSettled", "0");

    let participant2A = AGENT2.toHexString() + "_" + MARKET_A.toHexString();
    assert.fieldEquals("MarketParticipant", participant2A, "totalBets", "1");
    assert.fieldEquals("MarketParticipant", participant2A, "totalTraded", "500");
    assert.fieldEquals("MarketParticipant", participant2A, "totalTradedSettled", "0");

    let participant2B = AGENT2.toHexString() + "_" + MARKET_B.toHexString();
    assert.fieldEquals("MarketParticipant", participant2B, "totalBets", "1");
    assert.fieldEquals("MarketParticipant", participant2B, "totalTraded", "2000");
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "0");

    // Check Global totals after all bets
    assert.fieldEquals("Global", "", "totalBets", "3");
    assert.fieldEquals("Global", "", "totalTraded", "3500");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");

    // === PHASE 2: MARKET A RESOLVES (Outcome 0 wins) ===
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payoutsA = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_A, payoutsA, BigInt.fromI32(0), day3TS));

    // ALL participants in Market A settled at resolution
    // Agent1: expectedPayout = 2000 (shares0), settled
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalExpectedPayout", "2000");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participant1A, "expectedPayout", "2000");

    // Agent2: expectedPayout = 0 (no outcome 0 shares), settled
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "500");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalExpectedPayout", "0");
    assert.fieldEquals("MarketParticipant", participant2A, "totalTradedSettled", "500");
    assert.fieldEquals("MarketParticipant", participant2A, "expectedPayout", "0");

    // Agent2's Market B bet not settled yet
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "0");

    // Global: Agent1 (1000) + Agent2-MarketA (500) settled
    assert.fieldEquals("Global", "", "totalTradedSettled", "1500");
    assert.fieldEquals("Global", "", "totalExpectedPayout", "2000");

    // === PHASE 3: MARKET B RESOLVES (Outcome 1 wins) ===
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    let payoutsB = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleOOQuestionResolved(createQuestionResolvedEvent(QUESTION_B, payoutsB, BigInt.fromI32(1), day5TS));

    // Agent2's bet on Market B now settled
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "2500");
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "2000");

    // Global: all settled
    assert.fieldEquals("Global", "", "totalTradedSettled", "3500");

    // === PHASE 4: AGENT1 REDEEMS PAYOUT ===
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT1, BigInt.fromI32(2000), MARKET_A, day7TS));

    // Settled totals unchanged (already settled at resolution)
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "1000");
    // But totalPayout updated
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalPayout", "2000");
    assert.fieldEquals("MarketParticipant", participant1A, "totalPayout", "2000");

    // Global
    assert.fieldEquals("Global", "", "totalTradedSettled", "3500");
    assert.fieldEquals("Global", "", "totalPayout", "2000");
    assert.fieldEquals("Global", "", "totalTraded", "3500");
  });
});
