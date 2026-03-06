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
  agent.totalExpectedPayout = BigInt.zero();
  agent.totalFees = BigInt.zero();
  agent.totalTradedSettled = BigInt.zero();
  agent.totalFeesSettled = BigInt.zero();
  agent.blockNumber = BigInt.fromI32(1000);
  agent.blockTimestamp = START_TS;
  agent.transactionHash = DUMMY_HASH;
  agent.save();
}

function setupAgent2(addr: Address): void {
  let agent = new TraderAgent(addr);
  agent.totalBets = 0;
  agent.serviceId = BigInt.fromI32(2);
  agent.totalTraded = BigInt.zero();
  agent.totalPayout = BigInt.zero();
  agent.totalExpectedPayout = BigInt.zero();
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
   * - Check: Activity (totalTraded/totalFees) is updated, Daily Profit is 0 (Market still open).
   */
  test("Day 1: Activity is recorded, Profit is 0", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS, 0, BigInt.fromI32(2000)));

    let day1Id = AGENT.toHexString() + "_" + NORMALIZED_TS.toString();
    assert.fieldEquals("DailyProfitStatistic", day1Id, "totalTraded", "1000");
    assert.fieldEquals("DailyProfitStatistic", day1Id, "totalFees", "100");
    assert.fieldEquals("DailyProfitStatistic", day1Id, "dailyProfit", "0");
  });

  /**
   * Scenario 2: Immediate Loss on Resolution
   * - Day 1: Place bet on Outcome 0 (Cost: 1100), gets 2000 outcome tokens.
   * - Day 3: Market resolves to Outcome 1.
   * - Check: expectedPayout = 0 (wrong outcome), loss = -(1000 + 100) = -1100 on Day 3.
   */
  test("Day 3: Market Resolution Loss records negative daily profit", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS, 0, BigInt.fromI32(2000)));

    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1100");
    assert.fieldEquals("DailyProfitStatistic", day3Id, "profitParticipants", "[" + MARKET_LOST.toHexString() + "]");

    // expectedPayout should be 0 (bet on outcome 0, answer is 1)
    let participantId = AGENT.toHexString() + "_" + MARKET_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "0");
    assert.fieldEquals("MarketParticipant", participantId, "settled", "true");
  });

  /**
   * Scenario 3: Win Profit at Settlement Time
   * - Day 1: Place winning bet on Outcome 0 (Cost: 1100, gets 2500 tokens).
   * - Day 3: Market resolves to Outcome 0.
   * - Check: expectedPayout = 2500, profit = 2500 - 1000 - 100 = 1400 recorded on Day 3.
   * - Day 7: Agent redeems 2500 — only totalPayout updated, no profit change.
   */
  test("Day 3: Settlement records net win profit, Day 7 payout only tracks claimed amount", () => {
    setupMarket(MARKET_WON, MARKET_WON.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_WON, START_TS, 0, BigInt.fromI32(2500)));

    // Day 3: Market Resolves
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_WON, ANSWER_0_HEX, day3TS));

    // Profit recorded on settlement day (Day 3), not payout day
    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "1400"); // 2500 - 1000 - 100
    assert.fieldEquals("DailyProfitStatistic", day3Id, "profitParticipants", "[" + MARKET_WON.toHexString() + "]");

    // Participant settled with expected payout
    let participantId = AGENT.toHexString() + "_" + MARKET_WON.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "2500");
    assert.fieldEquals("MarketParticipant", participantId, "settled", "true");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "100");

    // Agent totalExpectedPayout updated
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "2500");

    // Day 7: Payout — only totalPayout updated, no profit change
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    let day7TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2500), MARKET_WON, day7TS));

    let day7Id = AGENT.toHexString() + "_" + day7TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day7Id, "totalPayout", "2500");
    assert.fieldEquals("DailyProfitStatistic", day7Id, "dailyProfit", "0"); // No profit change on payout day

    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalPayout", "2500");
    assert.fieldEquals("MarketParticipant", participantId, "totalPayout", "2500");
  });

  /**
   * Scenario 4: Complex Multi-Market
   * - Market A: Bet 1 on outcome 0 (wins, 1200 tokens), Bet 2 on outcome 1 (loses, 800 tokens)
   * - Market B: Bet 3 on outcome 0 (loses, 2000 tokens)
   * - Day 3: Both resolve — ALL profit/loss on settlement day.
   * - Day 5: Payout for Market A — only totalPayout update.
   */
  test("Complex: Multiple markets, split bets, all profit on settlement day", () => {
    let MARKET_A = MARKET_WON;
    let MARKET_B = MARKET_LOST;

    setupMarket(MARKET_A, MARKET_A.toHexString());
    setupMarket(MARKET_B, MARKET_B.toHexString());

    // Market A: 2 bets (one wins, one loses)
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(50), ANSWER_0, MARKET_A, START_TS, 0, BigInt.fromI32(1200)));
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(50), ANSWER_1, MARKET_A, START_TS, 1, BigInt.fromI32(800)));

    // Market B: 1 bet (will lose)
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_B, START_TS, 2, BigInt.fromI32(2000)));

    // Day 3: Both markets resolve
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();

    // Market A resolves to 0: expectedPayout = outcomeTokenBalance0 = 1200
    // profit = 1200 - (500+500) - (50+50) = 1200 - 1000 - 100 = 100
    handleLogNewAnswer(createNewAnswerEvent(MARKET_A, ANSWER_0_HEX, day3TS));

    // Market B resolves to 1: expectedPayout = outcomeTokenBalance1 = 0
    // profit = 0 - 1000 - 100 = -1100
    handleLogNewAnswer(createNewAnswerEvent(MARKET_B, ANSWER_1_HEX, day3TS));

    // Day 3 total profit: 100 + (-1100) = -1000
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1000");
    assert.fieldEquals(
      "DailyProfitStatistic",
      day3Id,
      "profitParticipants",
      "[" + MARKET_A.toHexString() + ", " + MARKET_B.toHexString() + "]"
    );

    // Day 5: Payout for Market A — only totalPayout, no profit change
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    let day5Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 4)).toString();

    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(1200), MARKET_A, day5TS));

    assert.fieldEquals("DailyProfitStatistic", day5Id, "totalPayout", "1200");
    assert.fieldEquals("DailyProfitStatistic", day5Id, "dailyProfit", "0"); // No profit on payout day
  });

  test("Edge Case: Multiple losing bets in one market resolution", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(10), ANSWER_0, MARKET_LOST, START_TS, 0, BigInt.fromI32(200)));
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(10), ANSWER_0, MARKET_LOST, START_TS, 1, BigInt.fromI32(200)));
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(100), BigInt.fromI32(10), ANSWER_0, MARKET_LOST, START_TS, 2, BigInt.fromI32(200)));

    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();
    // expectedPayout = 0 (bet on outcome 0, answer is 1, balance1 = 0)
    // loss = 0 - 300 - 30 = -330
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-330");
  });

  test("Aggregation: Two different markets resolving on the same day for same agent", () => {
    let qIdA = MARKET_WON.toHexString();
    let qIdB = MARKET_LOST.toHexString();

    setupMarket(MARKET_WON, qIdA);
    setupMarket(MARKET_LOST, qIdB);

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_WON, START_TS, 0, BigInt.fromI32(2000)));
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(2000), BigInt.fromI32(200), ANSWER_0, MARKET_LOST, START_TS, 1, BigInt.fromI32(4000)));

    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));

    // Both markets resolve to answer 1 — both bets on outcome 0 lose
    handleLogNewAnswer(createNewAnswerEvent(Bytes.fromUint8Array(MARKET_WON), ANSWER_1_HEX, day3TS));
    handleLogNewAnswer(createNewAnswerEvent(Bytes.fromUint8Array(MARKET_LOST), ANSWER_1_HEX, day3TS));

    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();

    // Market WON: expectedPayout = balance1 = 0, profit = -1100
    // Market LOST: expectedPayout = balance1 = 0, profit = -2200
    // Total: -3300
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-3300");
  });

  /**
   * Test: Settled totals updated at settlement for incorrect bet
   */
  test("Settled totals updated at settlement (incorrect bet)", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS, 0, BigInt.fromI32(2000)));

    // Before settlement: settled totals zero
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFees", "100");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "0");

    let participantId = AGENT.toHexString() + "_" + MARKET_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "0");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "0");

    assert.fieldEquals("Global", "", "totalTradedSettled", "0");
    assert.fieldEquals("Global", "", "totalFeesSettled", "0");

    // Settlement: bet loses
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    // After settlement: all settled
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "100");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "100");
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");
    assert.fieldEquals("Global", "", "totalFeesSettled", "100");
  });

  /**
   * Test: Settled totals updated at settlement for correct bet (NOT at payout)
   * This is the key semantic change from the old model.
   */
  test("Settled totals updated at settlement (correct bet) — not at payout", () => {
    setupMarket(MARKET_WON, MARKET_WON.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_WON, START_TS, 0, BigInt.fromI32(2500)));

    // Before settlement: settled totals zero
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "0");

    let participantId = AGENT.toHexString() + "_" + MARKET_WON.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "0");

    // Settlement: bet wins — settled totals updated NOW (not at payout)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_WON, ANSWER_0_HEX, day3TS));

    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "100");
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "1000");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "100");
    assert.fieldEquals("Global", "", "totalTradedSettled", "1000");
    assert.fieldEquals("Global", "", "totalFeesSettled", "100");

    // Payout does NOT change settled totals (already done)
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2500), MARKET_WON, day7TS));

    // Settled totals unchanged after payout
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "100");
    // But totalPayout updated
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalPayout", "2500");
  });

  /**
   * Test: Mixed bets — all settled at settlement time
   */
  test("Mixed bets: all settled at settlement time", () => {
    setupMarket(MARKET_WON, MARKET_WON.toHexString());

    // Bet 1: outcome 0, wins (gets 1200 tokens)
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(500), BigInt.fromI32(50), ANSWER_0, MARKET_WON, START_TS, 0, BigInt.fromI32(1200)));
    // Bet 2: outcome 1, loses (gets 400 tokens)
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(300), BigInt.fromI32(30), ANSWER_1, MARKET_WON, START_TS, 1, BigInt.fromI32(400)));

    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "800");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFees", "80");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");

    // Settlement: outcome 0 wins — ALL settled at once (participant-level)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_WON, ANSWER_0_HEX, day3TS));

    // Both bets settled at settlement, not split across settlement+payout
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "800");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "80");

    let participantId = AGENT.toHexString() + "_" + MARKET_WON.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "totalTradedSettled", "800");
    assert.fieldEquals("MarketParticipant", participantId, "totalFeesSettled", "80");
    // expectedPayout = outcomeTokenBalance0 = 1200 (answer 0)
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "1200");
    // profit = 1200 - 800 - 80 = 320
    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "320");

    // Payout doesn't change settled totals
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(1200), MARKET_WON, day7TS));
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "800");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "80");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "800");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFees", "80");
  });

  /**
   * Test: Multiple markets — all settled at settlement time
   */
  test("Multiple markets: settled totals aggregate correctly at settlement", () => {
    setupMarket(MARKET_WON, MARKET_WON.toHexString());
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    // Market WON: bet wins
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_WON, START_TS, 0, BigInt.fromI32(2500)));
    // Market LOST: bet loses
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(2000), BigInt.fromI32(200), ANSWER_0, MARKET_LOST, START_TS, 1, BigInt.fromI32(4000)));

    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTraded", "3000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "0");

    // Day 3: MARKET_LOST resolves (bet loses)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "2000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "200");

    // Day 5: MARKET_WON resolves (bet wins) — settled at settlement, not payout
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_WON, ANSWER_0_HEX, day5TS));

    // NOW both markets settled
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "3000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "300");
    assert.fieldEquals("Global", "", "totalTradedSettled", "3000");
    assert.fieldEquals("Global", "", "totalFeesSettled", "300");

    // No change after payout
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2500), MARKET_WON, day7TS));

    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "3000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalPayout", "2500");
  });

  /**
   * Test: Global entity tracks all agents
   */
  test("Global entity: settled totals track all agents", () => {
    let AGENT2 = Address.fromString("0x2234567890123456789012345678901234567890");
    setupAgent2(AGENT2);
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS, 0, BigInt.fromI32(2000)));
    handleBuy(createBuyEvent(AGENT2, BigInt.fromI32(500), BigInt.fromI32(50), ANSWER_0, MARKET_LOST, START_TS, 1, BigInt.fromI32(1000)));

    assert.fieldEquals("Global", "", "totalTraded", "1500");
    assert.fieldEquals("Global", "", "totalFees", "150");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");

    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    assert.fieldEquals("Global", "", "totalTradedSettled", "1500");
    assert.fieldEquals("Global", "", "totalFeesSettled", "150");
  });

  /**
   * Test: Same-answer resubmission — participant.settled prevents re-processing
   */
  test("Same-answer resubmission: participant.settled prevents double-counting", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS, 0, BigInt.fromI32(2000)));

    // First answer — settlement
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    let participantId = AGENT.toHexString() + "_" + MARKET_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "settled", "true");

    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1100");

    // Same answer resubmitted (higher bond) — should be skipped
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day5TS));

    // Settled totals unchanged
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "100");

    // No new daily stat created
    let day5Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 4)).toString();
    assert.notInStore("DailyProfitStatistic", day5Id);

    // Day 3 profit unchanged
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1100");
  });

  /**
   * Test: Re-answer — answer changes from losing to winning (cross-day)
   * - Day 1: Bet on outcome 0 (1000 + 100 fee, gets 2000 tokens)
   * - Day 3: First answer = 1 (loss): profit = 0 - 1000 - 100 = -1100
   * - Day 4: Re-answer = 0 (win): reverses day 3, applies profit = 2000 - 0 - 0 = 2000 on day 4
   */
  test("Re-answer: losing to winning reverses old profit, applies new", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS, 0, BigInt.fromI32(2000)));

    // Day 3: First answer (outcome 1 — agent loses)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day3TS));

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-1100");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "0");

    let participantId = AGENT.toHexString() + "_" + MARKET_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "0");

    // Day 4: Re-answer (outcome 0 — agent now wins!)
    let day4TS = START_TS.plus(BigInt.fromI32(DAY * 3));
    let day4TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 3));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_0_HEX, day4TS));

    // Old daily stat reversed: -1100 - (-1100) = 0
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "0");
    assert.fieldEquals("DailyProfitStatistic", day3Id, "profitParticipants", "[]");

    // New daily stat: full profit = 2000 - 1000 - 100 = 900
    let day4Id = AGENT.toHexString() + "_" + day4TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day4Id, "dailyProfit", "900");
    assert.fieldEquals("DailyProfitStatistic", day4Id, "profitParticipants", "[" + MARKET_LOST.toHexString() + "]");

    // Participant updated
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "2000");
    assert.fieldEquals("MarketParticipant", participantId, "settled", "true");

    // Agent updated
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "2000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalFeesSettled", "100");

    // Global updated (negative delta handled)
    assert.fieldEquals("Global", "", "totalExpectedPayout", "2000");
  });

  /**
   * Test: Re-answer — answer changes from winning to losing (cross-day)
   * Verifies negative expectedPayout delta is saved to global.
   */
  test("Re-answer: winning to losing reverses profit, global handles negative delta", () => {
    setupMarket(MARKET_WON, MARKET_WON.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_WON, START_TS, 0, BigInt.fromI32(2500)));

    // Day 3: First answer (outcome 0 — agent wins)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_WON, ANSWER_0_HEX, day3TS));

    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "2500");
    assert.fieldEquals("Global", "", "totalExpectedPayout", "2500");

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "1400"); // 2500 - 1000 - 100

    // Day 4: Re-answer (outcome 1 — agent now loses)
    let day4TS = START_TS.plus(BigInt.fromI32(DAY * 3));
    let day4TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 3));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_WON, ANSWER_1_HEX, day4TS));

    // Old daily stat reversed
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "0");

    // New daily stat: full profit = 0 - 1000 - 100 = -1100
    let day4Id = AGENT.toHexString() + "_" + day4TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day4Id, "dailyProfit", "-1100");

    // Agent: expectedPayout went from 2500 to 0
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "0");

    // Global: negative delta correctly saved
    assert.fieldEquals("Global", "", "totalExpectedPayout", "0");
  });

  /**
   * Test: Re-answer — valid to invalid answer
   * Verifies [1,1] split payout on re-answer.
   */
  test("Re-answer: valid to invalid applies half-payout", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    // Bet on outcome 0: 816 invested, 0 fee, 1352 tokens
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(816), BigInt.fromI32(0), ANSWER_0, MARKET_LOST, START_TS, 0, BigInt.fromI32(1352)));

    // Day 3: First answer (outcome 0 — wins)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_0_HEX, day3TS));

    let participantId = AGENT.toHexString() + "_" + MARKET_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "1352");

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "536"); // 1352 - 816 - 0

    // Day 4: Re-answer (invalid)
    let day4TS = START_TS.plus(BigInt.fromI32(DAY * 3));
    let day4TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 3));
    let INVALID_ANSWER = Bytes.fromHexString("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, INVALID_ANSWER, day4TS));

    // expectedPayout = 1352/2 + 0/2 = 676
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "676");

    // Old daily stat reversed
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "0");

    // New daily stat: full profit = 676 - 816 - 0 = -140
    let day4Id = AGENT.toHexString() + "_" + day4TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day4Id, "dailyProfit", "-140");

    // Agent expectedPayout updated: 1352 -> 676
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "676");
  });

  /**
   * Test: Triple re-answer — A→B→C chains correctly
   * Each re-answer uses full market cost for profit, ensuring correct reconstruction.
   */
  test("Triple re-answer: A->B->C chains correctly", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    // Bet on outcome 0: 1000 + 100 fee, 2000 tokens
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_LOST, START_TS, 0, BigInt.fromI32(2000)));

    // Answer A (outcome 0 — wins): profit = 2000 - 1000 - 100 = 900
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let day3TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_0_HEX, day3TS));

    let day3Id = AGENT.toHexString() + "_" + day3TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "900");
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "2000");

    // Answer B (outcome 1 — loses): reverses day 3, full profit = 0 - 1000 - 100 = -1100 on day 4
    let day4TS = START_TS.plus(BigInt.fromI32(DAY * 3));
    let day4TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 3));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_1_HEX, day4TS));

    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "0"); // reversed
    let day4Id = AGENT.toHexString() + "_" + day4TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day4Id, "dailyProfit", "-1100"); // full: 0 - 1000 - 100
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "0");

    // Answer C (outcome 0 — wins again): reverses day 4 (-1100), full profit = 900 on day 5
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    let day5TSNormalized = NORMALIZED_TS.plus(BigInt.fromI32(DAY * 4));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, ANSWER_0_HEX, day5TS));

    assert.fieldEquals("DailyProfitStatistic", day4Id, "dailyProfit", "0"); // -1100 reversed
    let day5Id = AGENT.toHexString() + "_" + day5TSNormalized.toString();
    assert.fieldEquals("DailyProfitStatistic", day5Id, "dailyProfit", "900"); // full: 2000 - 1000 - 100
    assert.fieldEquals("TraderAgent", AGENT.toHexString(), "totalExpectedPayout", "2000");

    // Participant final state
    let participantId = AGENT.toHexString() + "_" + MARKET_LOST.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "2000");
    assert.fieldEquals("MarketParticipant", participantId, "settled", "true");
  });

  /**
   * Test: Comprehensive multi-agent, multi-market lifecycle
   */
  test("Comprehensive: TraderAgent, MarketParticipant, and Global totals tracking", () => {
    let AGENT1 = AGENT;
    let AGENT2 = Address.fromString("0x2234567890123456789012345678901234567890");
    let MARKET_A = MARKET_WON;
    let MARKET_B = MARKET_LOST;

    setupAgent2(AGENT2);
    setupMarket(MARKET_A, MARKET_A.toHexString());
    setupMarket(MARKET_B, MARKET_B.toHexString());

    // === PHASE 1: BETTING ===
    // Agent1: outcome 0 on Market A (will win, gets 2500 tokens)
    handleBuy(createBuyEvent(AGENT1, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_A, START_TS, 0, BigInt.fromI32(2500)));
    // Agent2: outcome 1 on Market A (will lose, gets 800 tokens)
    handleBuy(createBuyEvent(AGENT2, BigInt.fromI32(500), BigInt.fromI32(50), ANSWER_1, MARKET_A, START_TS, 1, BigInt.fromI32(800)));
    // Agent2: outcome 0 on Market B (will lose, gets 4000 tokens)
    handleBuy(createBuyEvent(AGENT2, BigInt.fromI32(2000), BigInt.fromI32(200), ANSWER_0, MARKET_B, START_TS, 2, BigInt.fromI32(4000)));

    // Check after betting
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalBets", "1");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTraded", "1000");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalBets", "2");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTraded", "2500");
    assert.fieldEquals("Global", "", "totalBets", "3");
    assert.fieldEquals("Global", "", "totalTraded", "3500");
    assert.fieldEquals("Global", "", "totalTradedSettled", "0");

    let participant1A = AGENT1.toHexString() + "_" + MARKET_A.toHexString();
    let participant2A = AGENT2.toHexString() + "_" + MARKET_A.toHexString();
    let participant2B = AGENT2.toHexString() + "_" + MARKET_B.toHexString();

    // === PHASE 2: MARKET A RESOLVES (Outcome 0 wins) ===
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_A, ANSWER_0_HEX, day3TS));

    // Agent1: won — settled at settlement time (expectedPayout = 2500)
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalTradedSettled", "1000");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalFeesSettled", "100");
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalExpectedPayout", "2500");
    assert.fieldEquals("MarketParticipant", participant1A, "expectedPayout", "2500");
    assert.fieldEquals("MarketParticipant", participant1A, "settled", "true");

    // Agent2: lost — settled at settlement time (expectedPayout = 0)
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "500");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalFeesSettled", "50");
    assert.fieldEquals("MarketParticipant", participant2A, "expectedPayout", "0");
    assert.fieldEquals("MarketParticipant", participant2A, "settled", "true");

    // Agent2's Market B not settled yet
    assert.fieldEquals("MarketParticipant", participant2B, "settled", "false");
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "0");

    // Global: Agent1's Market A + Agent2's Market A settled
    assert.fieldEquals("Global", "", "totalTradedSettled", "1500"); // 1000 + 500
    assert.fieldEquals("Global", "", "totalFeesSettled", "150"); // 100 + 50

    // === PHASE 3: MARKET B RESOLVES (Outcome 1 wins) ===
    let day5TS = START_TS.plus(BigInt.fromI32(DAY * 4));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_B, ANSWER_1_HEX, day5TS));

    // Agent2's Market B now settled
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalTradedSettled", "2500");
    assert.fieldEquals("TraderAgent", AGENT2.toHexString(), "totalFeesSettled", "250");
    assert.fieldEquals("MarketParticipant", participant2B, "totalTradedSettled", "2000");
    assert.fieldEquals("MarketParticipant", participant2B, "settled", "true");

    // Global: all settled
    assert.fieldEquals("Global", "", "totalTradedSettled", "3500");
    assert.fieldEquals("Global", "", "totalFeesSettled", "350");

    // === PHASE 4: AGENT1 REDEEMS ===
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    handlePayoutRedemption(createPayoutRedemptionEvent(AGENT1, BigInt.fromI32(2500), MARKET_A, day7TS));

    // Payout tracked
    assert.fieldEquals("TraderAgent", AGENT1.toHexString(), "totalPayout", "2500");
    assert.fieldEquals("MarketParticipant", participant1A, "totalPayout", "2500");
    assert.fieldEquals("Global", "", "totalPayout", "2500");

    // Settled totals unchanged after payout
    assert.fieldEquals("Global", "", "totalTradedSettled", "3500");
    assert.fieldEquals("Global", "", "totalFeesSettled", "350");
    assert.fieldEquals("Global", "", "totalTraded", "3500");
    assert.fieldEquals("Global", "", "totalFees", "350");
  });

  /**
   * Test: PayoutRedemption creates debug log entity
   */
  test("PayoutRedemption creates PayoutRedemption for debugging", () => {
    setupMarket(MARKET_WON, MARKET_WON.toHexString());

    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(1000), BigInt.fromI32(100), ANSWER_0, MARKET_WON, START_TS, 0, BigInt.fromI32(2500)));

    // Settle
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    handleLogNewAnswer(createNewAnswerEvent(MARKET_WON, ANSWER_0_HEX, day3TS));

    // Payout
    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    let redeemEvent = createPayoutRedemptionEvent(AGENT, BigInt.fromI32(2500), MARKET_WON, day7TS);
    handlePayoutRedemption(redeemEvent);

    // Verify PayoutRedemption was created
    let logId = redeemEvent.transaction.hash.concatI32(redeemEvent.logIndex.toI32()).toHexString();
    assert.fieldEquals("PayoutRedemption", logId, "payoutAmount", "2500");
    assert.fieldEquals("PayoutRedemption", logId, "redeemer", AGENT.toHexString());
  });

  /**
   * Test: Invalid answer — equal split payout [1,1]
   * Each token worth 1/2 collateral.
   */
  test("Invalid answer: expectedPayout = balance0/2 + balance1/2", () => {
    setupMarket(MARKET_LOST, MARKET_LOST.toHexString());

    // Bet on outcome 0: 816 invested, 0 fee, 1352 tokens bought
    handleBuy(createBuyEvent(AGENT, BigInt.fromI32(816), BigInt.fromI32(0), ANSWER_0, MARKET_LOST, START_TS, 0, BigInt.fromI32(1352)));

    // Invalid answer (not 0 or 1)
    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let INVALID_ANSWER = Bytes.fromHexString("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    handleLogNewAnswer(createNewAnswerEvent(MARKET_LOST, INVALID_ANSWER, day3TS));

    let participantId = AGENT.toHexString() + "_" + MARKET_LOST.toHexString();
    // expectedPayout = 1352/2 + 0/2 = 676
    assert.fieldEquals("MarketParticipant", participantId, "expectedPayout", "676");
    assert.fieldEquals("MarketParticipant", participantId, "settled", "true");

    // profit = 676 - 816 - 0 = -140
    let day3Id = AGENT.toHexString() + "_" + NORMALIZED_TS.plus(BigInt.fromI32(DAY * 2)).toString();
    assert.fieldEquals("DailyProfitStatistic", day3Id, "dailyProfit", "-140");
  });
});
