import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleTokenRegistered, handleOrderFilled } from "../src/ctf-exchange";
import { TokenRegistered, OrderFilled } from "../generated/CTFExchange/CTFExchange";
import { TraderAgent, Question, MarketMetadata } from "../generated/schema";

const CONDITION_ID = Bytes.fromHexString("0x1111111111111111111111111111111111111111111111111111111111111111");
const TOKEN_0 = BigInt.fromI32(100);
const TOKEN_1 = BigInt.fromI32(101);
const TAKER = Address.fromString("0x1234567890123456789012345678901234567890");
const MAKER = Address.fromString("0x2234567890123456789012345678901234567890");
const ORDER_HASH = Bytes.fromHexString("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");

function createTokenRegisteredEvent(
  token0: BigInt,
  token1: BigInt,
  conditionId: Bytes
): TokenRegistered {
  let event = changetype<TokenRegistered>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(new ethereum.EventParam("token0", ethereum.Value.fromUnsignedBigInt(token0)));
  event.parameters.push(new ethereum.EventParam("token1", ethereum.Value.fromUnsignedBigInt(token1)));
  event.parameters.push(new ethereum.EventParam("conditionId", ethereum.Value.fromFixedBytes(conditionId)));

  return event;
}

function createOrderFilledEvent(
  orderHash: Bytes,
  maker: Address,
  taker: Address,
  makerAssetId: BigInt,
  takerAssetId: BigInt,
  makerAmountFilled: BigInt,
  takerAmountFilled: BigInt,
  fee: BigInt
): OrderFilled {
  let event = changetype<OrderFilled>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(new ethereum.EventParam("orderHash", ethereum.Value.fromFixedBytes(orderHash)));
  event.parameters.push(new ethereum.EventParam("maker", ethereum.Value.fromAddress(maker)));
  event.parameters.push(new ethereum.EventParam("taker", ethereum.Value.fromAddress(taker)));
  event.parameters.push(new ethereum.EventParam("makerAssetId", ethereum.Value.fromUnsignedBigInt(makerAssetId)));
  event.parameters.push(new ethereum.EventParam("takerAssetId", ethereum.Value.fromUnsignedBigInt(takerAssetId)));
  event.parameters.push(new ethereum.EventParam("makerAmountFilled", ethereum.Value.fromUnsignedBigInt(makerAmountFilled)));
  event.parameters.push(new ethereum.EventParam("takerAmountFilled", ethereum.Value.fromUnsignedBigInt(takerAmountFilled)));
  event.parameters.push(new ethereum.EventParam("fee", ethereum.Value.fromUnsignedBigInt(fee)));

  return event;
}

function setupTraderAgent(address: Address, serviceId: BigInt): void {
  let agent = new TraderAgent(address);
  agent.serviceId = serviceId;
  agent.totalBets = 0;
  agent.totalTraded = BigInt.zero();
  agent.totalTradedSettled = BigInt.zero();
  agent.totalPayout = BigInt.zero();
  agent.blockNumber = BigInt.fromI32(1);
  agent.blockTimestamp = BigInt.fromI32(1);
  agent.transactionHash = Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234");
  agent.save();
}

function setupQuestion(conditionId: Bytes, questionId: Bytes): void {
  let metadata = new MarketMetadata(questionId);
  metadata.title = "Test Question";
  metadata.outcomes = ["Yes", "No"];
  metadata.rawAncillaryData = "test";
  metadata.save();

  let question = new Question(conditionId);
  question.questionId = questionId;
  question.metadata = metadata.id;
  question.isNegRisk = false;
  question.blockNumber = BigInt.fromI32(1);
  question.blockTimestamp = BigInt.fromI32(1);
  question.transactionHash = Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234");
  question.save();
}

