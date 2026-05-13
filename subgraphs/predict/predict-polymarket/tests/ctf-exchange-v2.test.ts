import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  newMockEvent,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleOrderFilledV2 } from "../src/ctf-exchange-v2";
import { OrderFilled } from "../generated/CTFExchangeV2/CTFExchangeV2";
import {
  TraderAgent,
  Question,
  MarketMetadata,
  TokenRegistry,
} from "../generated/schema";

const CONDITION_ID = Bytes.fromHexString(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const TOKEN_ID_0 = BigInt.fromI32(100);
const TOKEN_ID_1 = BigInt.fromI32(101);
const TAKER = Address.fromString("0x1234567890123456789012345678901234567890");
const MAKER = Address.fromString("0x2234567890123456789012345678901234567890");
const ORDER_HASH = Bytes.fromHexString(
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
);
const BUILDER = Bytes.fromHexString(
  "0x0000000000000000000000000000000000000000000000000000000000000000",
);
const METADATA = Bytes.fromHexString(
  "0x0000000000000000000000000000000000000000000000000000000000000000",
);

function createOrderFilledV2Event(
  orderHash: Bytes,
  maker: Address,
  taker: Address,
  side: i32,
  tokenId: BigInt,
  makerAmountFilled: BigInt,
  takerAmountFilled: BigInt,
  fee: BigInt,
  builder: Bytes,
  metadata: Bytes,
): OrderFilled {
  let event = changetype<OrderFilled>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(new ethereum.EventParam("orderHash", ethereum.Value.fromFixedBytes(orderHash)));
  event.parameters.push(new ethereum.EventParam("maker", ethereum.Value.fromAddress(maker)));
  event.parameters.push(new ethereum.EventParam("taker", ethereum.Value.fromAddress(taker)));
  event.parameters.push(new ethereum.EventParam("side", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(side))));
  event.parameters.push(new ethereum.EventParam("tokenId", ethereum.Value.fromUnsignedBigInt(tokenId)));
  event.parameters.push(new ethereum.EventParam("makerAmountFilled", ethereum.Value.fromUnsignedBigInt(makerAmountFilled)));
  event.parameters.push(new ethereum.EventParam("takerAmountFilled", ethereum.Value.fromUnsignedBigInt(takerAmountFilled)));
  event.parameters.push(new ethereum.EventParam("fee", ethereum.Value.fromUnsignedBigInt(fee)));
  event.parameters.push(new ethereum.EventParam("builder", ethereum.Value.fromFixedBytes(builder)));
  event.parameters.push(new ethereum.EventParam("metadata", ethereum.Value.fromFixedBytes(metadata)));

  return event;
}

function setupTraderAgent(address: Address, serviceId: BigInt): void {
  let agent = new TraderAgent(address);
  agent.serviceId = serviceId;
  agent.totalBets = 0;
  agent.totalTraded = BigInt.zero();
  agent.totalTradedSettled = BigInt.zero();
  agent.totalPayout = BigInt.zero();
  agent.totalExpectedPayout = BigInt.zero();
  agent.blockNumber = BigInt.fromI32(1);
  agent.blockTimestamp = BigInt.fromI32(1);
  agent.transactionHash = Bytes.fromHexString(
    "0x1234567890123456789012345678901234567890123456789012345678901234",
  );
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
  question.transactionHash = Bytes.fromHexString(
    "0x1234567890123456789012345678901234567890123456789012345678901234",
  );
  question.save();
}

function setupTokenRegistry(tokenId: BigInt, conditionId: Bytes, outcomeIndex: i32): void {
  let tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId));
  let registry = new TokenRegistry(tokenIdBytes);
  registry.tokenId = tokenId;
  registry.conditionId = conditionId;
  registry.outcomeIndex = BigInt.fromI32(outcomeIndex);
  registry.transactionHash = Bytes.fromHexString(
    "0x1234567890123456789012345678901234567890123456789012345678901234",
  );
  registry.save();
}

