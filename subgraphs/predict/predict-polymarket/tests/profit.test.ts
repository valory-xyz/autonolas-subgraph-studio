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
});