describe("CTFExchange - TokenRegistered Handler", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should create TokenRegistry entities for both tokens", () => {
    let event = createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID);

    handleTokenRegistered(event);

    let token0Id = Bytes.fromByteArray(Bytes.fromBigInt(TOKEN_0)).toHexString();
    let token1Id = Bytes.fromByteArray(Bytes.fromBigInt(TOKEN_1)).toHexString();

    assert.fieldEquals("TokenRegistry", token0Id, "tokenId", TOKEN_0.toString());
    assert.fieldEquals("TokenRegistry", token0Id, "conditionId", CONDITION_ID.toHexString());
    assert.fieldEquals("TokenRegistry", token0Id, "outcomeIndex", "0");

    assert.fieldEquals("TokenRegistry", token1Id, "tokenId", TOKEN_1.toString());
    assert.fieldEquals("TokenRegistry", token1Id, "conditionId", CONDITION_ID.toHexString());
    assert.fieldEquals("TokenRegistry", token1Id, "outcomeIndex", "1");
  });

  test("Should handle multiple token registrations", () => {
    let conditionId1 = Bytes.fromHexString("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let conditionId2 = Bytes.fromHexString("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    let token2 = BigInt.fromI32(200);
    let token3 = BigInt.fromI32(201);

    let event1 = createTokenRegisteredEvent(TOKEN_0, TOKEN_1, conditionId1);
    let event2 = createTokenRegisteredEvent(token2, token3, conditionId2);

    handleTokenRegistered(event1);
    handleTokenRegistered(event2);

    assert.fieldEquals("TokenRegistry", Bytes.fromByteArray(Bytes.fromBigInt(TOKEN_0)).toHexString(), "conditionId", conditionId1.toHexString());
    assert.fieldEquals("TokenRegistry", Bytes.fromByteArray(Bytes.fromBigInt(token2)).toHexString(), "conditionId", conditionId2.toHexString());
  });
});