describe("CTFExchangeV2 - OrderFilled Handler", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should create Bet when maker is a TraderAgent buying (side=0)", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    setupTokenRegistry(TOKEN_ID_1, CONDITION_ID, 1);

    // BUY: maker pays collateral (makerAmountFilled), receives shares (takerAmountFilled)
    let event = createOrderFilledV2Event(
      ORDER_HASH,
      MAKER,
      TAKER,
      0, // side = BUY
      TOKEN_ID_1,
      BigInt.fromI32(500000), // makerAmountFilled (USDC paid)
      BigInt.fromI32(1000000), // takerAmountFilled (shares received)
      BigInt.fromI32(1000),
      BUILDER,
      METADATA,
    );

    handleOrderFilledV2(event);

    let betId = event.transaction.hash
      .concat(Bytes.fromI32(event.logIndex.toI32()))
      .toHexString();
    assert.fieldEquals("Bet", betId, "bettor", MAKER.toHexString());
    assert.fieldEquals("Bet", betId, "outcomeIndex", "1");
    assert.fieldEquals("Bet", betId, "amount", "500000");
    assert.fieldEquals("Bet", betId, "shares", "1000000");
    assert.fieldEquals("Bet", betId, "isBuy", "true");
    assert.fieldEquals("Bet", betId, "countedInTotal", "false");
    assert.fieldEquals("Bet", betId, "countedInProfit", "false");
  });

  test("Should create Bet with NEGATIVE amounts when maker is selling (side=1)", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    setupTokenRegistry(TOKEN_ID_0, CONDITION_ID, 0);

    // SELL: maker gives shares (makerAmountFilled), receives collateral (takerAmountFilled)
    let event = createOrderFilledV2Event(
      ORDER_HASH,
      MAKER,
      TAKER,
      1, // side = SELL
      TOKEN_ID_0,
      BigInt.fromI32(600000), // makerAmountFilled (shares given)
      BigInt.fromI32(300000), // takerAmountFilled (USDC received)
      BigInt.fromI32(500),
      BUILDER,
      METADATA,
    );

    handleOrderFilledV2(event);

    let betId = event.transaction.hash
      .concat(Bytes.fromI32(event.logIndex.toI32()))
      .toHexString();
    assert.fieldEquals("Bet", betId, "bettor", MAKER.toHexString());
    assert.fieldEquals("Bet", betId, "outcomeIndex", "0");
    assert.fieldEquals("Bet", betId, "amount", "-300000");
    assert.fieldEquals("Bet", betId, "shares", "-600000");
    assert.fieldEquals("Bet", betId, "isBuy", "false");
  });

  test("Should not create Bet when maker is not a TraderAgent", () => {
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    setupTokenRegistry(TOKEN_ID_1, CONDITION_ID, 1);

    let event = createOrderFilledV2Event(
      ORDER_HASH,
      MAKER,
      TAKER,
      0,
      TOKEN_ID_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000),
      BUILDER,
      METADATA,
    );

    handleOrderFilledV2(event);

    let betId = event.transaction.hash
      .concat(Bytes.fromI32(event.logIndex.toI32()))
      .toHexString();
    assert.notInStore("Bet", betId);
  });

  test("Should skip bet creation when TokenRegistry is missing", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    // No TokenRegistry setup — handler should bail.

    let event = createOrderFilledV2Event(
      ORDER_HASH,
      MAKER,
      TAKER,
      0,
      TOKEN_ID_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000),
      BUILDER,
      METADATA,
    );

    handleOrderFilledV2(event);

    let betId = event.transaction.hash
      .concat(Bytes.fromI32(event.logIndex.toI32()))
      .toHexString();
    assert.notInStore("Bet", betId);
    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalBets", "0");
  });

  test("Should update TraderAgent and Global statistics for a buy", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    setupTokenRegistry(TOKEN_ID_1, CONDITION_ID, 1);

    let event = createOrderFilledV2Event(
      ORDER_HASH,
      MAKER,
      TAKER,
      0,
      TOKEN_ID_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000),
      BUILDER,
      METADATA,
    );

    handleOrderFilledV2(event);

    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalBets", "1");
    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalTraded", "500000");
    assert.fieldEquals("Global", "", "totalBets", "1");
    assert.fieldEquals("Global", "", "totalTraded", "500000");
  });

  test("Should create MarketParticipant with outcome share tracking", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    setupTokenRegistry(TOKEN_ID_1, CONDITION_ID, 1);

    let event = createOrderFilledV2Event(
      ORDER_HASH,
      MAKER,
      TAKER,
      0,
      TOKEN_ID_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000),
      BUILDER,
      METADATA,
    );

    handleOrderFilledV2(event);

    let participantId =
      MAKER.toHexString() + "_" + CONDITION_ID.toHexString();
    assert.fieldEquals("MarketParticipant", participantId, "totalBets", "1");
    assert.fieldEquals("MarketParticipant", participantId, "totalTraded", "500000");
    // Outcome 1 buy adds to outcomeShares1
    assert.fieldEquals("MarketParticipant", participantId, "outcomeShares0", "0");
    assert.fieldEquals("MarketParticipant", participantId, "outcomeShares1", "1000000");
  });

  test("Should persist builder and metadata from v2 event on Bet", () => {
    setupTraderAgent(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    setupTokenRegistry(TOKEN_ID_1, CONDITION_ID, 1);

    let customBuilder = Bytes.fromHexString(
      "0x00000000000000000000000000000000000000000000000000000000deadbeef",
    );
    let customMetadata = Bytes.fromHexString(
      "0x00000000000000000000000000000000000000000000000000000000cafebabe",
    );

    let event = createOrderFilledV2Event(
      ORDER_HASH,
      MAKER,
      TAKER,
      0,
      TOKEN_ID_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000),
      customBuilder,
      customMetadata,
    );

    handleOrderFilledV2(event);

    let betId = event.transaction.hash
      .concat(Bytes.fromI32(event.logIndex.toI32()))
      .toHexString();
    assert.fieldEquals("Bet", betId, "builder", customBuilder.toHexString());
    assert.fieldEquals("Bet", betId, "metadata", customMetadata.toHexString());
  });
});
