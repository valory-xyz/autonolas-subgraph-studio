import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleConditionPreparation, handlePayoutRedemption } from "../src/conditional-tokens";
import { ConditionPreparation as ConditionPreparationEvent, PayoutRedemption as PayoutRedemptionEvent } from "../generated/ConditionalTokens/ConditionalTokens";
import { QuestionIdToConditionId } from "../generated/schema";

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

  test("Should create QuestionIdToConditionId bridge for binary outcome (2 outcomes)", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 2);

    handleConditionPreparation(event);

    // Check QuestionIdToConditionId bridge entity
    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("QuestionIdToConditionId", questionIdHex, "id", questionIdHex);
    assert.fieldEquals("QuestionIdToConditionId", questionIdHex, "conditionId", CONDITION_ID.toHexString());
  });

  test("Should not create entities for non-binary outcomes (3 outcomes)", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 3);

    handleConditionPreparation(event);

    // Should not create any entities
    assert.notInStore("QuestionIdToConditionId", QUESTION_ID.toHexString());
  });

  test("Should not create entities for single outcome (1 outcome)", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 1);

    handleConditionPreparation(event);

    // Should not create any entities
    assert.notInStore("QuestionIdToConditionId", QUESTION_ID.toHexString());
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

    // Check both bridge entities exist
    assert.fieldEquals("QuestionIdToConditionId", questionId1.toHexString(), "id", questionId1.toHexString());
    assert.fieldEquals("QuestionIdToConditionId", questionId2.toHexString(), "id", questionId2.toHexString());
  });

  test("Bridge should link questionId to correct conditionId", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 2);

    handleConditionPreparation(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("QuestionIdToConditionId", questionIdHex, "conditionId", CONDITION_ID.toHexString());
  });

  test("Should create bridge entity with any oracle address", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, Address.zero(), QUESTION_ID, 2);

    handleConditionPreparation(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("QuestionIdToConditionId", questionIdHex, "id", questionIdHex);
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

describe("ConditionalTokens - Edge Cases", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should use questionId correctly as unique identifier for bridge", () => {
    let event = createConditionPreparationEvent(CONDITION_ID, ORACLE, QUESTION_ID, 2);

    handleConditionPreparation(event);

    // The QuestionIdToConditionId entity uses questionId as its ID
    let bridge = QuestionIdToConditionId.load(QUESTION_ID);
    assert.assertTrue(bridge !== null, "Bridge should exist");
    if (bridge != null) {
      assert.bytesEquals(bridge.id, QUESTION_ID);
      assert.bytesEquals(bridge.conditionId, CONDITION_ID);
    }
  });

  test("Should handle different questionId and conditionId combinations", () => {
    let questionId = Bytes.fromHexString("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let conditionId = Bytes.fromHexString("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    let event = createConditionPreparationEvent(conditionId, ORACLE, questionId, 2);
    handleConditionPreparation(event);

    assert.fieldEquals("QuestionIdToConditionId", questionId.toHexString(), "id", questionId.toHexString());
    assert.fieldEquals("QuestionIdToConditionId", questionId.toHexString(), "conditionId", conditionId.toHexString());
  });
});
