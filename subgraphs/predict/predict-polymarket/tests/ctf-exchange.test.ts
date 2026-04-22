import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  newMockEvent,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleTokenRegistered, handleOrderFilled } from "../src/ctf-exchange";
import {
  TokenRegistered,
  OrderFilled,
} from "../generated/CTFExchange/CTFExchange";
import { Multisig, Question, MarketMetadata } from "../generated/schema";

const CONDITION_ID = Bytes.fromHexString(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const TOKEN_0 = BigInt.fromI32(100);
const TOKEN_1 = BigInt.fromI32(101);
const TAKER = Address.fromString("0x1234567890123456789012345678901234567890");
const MAKER = Address.fromString("0x2234567890123456789012345678901234567890");
const NON_OLAS_MAKER = Address.fromString(
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
);
const ORDER_HASH = Bytes.fromHexString(
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
);
const OPERATOR = Address.fromString(
  "0x6234567890123456789012345678901234567890",
);

function createTokenRegisteredEvent(
  token0: BigInt,
  token1: BigInt,
  conditionId: Bytes,
): TokenRegistered {
  let event = changetype<TokenRegistered>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "token0",
      ethereum.Value.fromUnsignedBigInt(token0),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "token1",
      ethereum.Value.fromUnsignedBigInt(token1),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "conditionId",
      ethereum.Value.fromFixedBytes(conditionId),
    ),
  );
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
  fee: BigInt,
): OrderFilled {
  let event = changetype<OrderFilled>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "orderHash",
      ethereum.Value.fromFixedBytes(orderHash),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(maker)),
  );
  event.parameters.push(
    new ethereum.EventParam("taker", ethereum.Value.fromAddress(taker)),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "makerAssetId",
      ethereum.Value.fromUnsignedBigInt(makerAssetId),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "takerAssetId",
      ethereum.Value.fromUnsignedBigInt(takerAssetId),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "makerAmountFilled",
      ethereum.Value.fromUnsignedBigInt(makerAmountFilled),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "takerAmountFilled",
      ethereum.Value.fromUnsignedBigInt(takerAmountFilled),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam("fee", ethereum.Value.fromUnsignedBigInt(fee)),
  );
  return event;
}

function setupMultisig(address: Address, serviceId: BigInt): void {
  let multisig = new Multisig(address);
  multisig.serviceId = serviceId;
  multisig.agentIds = [86];
  let ops: Bytes[] = [OPERATOR];
  multisig.operators = ops;
  multisig.createdAt = BigInt.fromI32(1);
  multisig.blockNumber = BigInt.fromI32(1);
  multisig.transactionHash = Bytes.fromHexString(
    "0x1234567890123456789012345678901234567890123456789012345678901234",
  );
  multisig.save();
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
    assert.fieldEquals(
      "TokenRegistry",
      token0Id,
      "conditionId",
      CONDITION_ID.toHexString(),
    );
    assert.fieldEquals("TokenRegistry", token0Id, "outcomeIndex", "0");

    assert.fieldEquals("TokenRegistry", token1Id, "tokenId", TOKEN_1.toString());
    assert.fieldEquals(
      "TokenRegistry",
      token1Id,
      "conditionId",
      CONDITION_ID.toHexString(),
    );
    assert.fieldEquals("TokenRegistry", token1Id, "outcomeIndex", "1");
  });

  test("Should handle multiple token registrations", () => {
    let conditionId1 = Bytes.fromHexString(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    let conditionId2 = Bytes.fromHexString(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    let token2 = BigInt.fromI32(200);
    let token3 = BigInt.fromI32(201);

    handleTokenRegistered(createTokenRegisteredEvent(TOKEN_0, TOKEN_1, conditionId1));
    handleTokenRegistered(createTokenRegisteredEvent(token2, token3, conditionId2));

    assert.fieldEquals(
      "TokenRegistry",
      Bytes.fromByteArray(Bytes.fromBigInt(TOKEN_0)).toHexString(),
      "conditionId",
      conditionId1.toHexString(),
    );
    assert.fieldEquals(
      "TokenRegistry",
      Bytes.fromByteArray(Bytes.fromBigInt(token2)).toHexString(),
      "conditionId",
      conditionId2.toHexString(),
    );
  });
});

