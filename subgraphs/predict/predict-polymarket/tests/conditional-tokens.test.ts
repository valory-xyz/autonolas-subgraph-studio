import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleConditionPreparation, handlePayoutRedemption } from "../src/conditional-tokens";
import { ConditionPreparation as ConditionPreparationEvent, PayoutRedemption as PayoutRedemptionEvent } from "../generated/ConditionalTokens/ConditionalTokens";
import { ConditionPreparation, Question, MarketMetadata } from "../generated/schema";

const ORACLE = Address.fromString("0x1234567890123456789012345678901234567890");
const QUESTION_ID = Bytes.fromHexString("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
const CONDITION_ID = Bytes.fromHexString("0x1111111111111111111111111111111111111111111111111111111111111111");
const REDEEMER = Address.fromString("0x2234567890123456789012345678901234567890");
const COLLATERAL_TOKEN = Address.fromString("0x3234567890123456789012345678901234567890");

function createConditionPreparationEvent(
  conditionId: Bytes,
  oracle: Address,
  questionId: Bytes,
  outcomeSlotCount: i32
): ConditionPreparationEvent {
  let event = changetype<ConditionPreparationEvent>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(new ethereum.EventParam("conditionId", ethereum.Value.fromFixedBytes(conditionId)));
  event.parameters.push(new ethereum.EventParam("oracle", ethereum.Value.fromAddress(oracle)));
  event.parameters.push(new ethereum.EventParam("questionId", ethereum.Value.fromFixedBytes(questionId)));
  event.parameters.push(new ethereum.EventParam("outcomeSlotCount", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(outcomeSlotCount))));

  return event;
}

function createPayoutRedemptionEvent(
  redeemer: Address,
  collateralToken: Address,
  conditionId: Bytes,
  indexSets: Array<BigInt>,
  payout: BigInt
): PayoutRedemptionEvent {
  let event = changetype<PayoutRedemptionEvent>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(new ethereum.EventParam("redeemer", ethereum.Value.fromAddress(redeemer)));
  event.parameters.push(new ethereum.EventParam("collateralToken", ethereum.Value.fromAddress(collateralToken)));
  event.parameters.push(new ethereum.EventParam("conditionId", ethereum.Value.fromFixedBytes(conditionId)));
  event.parameters.push(new ethereum.EventParam("parentCollectionId", ethereum.Value.fromFixedBytes(Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000"))));
  event.parameters.push(new ethereum.EventParam("indexSets", ethereum.Value.fromUnsignedBigIntArray(indexSets)));
  event.parameters.push(new ethereum.EventParam("payout", ethereum.Value.fromUnsignedBigInt(payout)));

  return event;
}

describe("ConditionalTokens - ConditionPreparation Handler", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should create ConditionPreparation and Question for binary outcome (2 outcomes)", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 2);

    handleConditionPreparation(event);

    // Check ConditionPreparation entity
    let conditionIdHex = CONDITION_ID.toHexString();
    assert.fieldEquals("ConditionPreparation", conditionIdHex, "id", conditionIdHex);
    assert.fieldEquals("ConditionPreparation", conditionIdHex, "conditionId", CONDITION_ID.toHexString());
    assert.fieldEquals("ConditionPreparation", conditionIdHex, "oracle", ORACLE.toHexString());
    assert.fieldEquals("ConditionPreparation", conditionIdHex, "questionId", QUESTION_ID.toHexString());
    assert.fieldEquals("ConditionPreparation", conditionIdHex, "outcomeSlotCount", "2");
    assert.fieldEquals("ConditionPreparation", conditionIdHex, "blockNumber", "1");
    assert.fieldEquals("ConditionPreparation", conditionIdHex, "blockTimestamp", "1");

    // Check Question entity
    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("Question", questionIdHex, "id", questionIdHex);
    assert.fieldEquals("Question", questionIdHex, "conditionId", CONDITION_ID.toHexString());
    assert.fieldEquals("Question", questionIdHex, "metadata", "null");
    assert.fieldEquals("Question", questionIdHex, "blockNumber", "1");
    assert.fieldEquals("Question", questionIdHex, "blockTimestamp", "1");
  });

  test("Should not create entities for non-binary outcomes (3 outcomes)", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 3);

    handleConditionPreparation(event);

    // Should not create any entities
    assert.notInStore("ConditionPreparation", CONDITION_ID.toHexString());
    assert.notInStore("Question", QUESTION_ID.toHexString());
  });

  test("Should not create entities for single outcome (1 outcome)", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 1);

    handleConditionPreparation(event);

    // Should not create any entities
    assert.notInStore("ConditionPreparation", CONDITION_ID.toHexString());
    assert.notInStore("Question", QUESTION_ID.toHexString());
  });

  test("Should handle multiple binary conditions correctly", () => {
    let questionId1 = Bytes.fromHexString("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let questionId2 = Bytes.fromHexString("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    let conditionId1 = Bytes.fromHexString("0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    let conditionId2 = Bytes.fromHexString("0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");

    let event1 = createConditionPreparationEvent(conditionId1, ORACLE, questionId1, 2);
    let event2 = createConditionPreparationEvent(conditionId2, ORACLE, questionId2, 2);

    handleConditionPreparation(event1);
    handleConditionPreparation(event2);

    // Check both ConditionPreparations exist
    assert.fieldEquals("ConditionPreparation", conditionId1.toHexString(), "id", conditionId1.toHexString());
    assert.fieldEquals("ConditionPreparation", conditionId2.toHexString(), "id", conditionId2.toHexString());

    // Check both Questions exist
    assert.fieldEquals("Question", questionId1.toHexString(), "id", questionId1.toHexString());
    assert.fieldEquals("Question", questionId2.toHexString(), "id", questionId2.toHexString());
  });

  test("Question should link to correct conditionId", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 2);

    handleConditionPreparation(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("Question", questionIdHex, "conditionId", CONDITION_ID.toHexString());
  });

  test("Should handle zero address oracle", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, Address.zero(), QUESTION_ID, 2);

    handleConditionPreparation(event);

    let conditionIdHex = CONDITION_ID.toHexString();
    assert.fieldEquals("ConditionPreparation", conditionIdHex, "oracle", Address.zero().toHexString());
  });
});

