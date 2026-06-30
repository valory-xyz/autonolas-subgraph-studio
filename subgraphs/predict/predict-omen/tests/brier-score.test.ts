import { assert, describe, test, clearStore, beforeEach } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { handleBuy, handleSell } from "../src/FixedProductMarketMakerMapping";
import { handleLogNewAnswer } from "../src/realitio";
import { createBuyEvent, createNewAnswerEvent, createSellEvent } from "./profit";
import { ConditionPreparation, FixedProductMarketMakerCreation, Question, TraderAgent } from "../generated/schema";

const AGENT = Address.fromString("0x1234567890123456789012345678901234567890");
const MARKET = Address.fromString("0x0000000000000000000000000000000000000010");
const ANSWER_0_HEX = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");
const ANSWER_1_HEX = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001");
const INVALID_HEX = Bytes.fromHexString("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
const DUMMY_HASH = Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234");
const START_TS = BigInt.fromI32(1710000000);
const NORMALIZED_TS = BigInt.fromI32(1709942400);

const ONE_E18 = BigInt.fromString("1000000000000000000");

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

function setupMarket(marketAddr: Address, questionId: string): void {
  let question = new Question(questionId);
  question.question = "Will it rain?";
  question.fixedProductMarketMaker = marketAddr;
  question.save();

  let condition = new ConditionPreparation(questionId);
  condition.questionId = Bytes.fromHexString(questionId);
  condition.conditionId = Bytes.fromHexString(questionId);
  condition.oracle = Address.zero();
  condition.outcomeSlotCount = BigInt.fromI32(2);
  condition.blockNumber = BigInt.fromI32(1000);
  condition.blockTimestamp = START_TS;
  condition.transactionHash = DUMMY_HASH;
  condition.save();

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

function dailyStatId(timestamp: BigInt): string {
  return AGENT.toHexString() + "_" + timestamp.toString();
}

describe("Brier Score", () => {
  beforeEach(() => {
    clearStore();
    setupAgent();
  });

  test("Buy records impliedProbability = investment / tokens (1e18-scaled)", () => {
    setupMarket(MARKET, "0x0000000000000000000000000000000000000000000000000000000000000001");
    // Investment 0.4, tokens 1.0 → implied probability 0.4 (4e17)
    let event = createBuyEvent(AGENT, BigInt.fromString("400000000000000000"), BigInt.zero(), BigInt.zero(), MARKET, START_TS, 0, ONE_E18);
    handleBuy(event);

    let id = event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString();
    assert.fieldEquals("Bet", id, "impliedProbability", "400000000000000000");
  });

  test("Sell records impliedProbability = returnAmount / tokensSold", () => {
    setupMarket(MARKET, "0x0000000000000000000000000000000000000000000000000000000000000001");
    // Return 0.6, tokens sold 1.0 → implied probability 0.6 (6e17)
    let event = createSellEvent(AGENT, BigInt.fromString("600000000000000000"), BigInt.zero(), BigInt.zero(), MARKET, START_TS, 0, ONE_E18);
    handleSell(event);

    let id = event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString();
    assert.fieldEquals("Bet", id, "impliedProbability", "600000000000000000");
    // Sells store negative amount
    assert.fieldEquals("Bet", id, "amount", "-600000000000000000");
  });

  test("Buy with zero tokens stores zero probability and is skipped at Brier", () => {
    setupMarket(MARKET, "0x0000000000000000000000000000000000000000000000000000000000000001");
    let event = createBuyEvent(AGENT, ONE_E18, BigInt.zero(), BigInt.zero(), MARKET, START_TS, 0, BigInt.zero());
    handleBuy(event);
    let id = event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString();
    assert.fieldEquals("Bet", id, "impliedProbability", "0");

    handleLogNewAnswer(createNewAnswerEvent(
      Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001"),
      ANSWER_1_HEX,
      START_TS
    ));
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierCount", "0");
  });

  test("Winning bet: Brier = (p - 1)^2; losing bet: Brier = p^2", () => {
    setupMarket(MARKET, "0x0000000000000000000000000000000000000000000000000000000000000001");
    // Bet on outcome 1 at p=0.4, market resolves to 1 (win).
    // Bet on outcome 0 at p=0.6, same market — resolves to 1 (loss).
    handleBuy(createBuyEvent(AGENT, BigInt.fromString("400000000000000000"), BigInt.zero(), BigInt.fromI32(1), MARKET, START_TS, 0, ONE_E18));
    handleBuy(createBuyEvent(AGENT, BigInt.fromString("600000000000000000"), BigInt.zero(), BigInt.zero(), MARKET, START_TS, 1, ONE_E18));

    handleLogNewAnswer(createNewAnswerEvent(
      Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001"),
      ANSWER_1_HEX,
      START_TS
    ));

    // Win contribution: (0.4 - 1)^2 = 0.36 = 360000000000000000
    // Loss contribution: (0.6 - 0)^2 = 0.36 = 360000000000000000
    // Sum: 0.72 = 720000000000000000
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierSum", "720000000000000000");
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierCount", "2");
  });

  test("Sell is excluded from Brier", () => {
    setupMarket(MARKET, "0x0000000000000000000000000000000000000000000000000000000000000001");
    // Buy then Sell, same outcome. Only the buy should contribute to Brier.
    handleBuy(createBuyEvent(AGENT, BigInt.fromString("400000000000000000"), BigInt.zero(), BigInt.fromI32(1), MARKET, START_TS, 0, BigInt.fromString("2000000000000000000")));
    handleSell(createSellEvent(AGENT, BigInt.fromString("200000000000000000"), BigInt.zero(), BigInt.fromI32(1), MARKET, START_TS, 1, ONE_E18));

    handleLogNewAnswer(createNewAnswerEvent(
      Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001"),
      ANSWER_1_HEX,
      START_TS
    ));

    // Only the buy contributes: p = 0.4/2.0 = 0.2 → (0.2 - 1)^2 = 0.64 = 640000000000000000
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierSum", "640000000000000000");
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierCount", "1");
  });

  test("Invalid answer: Brier vs 0.5 actual for both outcomes", () => {
    setupMarket(MARKET, "0x0000000000000000000000000000000000000000000000000000000000000001");
    // Bet on outcome 0 at p=0.4; bet on outcome 1 at p=0.6. Market resolves invalid.
    handleBuy(createBuyEvent(AGENT, BigInt.fromString("400000000000000000"), BigInt.zero(), BigInt.zero(), MARKET, START_TS, 0, ONE_E18));
    handleBuy(createBuyEvent(AGENT, BigInt.fromString("600000000000000000"), BigInt.zero(), BigInt.fromI32(1), MARKET, START_TS, 1, ONE_E18));

    handleLogNewAnswer(createNewAnswerEvent(
      Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001"),
      INVALID_HEX,
      START_TS
    ));

    // Bet 1: (0.4 - 0.5)^2 = 0.01 = 10000000000000000
    // Bet 2: (0.6 - 0.5)^2 = 0.01 = 10000000000000000
    // Sum: 0.02 = 20000000000000000
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierSum", "20000000000000000");
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierCount", "2");
  });

  test("Re-answer: subtracts old Brier from old day, applies new Brier to new day", () => {
    setupMarket(MARKET, "0x0000000000000000000000000000000000000000000000000000000000000001");
    // Buy on outcome 1 at p=0.4.
    handleBuy(createBuyEvent(AGENT, BigInt.fromString("400000000000000000"), BigInt.zero(), BigInt.fromI32(1), MARKET, START_TS, 0, ONE_E18));

    // Day A: settles to answer 0 (bet loses). Brier = (0.4 - 0)^2 = 0.16
    handleLogNewAnswer(createNewAnswerEvent(
      Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001"),
      ANSWER_0_HEX,
      START_TS
    ));

    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierSum", "160000000000000000");
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierCount", "1");

    // Day B (2 days later): re-answer flips to 1 (bet now wins). Brier = (0.4 - 1)^2 = 0.36
    let DAY_B = BigInt.fromI32(1710172800);  // START_TS + 2 days, precomputed
    let DAY_B_BUCKET = BigInt.fromI32(1710115200);
    handleLogNewAnswer(createNewAnswerEvent(
      Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001"),
      ANSWER_1_HEX,
      DAY_B
    ));

    // Old day reverted to zero
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierSum", "0");
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierCount", "0");

    // New day has the new Brier
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(DAY_B_BUCKET), "brierSum", "360000000000000000");
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(DAY_B_BUCKET), "brierCount", "1");
  });

  test("Chained re-answer (A→B→A): reversal walks back to the original Brier on the latest day", () => {
    setupMarket(MARKET, "0x0000000000000000000000000000000000000000000000000000000000000001");
    // Buy on outcome 1 at p=0.4.
    handleBuy(createBuyEvent(AGENT, BigInt.fromString("400000000000000000"), BigInt.zero(), BigInt.fromI32(1), MARKET, START_TS, 0, ONE_E18));

    // Day A: answer 0 (bet loses). Brier = (0.4 - 0)^2 = 0.16
    handleLogNewAnswer(createNewAnswerEvent(
      Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001"),
      ANSWER_0_HEX,
      START_TS
    ));

    // Day B (+2 days): re-answer flips to 1 (bet wins). Brier = (0.4 - 1)^2 = 0.36
    let DAY_B = BigInt.fromI32(1710172800);
    let DAY_B_BUCKET = BigInt.fromI32(1710115200);
    handleLogNewAnswer(createNewAnswerEvent(
      Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001"),
      ANSWER_1_HEX,
      DAY_B
    ));

    // Day C (+4 days): re-answer flips back to 0 (bet loses again). Brier should be (0.4 - 0)^2 = 0.16
    let DAY_C = BigInt.fromI32(1710345600);
    let DAY_C_BUCKET = BigInt.fromI32(1710288000);
    handleLogNewAnswer(createNewAnswerEvent(
      Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001"),
      ANSWER_0_HEX,
      DAY_C
    ));

    // Day A still reverted to zero (was zeroed at the A→B step, B→A reversal targets day B only).
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierSum", "0");
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(NORMALIZED_TS), "brierCount", "0");

    // Day B is now reverted: B→A reversal subtracted the 0.36 credited at A→B.
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(DAY_B_BUCKET), "brierSum", "0");
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(DAY_B_BUCKET), "brierCount", "0");

    // Day C carries the latest Brier — same as the original day-A value, but attributed to day C.
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(DAY_C_BUCKET), "brierSum", "160000000000000000");
    assert.fieldEquals("DailyProfitStatistic", dailyStatId(DAY_C_BUCKET), "brierCount", "1");
  });
});