describe("CTFExchange - OrderFilled lazy TraderAgent creation", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Lazy-creates TraderAgent on first trade when Multisig exists", () => {
    setupMultisig(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    handleTokenRegistered(createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID));

    handleOrderFilled(
      createOrderFilledEvent(
        ORDER_HASH,
        MAKER,
        TAKER,
        BigInt.zero(),
        TOKEN_1,
        BigInt.fromI32(500000),
        BigInt.fromI32(1000000),
        BigInt.fromI32(1000),
      ),
    );

    assert.fieldEquals(
      "TraderAgent",
      MAKER.toHexString(),
      "multisig",
      MAKER.toHexString(),
    );
    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "serviceId", "1");
    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalBets", "1");
    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalTraded", "500000");
  });

  test("Sets Multisig.traderAgent back-link on first trade", () => {
    setupMultisig(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    handleTokenRegistered(createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID));

    handleOrderFilled(
      createOrderFilledEvent(
        ORDER_HASH,
        MAKER,
        TAKER,
        BigInt.zero(),
        TOKEN_1,
        BigInt.fromI32(500000),
        BigInt.fromI32(1000000),
        BigInt.fromI32(1000),
      ),
    );

    assert.fieldEquals(
      "Multisig",
      MAKER.toHexString(),
      "traderAgent",
      MAKER.toHexString(),
    );
  });

  test("Increments Global.totalTraderAgents on first trade only", () => {
    setupMultisig(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    handleTokenRegistered(createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID));

    // First trade: lazy creates TraderAgent
    handleOrderFilled(
      createOrderFilledEvent(
        ORDER_HASH,
        MAKER,
        TAKER,
        BigInt.zero(),
        TOKEN_1,
        BigInt.fromI32(500000),
        BigInt.fromI32(1000000),
        BigInt.fromI32(1000),
      ),
    );
    assert.fieldEquals("Global", "", "totalTraderAgents", "1");

    // Second trade by same agent: no increment
    let secondHash = Bytes.fromHexString(
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567891",
    );
    handleOrderFilled(
      createOrderFilledEvent(
        secondHash,
        MAKER,
        TAKER,
        BigInt.zero(),
        TOKEN_0,
        BigInt.fromI32(800000),
        BigInt.fromI32(2000000),
        BigInt.fromI32(1500),
      ),
    );
    assert.fieldEquals("Global", "", "totalTraderAgents", "1");
  });

  test("Skips trade entirely when maker is not an Olas multisig", () => {
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    handleTokenRegistered(createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID));

    handleOrderFilled(
      createOrderFilledEvent(
        ORDER_HASH,
        NON_OLAS_MAKER,
        TAKER,
        BigInt.zero(),
        TOKEN_1,
        BigInt.fromI32(500000),
        BigInt.fromI32(1000000),
        BigInt.fromI32(1000),
      ),
    );

    assert.notInStore("TraderAgent", NON_OLAS_MAKER.toHexString());
    let betId = ORDER_HASH.concat(Bytes.fromI32(1)).toHexString();
    assert.notInStore("Bet", betId);
    assert.notInStore("Global", "");
  });
});

