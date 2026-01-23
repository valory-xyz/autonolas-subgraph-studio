import { assert, describe, test, clearStore, beforeEach } from "matchstick-as/assembly/index";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { handleOrderFilled, handleTokenRegistered } from "../src/ctf-exchange";
import { handleQuestionResolved } from "../src/uma-mapping";
import { handlePayoutRedemption } from "../src/conditional-tokens";
import { createOrderFilledEvent, createQuestionResolvedEvent, createPayoutRedemptionEvent, createTokenRegisteredEvent } from "./profit";
import { TraderAgent, Question, QuestionIdToConditionId, MarketMetadata } from "../generated/schema";
import { TestAddresses, TestBytes, TestConstants, createAncillaryData, normalizeTimestamp } from "./test-helpers";

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
  agent.blockNumber = TestConstants.BLOCK_NUMBER_START;
  agent.blockTimestamp = START_TS;
  agent.transactionHash = TestBytes.DUMMY_HASH;
  agent.save();
}

function setupMarket(conditionId: Bytes, questionId: Bytes, token0: BigInt, token1: BigInt): void {
  // 1. Create bridge between questionId and conditionId
  let bridge = new QuestionIdToConditionId(questionId);
  bridge.conditionId = conditionId;
  bridge.save();

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
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1000");
    assert.fieldEquals("DailyProfitStatistic", day3Id, "profitParticipants", "[" + CONDITION_LOST.toHexString() + "]");
  });

  /**
   * Scenario 3: Delayed Profit on Payout
   * - Day 1: Place winning bet on Outcome 0 (Cost: 1000).
   * - Day 3: Market resolves to Outcome 0. Profit stays 0 (Pending Payout).
   * - Check: Daily profit is not recorded yet
   * - Day 7: Agent redeems 2500.
   * - Check: Profit (Payout - Cost = 1500) is recorded on Day 7.
   */
  test("Day 7: Payout Redemption records net win profit", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);

    // Day 1: Place Winning Bet (Outcome 0)
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS));

    // Day 3: Market Resolves to Outcome 0 (bet wins)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)]; // Outcome 0 wins
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS));

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.notInStore("DailyProfitStatistic", day3Id); // no entity in store, because answer was correct

    // Day 7: Payout
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    let day7TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2500), CONDITION_WON, day7TS));

    let day7Id = AGENT.toHexString() + "_" + day7TSNormalized.toString();
    // 2500 - 1000 = 1500
    assert.fieldEquals("DailyProfitStatistic", day7Id, "dailyProfit", "1500");
    assert.fieldEquals("DailyProfitStatistic", day7Id, "profitParticipants", "[" + CONDITION_WON.toHexString() + "]");
  });

  /**
   * Scenario 4: Complex Multi-Market Logic
   * - Market A (Split):
   *    - Bet 1: 500 cost on Outcome 0 (Correct).
   *    - Bet 2: 500 cost on Outcome 1 (Incorrect).
   * - Market B (Single):
   *    - Bet 3: 1000 cost on Outcome 0 (Incorrect).
   * - Day 3 Resolution:
   *    - Market A resolves to 0 (Bet 2 becomes loss: -500).
   *    - Market B resolves to 1 (Bet 3 becomes loss: -1000).
   * - Check: Total Day 3 Profit: -1500 is recorded on Day 3.
   * - Day 5 Payout:
   *    - Redeem Market A for 1200.
   * - Check: Payout (1200) - Cost of WON Bet (500) = +700 is recorded on Day 5.
   */
  test("Complex: Multiple markets, split bets, and simultaneous Win/Loss events", () => {
    let MARKET_A = CONDITION_WON;
    let MARKET_B = CONDITION_LOST;
    let QUESTION_A = QUESTION_WON;
    let QUESTION_B = QUESTION_LOST;

    setupMarket(MARKET_A, QUESTION_A, TOKEN_0_WON, TOKEN_1_WON);
    setupMarket(MARKET_B, QUESTION_B, TOKEN_0_LOST, TOKEN_1_LOST);

    // --- DAY 1: PLACING 3 BETS ---
    // Market A: 2 bets (one will win, one will lose)
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_0_WON, START_TS, 0));
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_1_WON, START_TS, 1));

    // Market B: 1 bet (will lose)
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS, 2));

    // --- DAY 3: BOTH MARKETS RESOLVE ---
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();

    // Market A resolves to 0.
    // Effect: Bet on Outcome 1 is a LOSS (500). Bet on Outcome 0 is PENDING.
    let payoutsA = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_A, payoutsA, BigInt.fromI32(0), day3TS));

    // Market B resolves to 1.
    // Effect: Bet on Outcome 0 is a LOSS (1000).
    let payoutsB = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_B, payoutsB, BigInt.fromI32(1), day3TS));

    // Daily Profit Day 3: -(500 from A) - (1000 from B) = -1500
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1500");
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

    // Redeem Market A for 1200.
    // The logic should only subtract the cost of the WON bet (500), as the LOST bet was already subtracted on Day 3.
    // Profit = 1200 - 500 = 700.
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(1200), MARKET_A, day5TS));

    assert.fieldEquals("DailyProfitStatistic", day5Id, "dailyProfit", "700");
    assert.fieldEquals("DailyProfitStatistic", day5Id, "profitParticipants", "[" + MARKET_A.toHexString() + "]");
  });

  test("Edge Case: Multiple losing bets in one market resolution should only create ONE DailyProfitStatistic", () => {
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    // Place 3 DIFFERENT bets from the SAME agent in the SAME market
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(200), TOKEN_0_LOST, START_TS, 0));
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(200), TOKEN_0_LOST, START_TS, 1));
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(200), TOKEN_0_LOST, START_TS, 2));

    // Resolve market (this triggers the loop over all 3 bets)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();

    // All 3 bets lost: -100 * 3 = -300
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
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(1), day3TS));
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();

    // Both bets lost: -1000 - 2000 = -3000
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-3000");
  });

  /**
   * Test: Settled totals remain zero until market resolves (incorrect bet)
   * - Day 1: Place bet (1000 USDC)
   * - Check: totalTraded updated, but settled versions remain zero
   * - Day 3: Market resolves with different answer (bet loses)
   * - Check: totalTradedSettled now updated for TraderAgent, MarketParticipant, and Global
   */
  test("Settled totals remain zero until market resolves (incorrect bet)", () => {
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

    // Day 3: Market resolves with different answer
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    // Check TraderAgent: settled totals now updated
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");

    // Check MarketParticipant: settled totals now updated
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");

    // Check Global: settled totals now updated
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");
  });

  /**
   * Test: Settled totals remain zero until payout (correct bet)
   * - Day 1: Place winning bet
   * - Check: totalTraded updated, settled versions remain zero
   * - Day 3: Market resolves with correct answer
   * - Check: Settled totals still zero (waiting for payout)
   * - Day 7: Redeem payout
   * - Check: totalTradedSettled now updated
   */
  test("Settled totals remain zero until payout (correct bet)", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);

    // Day 1: Place winning bet
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS));

    // Check settled totals are zero
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");

    let participantId = AGENT.toHexString() + "_" + CONDITION_WON.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "0");

    assert.fieldEquals("Global", "", "totalTradedSettled", "0");

    // Day 3: Market resolves with correct answer
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS));

    // Check settled totals still zero (waiting for payout)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");

    // Day 7: Redeem payout
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2500), CONDITION_WON, day7TS));

    // Check settled totals now updated
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");
  });

  /**
   * Test: Mixed bets in same market - settled totals updated at different times
   * - Place two bets in same market (one will win, one will lose)
   * - On resolution: only the losing bet's amounts move to settled totals
   * - On payout: the winning bet's amounts move to settled totals
   * - Verify final settled totals equal total traded
   */
  test("Mixed bets: settled totals updated at different times", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, TOKEN_0_WON, TOKEN_1_WON);

    // Place two bets on different outcomes
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_0_WON, START_TS, 0)); // Will win
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(300), BigInt.fromI32(600), TOKEN_1_WON, START_TS, 1)); // Will lose

    // Check totals after bets
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "800"); // 500 + 300
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");

    // Market resolves to Outcome 0 (first bet wins, second bet loses)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS));

    // Check: only losing bet moved to settled (300)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "300");

    // Payout for winning bet
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(1200), CONDITION_WON, day7TS));

    // Check: now all bets are settled (300 + 500 = 800)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "800");

    // Verify settled equals total
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "800");
  });

  /**
   * Test: Multiple markets - settled totals aggregate correctly
   * - Place bets in multiple markets
   * - Resolve markets at different times
   * - Verify settled totals accumulate correctly
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
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    // Only MARKET_LOST bet settled
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "2000");

    // Day 5: Market WON resolves (bet wins)
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    let payoutsWin = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_WON, payoutsWin, BigInt.fromI32(0), day5TS));

    // Still only MARKET_LOST settled (WON bet waits for payout)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "2000");

    // Day 7: Payout for MARKET_WON
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2500), CONDITION_WON, day7TS));

    // Now both markets settled
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "3000");
  });

  /**
   * Test: Global entity - settled totals track all agents
   * - Create multiple agents
   * - Place bets from different agents
   * - Resolve markets
   * - Verify Global totals aggregate correctly
   */
  test("Global entity: settled totals track all agents", () => {
    let AGENT2 = TestAddresses.TRADER_AGENT_2;

    // Setup second agent
    let agent2 = new TraderAgent(AGENT2);
    agent2.totalBets = 0;
    agent2.serviceId = TestConstants.SERVICE_ID_2;
    agent2.totalTraded = BigInt.zero();
    agent2.totalPayout = BigInt.zero();
    agent2.totalTradedSettled = BigInt.zero();
    agent2.blockNumber = TestConstants.BLOCK_NUMBER_START;
    agent2.blockTimestamp = START_TS;
    agent2.transactionHash = TestBytes.DUMMY_HASH;
    agent2.save();

    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    // Agent 1 places bet
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS, 0));

    // Agent 2 places bet
    handleOrderFilled(createOrderFilledEvent(AGENT2, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_0_LOST, START_TS, 1));

    // Check Global totals
    assert.fieldEquals("Global", "", "totalTraded", "1500");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");

    // Market resolves (both bets lose)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(1), day3TS));

    // Check Global settled totals aggregate from both agents
    assert.fieldEquals("Global", "", "totalTradedSettled", "1500");
  });

  /**
   * Test: Invalid market resolution - profit deferred to payout
   * - Day 1: Place bets on both outcomes (Total cost: 1500)
   * - Day 3: Market resolves as invalid (winningIndex = -1). 
   * - Check: No profit is recorded yet (Deferred).
   * - Day 7: Agent redeems 50% refund (750 USDC).
   * - Check: Net loss (750 - 1500 = -750) is recorded on Day 7.
   */
  test("Invalid market: profit is deferred until payout redemption", () => {
    setupMarket(CONDITION_LOST, QUESTION_LOST, TOKEN_0_LOST, TOKEN_1_LOST);

    // Day 1: Place bets on both outcomes
    // Bet A: 1000 USDC on Outcome 0
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_LOST, START_TS, 0));
    // Bet B: 500 USDC on Outcome 1
    handleOrderFilled(createOrderFilledEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_1_LOST, START_TS, 1));

    // Day 3: Market resolves as INVALID
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("500000000000000000"), BigInt.fromString("500000000000000000")]; 
    
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_LOST, payouts, BigInt.fromI32(-1), day3TS));

    // ASSERTION 1: On Day 3, no profit entity should exist for this agent 
    // because winningIndex was -1 and we skipped settlement logic.
    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.notInStore("DailyProfitStatistic", day3Id);
    
    // ASSERTION 2: totalTradedSettled should still be 0
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");

    // --- DAY 7: PAYOUT (REFUND) ---
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    let day7TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 6));
    
    // Agent redeems their shares. 
    // In an invalid market with 3000 total shares (2000+1000), 
    // and a 0.5 payout, they get 1500 back.
    // Total Investment: 1500. Total Payout: 1500. Net Profit: 0.
    // (Or if they only redeem one outcome, adjust accordingly).
    
    // Let's assume they redeem the full 50% refund for all shares: 1500 USDC
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(1500), CONDITION_LOST, day7TS));

    let day7Id = AGENT.toHexString() + "_" + day7TSNormalized.toString();

    // ASSERTION 3: Daily Profit is recorded on the day of Payout
    // Payout (1500) - Cost (1500) = 0
    assert.fieldEquals("DailyProfitStatistic", day7Id, "dailyProfit", "0");
    
    // ASSERTION 4: All totals are now settled
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1500");
  });

  /**
   * Test: Comprehensive totals tracking across all entities
   * Scenario:
   * - Agent1 bets on Market A (will win)
   * - Agent2 bets on Market A (will lose) and Market B (will lose)
   * - Verify totals are correct at each stage:
   *   1. After betting (historical totals updated, settled totals zero)
   *   2. After Market A resolution (Agent2's bet settled, Agent1's not)
   *   3. After Market B resolution (Agent2's second bet settled)
   *   4. After Agent1 payout (all bets settled)
   * - Verify TraderAgent, MarketParticipant, and Global totals correspond correctly
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
    agent2.blockNumber = TestConstants.BLOCK_NUMBER_START;
    agent2.blockTimestamp = START_TS;
    agent2.transactionHash = TestBytes.DUMMY_HASH;
    agent2.save();

    setupMarket(MARKET_A, QUESTION_A, TOKEN_0_WON, TOKEN_1_WON);
    setupMarket(MARKET_B, QUESTION_B, TOKEN_0_LOST, TOKEN_1_LOST);

    // === PHASE 1: BETTING ===
    // Agent1 bets 1000 on Market A, Outcome 0 (will win)
    handleOrderFilled(createOrderFilledEvent(AGENT1, BigInt.fromI32(1000), BigInt.fromI32(2000), TOKEN_0_WON, START_TS, 0));

    // Agent2 bets 500 on Market A, Outcome 1 (will lose)
    handleOrderFilled(createOrderFilledEvent(AGENT2, BigInt.fromI32(500), BigInt.fromI32(1000), TOKEN_1_WON, START_TS, 1));

    // Agent2 bets 2000 on Market B, Outcome 0 (will lose)
    handleOrderFilled(createOrderFilledEvent(AGENT2, BigInt.fromI32(2000), BigInt.fromI32(4000), TOKEN_0_LOST, START_TS, 2));

    // Check Agent1 totals after betting
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalBets", "1");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTraded", "1000");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "0");

    // Check Agent2 totals after betting
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalBets", "2");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTraded", "2500"); // 500 + 2000
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "0");

    // Check MarketParticipant for Agent1-MarketA
    let participant1A = AGENT1.toHexString() + "_" + MARKET_A.toHexString();
    assert.fieldEquals("MarketParticipant", participant1A, "totalBets", "1");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTraded", "1000");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTradedSettled", "0");

    // Check MarketParticipant for Agent2-MarketA
    let participant2A = AGENT2.toHexString() + "_" + MARKET_A.toHexString();
    assert.fieldEquals("MarketParticipant", participant2A, "totalBets", "1");
    assert.fieldEquals("MarketParticipant", participant2A, "totalTraded", "500");
    assert.fieldEquals("MarketParticipant", participant2A, "totalTradedSettled", "0");

    // Check MarketParticipant for Agent2-MarketB
    let participant2B = AGENT2.toHexString() + "_" + MARKET_B.toHexString();
    assert.fieldEquals("MarketParticipant", participant2B, "totalBets", "1");
    assert.fieldEquals("MarketParticipant", participant2B, "totalTraded", "2000");
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "0");

    // Check Global totals after all bets
    assert.fieldEquals("Global", "", "totalBets", "3");
    assert.fieldEquals("Global", "", "totalTraded", "3500"); // 1000 + 500 + 2000
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");

    // === PHASE 2: MARKET A RESOLVES (Outcome 0 wins) ===
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payoutsA = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_A, payoutsA, BigInt.fromI32(0), day3TS));

    // Agent1's bet on Market A was correct - NOT settled yet (waiting for payout)
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTradedSettled", "0");

    // Agent2's bet on Market A was incorrect - settled immediately
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "500");
    assert.fieldEquals("MarketParticipant", participant2A, "totalTradedSettled", "500");

    // Agent2's Market B bet not settled yet
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "0");

    // Global: only Agent2's Market A bet settled
    assert.fieldEquals("Global", "", "totalTradedSettled", "500");

    // === PHASE 3: MARKET B RESOLVES (Outcome 1 wins) ===
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    let payoutsB = [BigInt.fromI32(0), BigInt.fromString("1000000000000000000")];
    handleQuestionResolved(createQuestionResolvedEvent(QUESTION_B, payoutsB, BigInt.fromI32(1), day5TS));

    // Agent2's bet on Market B was incorrect - now settled
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "2500"); // 500 + 2000
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "2000");

    // Agent2's total settled should equal total traded (all bets lost)
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTraded", "2500");

    // Agent1 still not settled
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "0");

    // Global: Agent2's both bets settled
    assert.fieldEquals("Global", "", "totalTradedSettled", "2500");

    // === PHASE 4: AGENT1 REDEEMS PAYOUT ===
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT1, BigInt.fromI32(2500), MARKET_A, day7TS));

    // Agent1's winning bet now settled
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalPayout", "2500");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participant1A, "totalPayout", "2500");

    // Agent1's settled totals should equal total traded (bet won and paid out)
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTraded", "1000");

    // Global: all bets now settled
    assert.fieldEquals("Global", "", "totalTradedSettled", "3500"); // 500 + 2000 + 1000
    assert.fieldEquals("Global", "", "totalPayout", "2500");

    // Verify Global settled equals Global total (all markets settled)
    assert.fieldEquals("Global", "", "totalTraded", "3500");
  });
});