describe("CTFExchange - OrderFilled Handler", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should create Bet when maker is a TraderAgent buying tokens", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(CONDITION_ID, Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234"));

    let tokenEvent = createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID);
    handleTokenRegistered(tokenEvent);

    // Maker buying: makerAssetId = 0 (USDC), takerAssetId = TOKEN_1 (outcome tokens)
    let orderEvent = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      BigInt.zero(),                    // makerAssetId (USDC)
      TOKEN_1,                          // takerAssetId (tokens)
      BigInt.fromI32(500000),           // makerAmountFilled (USDC)
      BigInt.fromI32(1000000),          // takerAmountFilled (shares)
      BigInt.fromI32(1000)
    );

    handleOrderFilled(orderEvent);

    // Verify bet was created
    let betId = orderEvent.transaction.hash.concat(Bytes.fromI32(orderEvent.logIndex.toI32())).toHexString();
    assert.fieldEquals("Bet", betId, "bettor", MAKER.toHexString());
    assert.fieldEquals("Bet", betId, "outcomeIndex", "1");
    assert.fieldEquals("Bet", betId, "amount", "500000");
    assert.fieldEquals("Bet", betId, "shares", "1000000");
    assert.fieldEquals("Bet", betId, "countedInTotal", "false");
    assert.fieldEquals("Bet", betId, "countedInProfit", "false");
  });

  test("Should create Bet when maker is a TraderAgent selling tokens", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(CONDITION_ID, Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234"));

    let tokenEvent = createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID);
    handleTokenRegistered(tokenEvent);

    // Maker selling: makerAssetId = TOKEN_0 (outcome tokens), takerAssetId = 0 (USDC)
    let orderEvent = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      TOKEN_0,                          // makerAssetId (tokens)
      BigInt.zero(),                    // takerAssetId (USDC)
      BigInt.fromI32(600000),           // makerAmountFilled (shares)
      BigInt.fromI32(300000),           // takerAmountFilled (USDC)
      BigInt.fromI32(500)
    );

    handleOrderFilled(orderEvent);

    // Verify bet was created
    let betId = orderEvent.transaction.hash.concat(Bytes.fromI32(orderEvent.logIndex.toI32())).toHexString();
    assert.fieldEquals("Bet", betId, "bettor", MAKER.toHexString());
    assert.fieldEquals("Bet", betId, "outcomeIndex", "0");
    assert.fieldEquals("Bet", betId, "amount", "300000");
    assert.fieldEquals("Bet", betId, "shares", "600000");
  });

  test("Should not create Bet when maker is not a TraderAgent", () => {
    setupQuestion(CONDITION_ID, Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234"));

    let tokenEvent = createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID);
    handleTokenRegistered(tokenEvent);

    let orderEvent = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      BigInt.zero(),
      TOKEN_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000)
    );

    handleOrderFilled(orderEvent);

    // Verify no bet was created
    let betId = orderEvent.transaction.hash.concat(Bytes.fromI32(orderEvent.logIndex.toI32())).toHexString();
    assert.notInStore("Bet", betId);
  });

  test("Should update TraderAgent statistics", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(CONDITION_ID, Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234"));

    let tokenEvent = createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID);
    handleTokenRegistered(tokenEvent);

    let orderEvent = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      BigInt.zero(),
      TOKEN_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000)
    );

    handleOrderFilled(orderEvent);

    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalBets", "1");
    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalTraded", "500000");
  });

  test("Should update Global statistics", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(CONDITION_ID, Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234"));

    let tokenEvent = createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID);
    handleTokenRegistered(tokenEvent);

    let orderEvent = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      BigInt.zero(),
      TOKEN_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000)
    );

    handleOrderFilled(orderEvent);

    assert.fieldEquals("Global", "", "totalBets", "1");
    assert.fieldEquals("Global", "", "totalTraded", "500000");
  });

  test("Should create MarketParticipant on first bet", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(CONDITION_ID, Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234"));

    let tokenEvent = createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID);
    handleTokenRegistered(tokenEvent);

    let orderEvent = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      BigInt.zero(),
      TOKEN_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000)
    );

    handleOrderFilled(orderEvent);

    let participantId = MAKER.toHexString() + "_" + CONDITION_ID.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "traderAgent", MAKER.toHexString());
    assert.fieldEquals("MarketParticipant", participantId, "question", CONDITION_ID.toHexString());
    assert.fieldEquals("MarketParticipant", participantId, "totalBets", "1");
  });

  test("Should handle multiple bets from same agent", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(CONDITION_ID, Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234"));

    let tokenEvent = createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID);
    handleTokenRegistered(tokenEvent);

    // First bet - buying
    let orderEvent1 = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      BigInt.zero(),
      TOKEN_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000)
    );

    // Second bet - buying
    let orderHash2 = Bytes.fromHexString("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567891");
    let orderEvent2 = createOrderFilledEvent(
      orderHash2,
      MAKER,
      TAKER,
      BigInt.zero(),
      TOKEN_0,
      BigInt.fromI32(800000),
      BigInt.fromI32(2000000),
      BigInt.fromI32(1500)
    );

    handleOrderFilled(orderEvent1);
    handleOrderFilled(orderEvent2);

    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalBets", "2");
    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalTraded", "1300000");
    assert.fieldEquals("Global", "", "totalBets", "2");
    assert.fieldEquals("Global", "", "totalTraded", "1300000");
  });

  test("Should skip bet creation when TokenRegistry is missing", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(CONDITION_ID, Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234"));

    // Don't register tokens - TokenRegistry will be missing

    let orderEvent = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      BigInt.zero(),
      TOKEN_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000)
    );

    handleOrderFilled(orderEvent);

    // Verify no bet was created
    let betId = orderEvent.transaction.hash.concat(Bytes.fromI32(orderEvent.logIndex.toI32())).toHexString();
    assert.notInStore("Bet", betId);

    // Agent stats should not be updated
    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalBets", "0");
  });
});