describe("CTFExchange - OrderFilled Buy/Sell Handling", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Buy bet: positive amount, positive shares, correct outcomeIndex", () => {
    setupMultisig(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    handleTokenRegistered(createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID));

    let orderEvent = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      BigInt.zero(),
      TOKEN_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000),
    );
    handleOrderFilled(orderEvent);

    let betId = orderEvent.transaction.hash
      .concat(Bytes.fromI32(orderEvent.logIndex.toI32()))
      .toHexString();
    assert.fieldEquals("Bet", betId, "bettor", MAKER.toHexString());
    assert.fieldEquals("Bet", betId, "outcomeIndex", "1");
    assert.fieldEquals("Bet", betId, "amount", "500000");
    assert.fieldEquals("Bet", betId, "shares", "1000000");
    assert.fieldEquals("Bet", betId, "isBuy", "true");
  });

  test("Sell bet: negative amount, negative shares", () => {
    setupMultisig(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    handleTokenRegistered(createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID));

    let orderEvent = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      TOKEN_0,
      BigInt.zero(),
      BigInt.fromI32(600000),
      BigInt.fromI32(300000),
      BigInt.fromI32(500),
    );
    handleOrderFilled(orderEvent);

    let betId = orderEvent.transaction.hash
      .concat(Bytes.fromI32(orderEvent.logIndex.toI32()))
      .toHexString();
    assert.fieldEquals("Bet", betId, "outcomeIndex", "0");
    assert.fieldEquals("Bet", betId, "amount", "-300000");
    assert.fieldEquals("Bet", betId, "shares", "-600000");
    assert.fieldEquals("Bet", betId, "isBuy", "false");
  });

  test("Skips bet when TokenRegistry is missing, but still lazy-creates TraderAgent", () => {
    setupMultisig(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );

    let orderEvent = createOrderFilledEvent(
      ORDER_HASH,
      MAKER,
      TAKER,
      BigInt.zero(),
      TOKEN_1,
      BigInt.fromI32(500000),
      BigInt.fromI32(1000000),
      BigInt.fromI32(1000),
    );
    handleOrderFilled(orderEvent);

    let betId = orderEvent.transaction.hash
      .concat(Bytes.fromI32(orderEvent.logIndex.toI32()))
      .toHexString();
    assert.notInStore("Bet", betId);
    // TraderAgent gets created lazily before the TokenRegistry check runs.
    // This is acceptable: the registry-missing case is a correctness signal
    // (cross-block ordering bug, see plan §7.1), not a policy filter.
    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalBets", "0");
  });
});

describe("CTFExchange - Aggregate statistics", () => {
  beforeEach(() => {
    clearStore();
  });

  test("TraderAgent and Global aggregates update across trades", () => {
    setupMultisig(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    handleTokenRegistered(createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID));

    handleOrderFilled(
      createOrderFilledEvent(
        ORDER_HASH,
        MAKER,
        TAKER,
        BigInt.zero(),
        TOKEN_1,
        BigInt.fromI32(500000),
        BigInt.fromI32(1000000),
        BigInt.fromI32(1000),
      ),
    );
    let hash2 = Bytes.fromHexString(
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567891",
    );
    handleOrderFilled(
      createOrderFilledEvent(
        hash2,
        MAKER,
        TAKER,
        BigInt.zero(),
        TOKEN_0,
        BigInt.fromI32(800000),
        BigInt.fromI32(2000000),
        BigInt.fromI32(1500),
      ),
    );

    assert.fieldEquals("TraderAgent", MAKER.toHexString(), "totalBets", "2");
    assert.fieldEquals(
      "TraderAgent",
      MAKER.toHexString(),
      "totalTraded",
      "1300000",
    );
    assert.fieldEquals("Global", "", "totalBets", "2");
    assert.fieldEquals("Global", "", "totalTraded", "1300000");
  });

  test("Creates MarketParticipant on first trade in a market", () => {
    setupMultisig(MAKER, BigInt.fromI32(1));
    setupQuestion(
      CONDITION_ID,
      Bytes.fromHexString(
        "0x1234567890123456789012345678901234567890123456789012345678901234",
      ),
    );
    handleTokenRegistered(createTokenRegisteredEvent(TOKEN_0, TOKEN_1, CONDITION_ID));

    handleOrderFilled(
      createOrderFilledEvent(
        ORDER_HASH,
        MAKER,
        TAKER,
        BigInt.zero(),
        TOKEN_1,
        BigInt.fromI32(500000),
        BigInt.fromI32(1000000),
        BigInt.fromI32(1000),
      ),
    );

    let participantId =
      MAKER.toHexString() + "_" + CONDITION_ID.toHexString();
    assert.fieldEquals(
      "MarketParticipant",
      participantId,
      "traderAgent",
      MAKER.toHexString(),
    );
    assert.fieldEquals(
      "MarketParticipant",
      participantId,
      "question",
      CONDITION_ID.toHexString(),
    );
    assert.fieldEquals("MarketParticipant", participantId, "totalBets", "1");
  });
});
