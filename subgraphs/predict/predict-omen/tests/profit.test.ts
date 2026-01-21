import { assert, describe, test, clearStore, beforeEach } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { handleBuy } from "../src/FixedProductMarketMakerMapping";
import { handleLogNewAnswer } from "../src/realitio";
import { handlePayoutRedemption } from "../src/conditional-tokens";
import { createBuyEvent, createNewAnswerEvent, createPayoutRedemptionEvent } from "./profit";
import { TraderAgent, FixedProductMarketMakerCreation, Question, ConditionPreparation } from "../generated/schema";

const AGENT = Address.fromString("0x1234567890123456789012345678901234567890");
const MARKET_LOST = Address.fromString("0x0000000000000000000000000000000000000001");
const MARKET_WON = Address.fromString("0x0000000000000000000000000000000000000002");
const ANSWER_0 = BigInt.fromI32(0);
const ANSWER_0_HEX = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");
const ANSWER_1 = BigInt.fromI32(1);
const ANSWER_1_HEX = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001");
const DUMMY_HASH = Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234");
const DAY = 86400;
const START_TS = BigInt.fromI32(1710000000);
const NORMALIZED_TS = BigInt.fromI32(1709942400);

function setupAgent(): void {
  let agent = new TraderAgent(AGENT);
  agent.totalBets = 0;
  agent.serviceId = BigInt.fromI32(1);
  agent.totalTraded = BigInt.zero();
  agent.totalPayout = BigInt.zero();
  agent.totalFees = BigInt.zero();
  agent.totalTradedSettled = BigInt.zero();
  agent.totalFeesSettled = BigInt.zero();
  agent.blockNumber = BigInt.fromI32(1000);
  agent.blockTimestamp = START_TS;
  agent.transactionHash = DUMMY_HASH;
  agent.save();
}

function setupMarket(marketAddr: Address, questionId: string): void {
  // 1. Create Question (Required by Realitio logic)
  let question = new Question(questionId);
  question.question = "Will it rain?";
  question.fixedProductMarketMaker = marketAddr;
  question.save();

  // 2. Create Condition (Required by Payout logic)
  let condition = new ConditionPreparation(questionId);
  condition.questionId = Bytes.fromHexString(questionId);
  condition.conditionId = Bytes.fromHexString(questionId);
  condition.oracle = Address.zero();
  condition.outcomeSlotCount = BigInt.fromI32(2);
  condition.blockNumber = BigInt.fromI32(1000);
  condition.blockTimestamp = START_TS;
  condition.transactionHash = DUMMY_HASH;
  condition.save();

  // 3. Create Market
  let fpmm = new FixedProductMarketMakerCreation(marketAddr);
  fpmm.creator = Address.fromString("0x89c5cc945dd550bcffb72fe42bff002429f46fec");
  fpmm.conditionIds = [Bytes.fromHexString(questionId)];
  fpmm.fee = BigInt.zero();
  fpmm.conditionalTokens = Address.zero();
  fpmm.collateralToken = Address.zero();
  fpmm.blockNumber = BigInt.fromI32(1000);
  fpmm.blockTimestamp = START_TS;
  fpmm.transactionHash = DUMMY_HASH;
  fpmm.save();
}

