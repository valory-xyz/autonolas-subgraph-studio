import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleConditionPreparation } from "../src/conditional-tokens";
import { ConditionPreparation as ConditionPreparationEvent } from "../generated/ConditionalTokens/ConditionalTokens";
import { Question } from "../generated/schema";

const CONDITION_ID = Bytes.fromHexString("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const QUESTION_ID = Bytes.fromHexString("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const ORACLE = Address.fromString("0x1234567890123456789012345678901234567890");
const DUMMY_HASH = Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234");
const START_TS = BigInt.fromI32(1710000000);

function createConditionPreparationEvent(
  conditionId: Bytes,
  oracle: Address,
  questionId: Bytes,
  outcomeSlotCount: BigInt
): ConditionPreparationEvent {
  let event = changetype<ConditionPreparationEvent>(newMockEvent());
  event.block.timestamp = START_TS;
  event.block.number = BigInt.fromI32(1000);
  event.transaction.hash = DUMMY_HASH;

  event.parameters = [
    new ethereum.EventParam("conditionId", ethereum.Value.fromFixedBytes(conditionId)),
    new ethereum.EventParam("oracle", ethereum.Value.fromAddress(oracle)),
    new ethereum.EventParam("questionId", ethereum.Value.fromFixedBytes(questionId)),
    new ethereum.EventParam("outcomeSlotCount", ethereum.Value.fromUnsignedBigInt(outcomeSlotCount)),
  ];

  return event;
}

describe("ConditionalTokens - ConditionPreparation Handler", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should NOT save ConditionPreparation when Question does not exist", () => {
    // Conditions for questions we don't track (non-whitelisted creators) are skipped
    let event = createConditionPreparationEvent(
      CONDITION_ID,
      ORACLE,
      QUESTION_ID,
      BigInt.fromI32(2)
    );

    handleConditionPreparation(event);

    assert.notInStore("ConditionPreparation", CONDITION_ID.toHexString());
  });

  test("Should save ConditionPreparation when Question exists", () => {
    // LogNewQuestion always fires before ConditionPreparation, so the Question
    // entity exists for every market we track
    let question = new Question(QUESTION_ID.toHexString());
    question.question = "Will it rain?";
    question.save();

    let event = createConditionPreparationEvent(
      CONDITION_ID,
      ORACLE,
      QUESTION_ID,
      BigInt.fromI32(2)
    );

    handleConditionPreparation(event);

    let id = CONDITION_ID.toHexString();
    assert.fieldEquals("ConditionPreparation", id, "conditionId", CONDITION_ID.toHexString());
    assert.fieldEquals("ConditionPreparation", id, "questionId", QUESTION_ID.toHexString());
    assert.fieldEquals("ConditionPreparation", id, "oracle", ORACLE.toHexString());
    assert.fieldEquals("ConditionPreparation", id, "outcomeSlotCount", "2");
  });

  test("Should store block metadata correctly", () => {
    let question = new Question(QUESTION_ID.toHexString());
    question.question = "Will it rain?";
    question.save();

    let event = createConditionPreparationEvent(
      CONDITION_ID,
      ORACLE,
      QUESTION_ID,
      BigInt.fromI32(2)
    );

    handleConditionPreparation(event);

    let id = CONDITION_ID.toHexString();
    assert.fieldEquals("ConditionPreparation", id, "blockNumber", "1000");
    assert.fieldEquals("ConditionPreparation", id, "blockTimestamp", START_TS.toString());
    assert.fieldEquals("ConditionPreparation", id, "transactionHash", DUMMY_HASH.toHexString());
  });
});