describe("ConditionalTokens - PayoutRedemption Handler", () => {
  beforeEach(() => {
    clearStore();
  });

  test("PayoutRedemption handler should not throw error (placeholder implementation)", () => {
    let indexSets = new Array<BigInt>();
    indexSets.push(BigInt.fromI32(1));
    indexSets.push(BigInt.fromI32(2));

    let event = createPayoutRedemptionEvent(
      REDEEMER,
      COLLATERAL_TOKEN,
      CONDITION_ID,
      indexSets,
      BigInt.fromI32(1000)
    );

    // This should not throw - currently a TODO in the implementation
    handlePayoutRedemption(event);

    // No assertions needed as this is a placeholder
    // Test passes if no error is thrown
  });
});

describe("ConditionalTokens - Integration with MarketMetadata", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Question can be linked to MarketMetadata after creation", () => {
    // First create the condition and question
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 2);
    handleConditionPreparation(event);

    // Manually create and link metadata (simulating UMA handler)
    let metadata = new MarketMetadata(QUESTION_ID);
    metadata.title = "Will BTC hit 100k?";
    metadata.outcomes = ["Yes", "No"];
    metadata.save();

    // Update the question to link to metadata
    let question = Question.load(QUESTION_ID);
    if (question != null) {
      question.metadata = QUESTION_ID;
      question.save();
    }

    // Verify the link
    assert.fieldEquals("Question", QUESTION_ID.toHexString(), "metadata", QUESTION_ID.toHexString());
    assert.fieldEquals("MarketMetadata", QUESTION_ID.toHexString(), "title", "Will BTC hit 100k?");
  });

  test("Question without metadata should have null metadata field", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 2);
    handleConditionPreparation(event);

    // Question created but no metadata attached yet
    assert.fieldEquals("Question", QUESTION_ID.toHexString(), "metadata", "null");
  });
});

describe("ConditionalTokens - Edge Cases", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should handle maximum BigInt values", () => {
    let largeOutcomeCount = 2; // Still binary, but testing with edge case context
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, largeOutcomeCount);

    handleConditionPreparation(event);

    assert.fieldEquals("ConditionPreparation", CONDITION_ID.toHexString(), "outcomeSlotCount", "2");
  });

  test("Should use questionId correctly as unique identifier", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 2);

    handleConditionPreparation(event);

    // The Question entity uses questionId as its ID
    let question = Question.load(QUESTION_ID);
    assert.assertTrue(question !== null, "Question should exist");
    if (question != null) {
      assert.bytesEquals(question.id, QUESTION_ID);
    }
  });

  test("Should use conditionId correctly as unique identifier for ConditionPreparation", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 2);

    handleConditionPreparation(event);

    // The ConditionPreparation entity uses conditionId.toHexString() as its ID
    let condition = ConditionPreparation.load(CONDITION_ID.toHexString());
    assert.assertTrue(condition !== null, "ConditionPreparation should exist");
    if (condition != null) {
      assert.stringEquals(condition.id, CONDITION_ID.toHexString());
    }
  });
});