describe("Profit Chart Integration", () => {
  beforeEach(() => {
    clearStore();
    setupAgent();
  });

  /**
   * Scenario 1: Basic Placement
   * - Day 1: Agent places a bet (1000 investment + 100 fee).
   * - Check:
   *    - Activity (totalTraded/totalFees) is updated.
   *    - Daily Profit is 0 (Market is still open).
   */
  test("Day 1: Activity is recorded, Profit is 0", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS));

    // Normalize timestamp to start of day (UTC)
    let day1Id = AGENT.toHexString() + "_" + NORMALIZED_TS.toString();
    assert.fieldEquals("DailyProfitStatistic", day1Id, "totalTraded", "1000");
    assert.fieldEquals("DailyProfitStatistic", day1Id, "totalFees", "100");
    assert.fieldEquals("DailyProfitStatistic", day1Id, "dailyProfit", "0");
  });

  /**
   * Scenario 2: Immediate Loss on Resolution
   * - Day 1: Place bet on Outcome 0 (Cost: 1100).
   * - Day 3: Market resolves to Outcome 1.
   * - Check:
   *    - The full cost (1100) is deducted from profit on Day 3.
   *    - Market added to profitParticipants.
   */
  test("Day 3: Market Resolution Loss records negative daily profit", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    // Day 1: Place the bet
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS));

    // Day 3: Market Resolves with different answer
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let answer = createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS); // Answer 1 != Bet 0
    handleLogNewAnswer(answer);

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1100");
    assert.fieldEquals("DailyProfitStatistic", day3Id, "profitParticipants", "[" + MARKET_LOST.toHexString() + "]");
  });

  /**
   * Scenario 3: Delayed Profit on Payout
   * - Day 1: Place winning bet on Outcome 0 (Cost: 1100).
   * - Day 3: Market resolves to Outcome 0. Profit stays 0 (Pending Payout).
   * - Check: Daily profit is not recorder yet
   * - Day 7: Agent redeems 2500.
   * - Check: Profit (Payout - Cost = 1400) is recorded on Day 7.
   */
  test("Day 7: Payout Redemption records net win profit", () => {
    setupMarket(MARKET_WON, MARKET_WON.toHexString());

    // Day 1: Place Winning Bet (Outcome 0)
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_WON, START_TS));

    // Day 3: Market Resolves with the same answer
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    let answer = createNewAnswerEvent(MARKET_WON, ANSWER_0_HEX, day3TS); // Answer 0 = Bet 0
    handleLogNewAnswer(answer);

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.notInStore("DailyProfitStatistic", day3Id); // there's no entity in store, because answer was correct - it'll be update during payout

    // Day 7: Payout
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    let day7TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 6));
    let redeem = createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2500), MARKET_WON, day7TS);
    handlePayoutRedemption(redeem);

    let day7Id = AGENT.toHexString() + "_" + day7TSNormalized.toString();
    // 2500 - (1000 + 100) = 1400
    assert.fieldEquals("DailyProfitStatistic", day7Id, "dailyProfit", "1400");
    assert.fieldEquals("DailyProfitStatistic", day7Id, "profitParticipants", "[" + MARKET_WON.toHexString() + "]");
  });

  /**
   * Scenario 4: Complex Multi-Market Logic
   * - Market A (Split):
   *    - Bet 1: 550 total cost on Outcome 0 (Correct).
   *    - Bet 2: 550 total cost on Outcome 1 (Incorrect).
   * - Market B (Single):
   *    - Bet 3: 1100 total cost on Outcome 0 (Incorrect).
   * - Day 3 Resolution:
   *    - Market A resolves to 0 (Bet 2 becomes loss: -550).
   *    - Market B resolves to 1 (Bet 3 becomes loss: -1100).
   * - Check: Total Day 3 Profit: -1650 is recorded on Day 3.
   * - Day 5 Payout:
   *    - Redeem Market A for 1200.
   * - Check: Payout (1200) - Cost of WON Bet (550) = +650 is recorded on Day 7.
   */
  test("Complex: Multiple markets, split bets, and simultaneous Win/Loss events", () => {
    let MARKET_A = MARKET_WON;
    let MARKET_B = MARKET_LOST;

    setupMarket(MARKET_A, MARKET_A.toHexString());
    setupMarket(MARKET_B, MARKET_B.toHexString());

    // --- DAY 1: PLACING 3 BETS ---
    // Market A: 2 bets (one will win, one will lose)
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(50), ANSWER_0, MARKET_A, START_TS, 0));
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(50), ANSWER_1, MARKET_A, START_TS, 1));

    // Market B: 1 bet (will lose)
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_B, START_TS, 2));

    // --- DAY 3: BOTH MARKETS RESOLVE ---
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();

    // Market A resolves to 0.
    // Effect: Bet on Outcome 1 is a LOSS (500+50). Bet on Outcome 0 is PENDING.
    handleLogNewAnswer(createNewAnswerEvent(MARKET_A, ANSWER_0_HEX, day3TS));

    // Market B resolves to 1.
    // Effect: Bet on Outcome 0 is a LOSS (1000+100).
    handleLogNewAnswer(createNewAnswerEvent(MARKET_B, ANSWER_1_HEX, day3TS));

    // Daily Profit Day 3: -(550 from A) - (1100 from B) = -1650
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1650");
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
    // The logic should only subtract the cost of the WON bet (500+50), as the LOST bet was already subtracted on Day 3.
    // Profit = 1200 - 550 = 650.
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(1200), MARKET_A, day5TS));

    assert.fieldEquals("DailyProfitStatistic", day5Id, "dailyProfit", "650");
    assert.fieldEquals("DailyProfitStatistic", day5Id, "profitParticipants", "[" + MARKET_A.toHexString() + "]");
  });

  test("Edge Case: Multiple losing bets in one market resolution should only create ONE DailyProfitStatistic", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    // Place 3 DIFFERENT bets from the SAME agent in the SAME market
    // Use different logIndexes (the last param) to ensure they are unique bets
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(10), ANSWER_0, MARKET_LOST, START_TS, 0));
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(10), ANSWER_0, MARKET_LOST, START_TS, 1));
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(10), ANSWER_0, MARKET_LOST, START_TS, 2));

    // Resolve market (this triggers the loop over all 3 bets)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();
    
    // This is the key check: If the bug exists, Matchstick *might* still pass, 
    // but in production, this is where the duplication happened.
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-330");
  });

  test("Aggregation: Two different markets resolving on the same day for same agent", () => {
    // Use the address as the ID string to match your setupMarket logic
    let qIdA = MARKET_WON.toHexString();
    let qIdB = MARKET_LOST.toHexString();

    setupMarket(MARKET_WON, qIdA);
    setupMarket(MARKET_LOST, qIdB);

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_WON, START_TS, 0));
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(2000), BigInt.fromI32(200), ANSWER_0, MARKET_LOST, START_TS, 1));

    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));

    // IMPORTANT: Pass the address as Bytes so toHexString() inside the handler works
    handleLogNewAnswer(createNewAnswerEvent(Bytes.fromUint8Array(MARKET_WON), ANSWER_1_HEX, day3TS));
    handleLogNewAnswer(createNewAnswerEvent(Bytes.fromUint8Array(MARKET_LOST), ANSWER_1_HEX, day3TS));

    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();

    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-3300");
  });

  /**
   * Test: Settled totals remain zero until market resolves (incorrect bet)
   * - Day 1: Place bet (1000 + 100 fees)
   * - Check: totalTraded and totalFees are updated, but settled versions remain zero
   * - Day 3: Market resolves with different answer (bet loses)
   * - Check: totalTradedSettled and totalFeesSettled are now updated for TraderAgent, MarketParticipant, and Global
   */
  test("Settled totals remain zero until market resolves (incorrect bet)", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    // Day 1: Place bet
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS));

    // Check TraderAgent: totalTraded and totalFees updated, settled versions zero
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFees", "100");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "0");

    // Check MarketParticipant
    let participantId = AGENT.toHexString() + "_" + MARKET_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "totalTraded", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalFees", "100");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "0");

    // Check Global
    assert.fieldEquals("Global", "", "totalTraded", "1000");
    assert.fieldEquals("Global", "", "totalFees", "100");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalFeesSettled", "0");

    // Day 3: Market resolves with different answer
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    // Check TraderAgent: settled totals now updated
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "100");

    // Check MarketParticipant: settled totals now updated
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "100");

    // Check Global: settled totals now updated
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");
    assert.fieldEquals("Global", "", "totalFeesSettled", "100");
  });

  /**
   * Test: Settled totals remain zero until payout (correct bet)
   * - Day 1: Place winning bet
   * - Check: totalTraded/totalFees updated, settled versions remain zero
   * - Day 3: Market resolves with correct answer
   * - Check: Settled totals still zero (waiting for payout)
   * - Day 7: Redeem payout
   * - Check: totalTradedSettled and totalFeesSettled now updated
   */
  test("Settled totals remain zero until payout (correct bet)", () => {
    setupMarket(MARKET_WON, MARKET_WON.toHexString());

    // Day 1: Place winning bet
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_WON, START_TS));

    // Check settled totals are zero
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "0");

    let participantId = AGENT.toHexString() + "_" + MARKET_WON.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "0");

    assert.fieldEquals("Global", "", "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalFeesSettled", "0");

    // Day 3: Market resolves with correct answer
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_WON, ANSWER_0_HEX, day3TS));

    // Check settled totals still zero (waiting for payout)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "0");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "0");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalFeesSettled", "0");

    // Day 7: Redeem payout
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2500), MARKET_WON, day7TS));

    // Check settled totals now updated
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "100");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "100");
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");
    assert.fieldEquals("Global", "", "totalFeesSettled", "100");
  });

  /**
   * Test: Mixed bets in same market - settled totals updated at different times
   * - Place two bets in same market (one will win, one will lose)
   * - On resolution: only the losing bet's amounts move to settled totals
   * - On payout: the winning bet's amounts move to settled totals
   * - Verify final settled totals equal total traded/fees
   */
  test("Mixed bets: settled totals updated at different times", () => {
    setupMarket(MARKET_WON, MARKET_WON.toHexString());

    // Place two bets on different outcomes
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(50), ANSWER_0, MARKET_WON, START_TS, 0)); // Will win
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(300), BigInt.fromI32(30), ANSWER_1, MARKET_WON, START_TS, 1)); // Will lose

    // Check totals after bets
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "800"); // 500 + 300
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFees", "80"); // 50 + 30
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "0");

    // Market resolves to Outcome 0 (first bet wins, second bet loses)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_WON, ANSWER_0_HEX, day3TS));

    // Check: only losing bet moved to settled (300 + 30)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "300");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "30");

    // Payout for winning bet
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(1200), MARKET_WON, day7TS));

    // Check: now all bets are settled (300 + 500 = 800, 30 + 50 = 80)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "800");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "80");

    // Verify settled equals total
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "800");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFees", "80");
  });

  /**
   * Test: Multiple markets - settled totals aggregate correctly
   * - Place bets in multiple markets
   * - Resolve markets at different times
   * - Verify settled totals accumulate correctly
   */
  test("Multiple markets: settled totals aggregate correctly", () => {
    setupMarket(MARKET_WON, MARKET_WON.toHexString());
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    // Place bets in both markets
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_WON, START_TS, 0));
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(2000), BigInt.fromI32(200), ANSWER_0, MARKET_LOST, START_TS, 1));

    // Check totals
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "3000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFees", "300");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "0");

    // Day 3: Market LOST resolves (bet loses)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    // Only MARKET_LOST bet settled
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "2000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "200");

    // Day 5: Market WON resolves (bet wins)
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_WON, ANSWER_0_HEX, day5TS));

    // Still only MARKET_LOST settled (WON bet waits for payout)
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "2000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "200");

    // Day 7: Payout for MARKET_WON
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2500), MARKET_WON, day7TS));

    // Now both markets settled
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "3000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "300");
  });

  /**
   * Test: Global entity - settled totals track all agents
   * - Create multiple agents
   * - Place bets from different agents
   * - Resolve markets
   * - Verify Global totals aggregate correctly
   */
  test("Global entity: settled totals track all agents", () => {
    let AGENT2 = Address.fromString("0x2234567890123456789012345678901234567890");

    // Setup second agent
    let agent2 = new TraderAgent(AGENT2);
    agent2.totalBets = 0;
    agent2.serviceId = BigInt.fromI32(2);
    agent2.totalTraded = BigInt.zero();
    agent2.totalPayout = BigInt.zero();
    agent2.totalFees = BigInt.zero();
    agent2.totalTradedSettled = BigInt.zero();
    agent2.totalFeesSettled = BigInt.zero();
    agent2.blockNumber = BigInt.fromI32(1000);
    agent2.blockTimestamp = START_TS;
    agent2.transactionHash = DUMMY_HASH;
    agent2.save();

    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    // Agent 1 places bet
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS, 0));

    // Agent 2 places bet
    handleBuy(createBuyEvent(AGENT2, BigInt.fromI32(500), BigInt.fromI32(50), ANSWER_0, MARKET_LOST, START_TS, 1));

    // Check Global totals
    assert.fieldEquals("Global", "", "totalTraded", "1500");
    assert.fieldEquals("Global", "", "totalFees", "150");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalFeesSettled", "0");

    // Market resolves (both bets lose)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    // Check Global settled totals aggregate from both agents
    assert.fieldEquals("Global", "", "totalTradedSettled", "1500");
    assert.fieldEquals("Global", "", "totalFeesSettled", "150");
  });

  /**
   * Test: Second answer event with invalid answer doesn't affect settled totals
   * - Day 1: Place losing bet (1000 + 100 fees)
   * - Day 3: First answer event resolves market (bet loses, totals settle)
   * - Day 5: Second answer event with different invalid answer
   * - Check: Settled totals remain the same after second event (no double-counting)
   */
  test("Second answer event with invalid answer doesn't affect settled totals", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    // Day 1: Place bet on Outcome 0
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS));

    // Verify initial state - settled totals are zero
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "0");

    let participantId = AGENT.toHexString() + "_" + MARKET_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "0");

    assert.fieldEquals("Global", "", "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalFeesSettled", "0");

    // Day 3: First answer event - market resolves to Outcome 1 (bet loses)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    // Verify totals are settled after first answer
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "100");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "100");
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");
    assert.fieldEquals("Global", "", "totalFeesSettled", "100");

    // Verify profit statistics for Day 3
    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1100");

    // Day 5: Second answer event with different invalid answer
    // This simulates the invalid answer scenario where a second answer is logged
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    let ANSWER_2_HEX = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000002");
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_2_HEX, day5TS));

    // CRITICAL VERIFICATION: Settled totals should remain unchanged after second event
    // The countedInTotal flag should prevent double-counting
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "100");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "100");
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");
    assert.fieldEquals("Global", "", "totalFeesSettled", "100");

    // Verify profit statistics for Day 5 - should not have new entry since bet was already counted
    let day5Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 4)).toString();
    assert.notInStore("DailyProfitStatistic", day5Id);

    // Verify Day 3 profit remains unchanged
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1100");
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
    let AGENT2 = Address.fromString("0x2234567890123456789012345678901234567890");
    let MARKET_A = MARKET_WON;
    let MARKET_B = MARKET_LOST;

    // Setup second agent
    let agent2 = new TraderAgent(AGENT2);
    agent2.totalBets = 0;
    agent2.serviceId = BigInt.fromI32(2);
    agent2.totalTraded = BigInt.zero();
    agent2.totalPayout = BigInt.zero();
    agent2.totalFees = BigInt.zero();
    agent2.totalTradedSettled = BigInt.zero();
    agent2.totalFeesSettled = BigInt.zero();
    agent2.blockNumber = BigInt.fromI32(1000);
    agent2.blockTimestamp = START_TS;
    agent2.transactionHash = DUMMY_HASH;
    agent2.save();

    setupMarket(MARKET_A, MARKET_A.toHexString());
    setupMarket(MARKET_B, MARKET_B.toHexString());

    // === PHASE 1: BETTING ===
    // Agent1 bets 1000+100 on Market A, Outcome 0 (will win)
    handleBuy(createBuyEvent(AGENT1, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_A, START_TS, 0));

    // Agent2 bets 500+50 on Market A, Outcome 1 (will lose)
    handleBuy(createBuyEvent(AGENT2, BigInt.fromI32(500), BigInt.fromI32(50), ANSWER_1, MARKET_A, START_TS, 1));

    // Agent2 bets 2000+200 on Market B, Outcome 0 (will lose)
    handleBuy(createBuyEvent(AGENT2, BigInt.fromI32(2000), BigInt.fromI32(200), ANSWER_0, MARKET_B, START_TS, 2));

    // Check Agent1 totals after betting
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalBets", "1");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTraded", "1000");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalFees", "100");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalFeesSettled", "0");

    // Check Agent2 totals after betting
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalBets", "2");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTraded", "2500"); // 500 + 2000
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalFees", "250"); // 50 + 200
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalFeesSettled", "0");

    // Check MarketParticipant for Agent1-MarketA
    let participant1A = AGENT1.toHexString() + "_" + MARKET_A.toHexString();
    assert.fieldEquals("MarketParticipant", participant1A, "totalBets", "1");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTraded", "1000");
    assert.fieldEquals("MarketParticipant", participant1A, "totalFees", "100");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participant1A, "totalFeesSettled", "0");

    // Check MarketParticipant for Agent2-MarketA
    let participant2A = AGENT2.toHexString() + "_" + MARKET_A.toHexString();
    assert.fieldEquals("MarketParticipant", participant2A, "totalBets", "1");
    assert.fieldEquals("MarketParticipant", participant2A, "totalTraded", "500");
    assert.fieldEquals("MarketParticipant", participant2A, "totalFees", "50");
    assert.fieldEquals("MarketParticipant", participant2A, "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participant2A, "totalFeesSettled", "0");

    // Check MarketParticipant for Agent2-MarketB
    let participant2B = AGENT2.toHexString() + "_" + MARKET_B.toHexString();
    assert.fieldEquals("MarketParticipant", participant2B, "totalBets", "1");
    assert.fieldEquals("MarketParticipant", participant2B, "totalTraded", "2000");
    assert.fieldEquals("MarketParticipant", participant2B, "totalFees", "200");
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participant2B, "totalFeesSettled", "0");

    // Check Global totals after all bets
    assert.fieldEquals("Global", "", "totalBets", "3");
    assert.fieldEquals("Global", "", "totalTraded", "3500"); // 1000 + 500 + 2000
    assert.fieldEquals("Global", "", "totalFees", "350"); // 100 + 50 + 200
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalFeesSettled", "0");

    // === PHASE 2: MARKET A RESOLVES (Outcome 0 wins) ===
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_A, ANSWER_0_HEX, day3TS));

    // Agent1's bet on Market A was correct - NOT settled yet (waiting for payout)
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalFeesSettled", "0");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participant1A, "totalFeesSettled", "0");

    // Agent2's bet on Market A was incorrect - settled immediately
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "500");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalFeesSettled", "50");
    assert.fieldEquals("MarketParticipant", participant2A, "totalTradedSettled", "500");
    assert.fieldEquals("MarketParticipant", participant2A, "totalFeesSettled", "50");

    // Agent2's Market B bet not settled yet
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participant2B, "totalFeesSettled", "0");

    // Global: only Agent2's Market A bet settled
    assert.fieldEquals("Global", "", "totalTradedSettled", "500");
    assert.fieldEquals("Global", "", "totalFeesSettled", "50");

    // === PHASE 3: MARKET B RESOLVES (Outcome 1 wins) ===
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_B, ANSWER_1_HEX, day5TS));

    // Agent2's bet on Market B was incorrect - now settled
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "2500"); // 500 + 2000
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalFeesSettled", "250"); // 50 + 200
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "2000");
    assert.fieldEquals("MarketParticipant", participant2B, "totalFeesSettled", "200");

    // Agent2's total settled should equal total traded (all bets lost)
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTraded", "2500");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalFees", "250");

    // Agent1 still not settled
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalFeesSettled", "0");

    // Global: Agent2's both bets settled
    assert.fieldEquals("Global", "", "totalTradedSettled", "2500");
    assert.fieldEquals("Global", "", "totalFeesSettled", "250");

    // === PHASE 4: AGENT1 REDEEMS PAYOUT ===
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT1, BigInt.fromI32(2500), MARKET_A, day7TS));

    // Agent1's winning bet now settled
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalFeesSettled", "100");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalPayout", "2500");
    assert.fieldEquals("MarketParticipant", participant1A, "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participant1A, "totalFeesSettled", "100");
    assert.fieldEquals("MarketParticipant", participant1A, "totalPayout", "2500");

    // Agent1's settled totals should equal total traded (bet won and paid out)
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTraded", "1000");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalFees", "100");

    // Global: all bets now settled
    assert.fieldEquals("Global", "", "totalTradedSettled", "3500"); // 500 + 2000 + 1000
    assert.fieldEquals("Global", "", "totalFeesSettled", "350"); // 50 + 200 + 100
    assert.fieldEquals("Global", "", "totalPayout", "2500");

    // Verify Global settled equals Global total (all markets settled)
    assert.fieldEquals("Global", "", "totalTraded", "3500");
    assert.fieldEquals("Global", "", "totalFees", "350");
  });
});
