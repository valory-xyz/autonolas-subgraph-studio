import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  handleLogNewQuestion,
  handleLogNewAnswer,
  handleLogFinalize,
  handleLogNotifyOfArbitrationRequest,
} from "../src/realitio";
import {
  LogNewQuestion as LogNewQuestionEvent,
  LogFinalize as LogFinalizeEvent,
  LogNotifyOfArbitrationRequest as LogNotifyOfArbitrationRequestEvent,
} from "../generated/Realitio/Realitio";
import { FixedProductMarketMakerCreation, Question } from "../generated/schema";
import { createNewAnswerEvent } from "./profit";

const QUESTION_ID = Bytes.fromHexString("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const MARKET = Address.fromString("0x0000000000000000000000000000000000000001");
const WHITELISTED_CREATOR = Address.fromString("0x89c5cc945dd550bcffb72fe42bff002429f46fec");
const ANSWER_NO = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");
const ANSWER_YES = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001");
const DUMMY_HASH = Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234");
const START_TS = BigInt.fromI32(1710000000);
const TIMEOUT = BigInt.fromI32(86400);

function createNewQuestionEvent(
  questionId: Bytes,
  user: Address,
  question: string,
  timeout: BigInt
): LogNewQuestionEvent {
  let event = changetype<LogNewQuestionEvent>(newMockEvent());
  event.block.timestamp = START_TS;

  event.parameters = [
    new ethereum.EventParam("question_id", ethereum.Value.fromFixedBytes(questionId)),
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user)),
    new ethereum.EventParam("template_id", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2))),
    new ethereum.EventParam("question", ethereum.Value.fromString(question)),
    new ethereum.EventParam("content_hash", ethereum.Value.fromFixedBytes(DUMMY_HASH)),
    new ethereum.EventParam("arbitrator", ethereum.Value.fromAddress(Address.zero())),
    new ethereum.EventParam("timeout", ethereum.Value.fromUnsignedBigInt(timeout)),
    new ethereum.EventParam("opening_ts", ethereum.Value.fromUnsignedBigInt(START_TS)),
    new ethereum.EventParam("nonce", ethereum.Value.fromUnsignedBigInt(BigInt.zero())),
    new ethereum.EventParam("created", ethereum.Value.fromUnsignedBigInt(START_TS)),
  ];

  return event;
}

function createLogFinalizeEvent(questionId: Bytes, answer: Bytes, timestamp: BigInt): LogFinalizeEvent {
  let event = changetype<LogFinalizeEvent>(newMockEvent());
  event.block.timestamp = timestamp;

  event.parameters = [
    new ethereum.EventParam("question_id", ethereum.Value.fromFixedBytes(questionId)),
    new ethereum.EventParam("answer", ethereum.Value.fromFixedBytes(answer)),
  ];

  return event;
}

function createArbitrationRequestEvent(questionId: Bytes, timestamp: BigInt): LogNotifyOfArbitrationRequestEvent {
  let event = changetype<LogNotifyOfArbitrationRequestEvent>(newMockEvent());
  event.block.timestamp = timestamp;

  event.parameters = [
    new ethereum.EventParam("question_id", ethereum.Value.fromFixedBytes(questionId)),
    new ethereum.EventParam("user", ethereum.Value.fromAddress(Address.zero())),
  ];

  return event;
}

// Question (with timeout) + linked FPMM, mirroring setupMarket in profit.test.ts
function setupMarketWithTimeout(timeout: BigInt | null): void {
  let question = new Question(QUESTION_ID.toHexString());
  question.question = "Will it rain?";
  question.timeout = timeout;
  question.fixedProductMarketMaker = MARKET;
  question.save();

  let fpmm = new FixedProductMarketMakerCreation(MARKET);
  fpmm.creator = WHITELISTED_CREATOR;
  fpmm.conditionIds = [QUESTION_ID];
  fpmm.fee = BigInt.zero();
  fpmm.conditionalTokens = Address.zero();
  fpmm.collateralToken = Address.zero();
  fpmm.blockNumber = BigInt.fromI32(1000);
  fpmm.blockTimestamp = START_TS;
  fpmm.transactionHash = DUMMY_HASH;
  fpmm.save();
}

describe("Realitio - answerFinalizedTimestamp", () => {
  beforeEach(() => {
    clearStore();
  });

  test("LogNewQuestion stores the question timeout", () => {
    let event = createNewQuestionEvent(QUESTION_ID, WHITELISTED_CREATOR, "Will it rain?", TIMEOUT);
    handleLogNewQuestion(event);

    assert.fieldEquals("Question", QUESTION_ID.toHexString(), "timeout", TIMEOUT.toString());
  });

  test("Answer sets answerFinalizedTimestamp to ts + timeout", () => {
    setupMarketWithTimeout(TIMEOUT);

    let answerTs = START_TS.plus(BigInt.fromI32(3600));
    handleLogNewAnswer(createNewAnswerEvent(QUESTION_ID, ANSWER_YES, answerTs));

    assert.fieldEquals(
      "FixedProductMarketMakerCreation",
      MARKET.toHexString(),
      "answerFinalizedTimestamp",
      answerTs.plus(TIMEOUT).toString()
    );
  });

  test("Re-answer pushes answerFinalizedTimestamp out", () => {
    setupMarketWithTimeout(TIMEOUT);

    let firstTs = START_TS.plus(BigInt.fromI32(3600));
    handleLogNewAnswer(createNewAnswerEvent(QUESTION_ID, ANSWER_YES, firstTs));

    let secondTs = firstTs.plus(BigInt.fromI32(7200));
    handleLogNewAnswer(createNewAnswerEvent(QUESTION_ID, ANSWER_NO, secondTs));

    assert.fieldEquals(
      "FixedProductMarketMakerCreation",
      MARKET.toHexString(),
      "answerFinalizedTimestamp",
      secondTs.plus(TIMEOUT).toString()
    );
  });

  test("Answer without stored timeout leaves answerFinalizedTimestamp null", () => {
    setupMarketWithTimeout(null);

    handleLogNewAnswer(createNewAnswerEvent(QUESTION_ID, ANSWER_YES, START_TS));

    let fpmm = FixedProductMarketMakerCreation.load(MARKET);
    assert.assertNotNull(fpmm);
    assert.assertTrue(fpmm!.answerFinalizedTimestamp === null);
  });

  test("LogFinalize sets answerFinalizedTimestamp to the finalization block timestamp", () => {
    setupMarketWithTimeout(TIMEOUT);

    let answerTs = START_TS.plus(BigInt.fromI32(3600));
    handleLogNewAnswer(createNewAnswerEvent(QUESTION_ID, ANSWER_YES, answerTs));

    // Arbitrator finalization happens before the scheduled ts + timeout
    let finalizeTs = answerTs.plus(BigInt.fromI32(600));
    handleLogFinalize(createLogFinalizeEvent(QUESTION_ID, ANSWER_YES, finalizeTs));

    assert.fieldEquals(
      "FixedProductMarketMakerCreation",
      MARKET.toHexString(),
      "answerFinalizedTimestamp",
      finalizeTs.toString()
    );
  });

  test("Arbitration request clears answerFinalizedTimestamp", () => {
    setupMarketWithTimeout(TIMEOUT);

    let answerTs = START_TS.plus(BigInt.fromI32(3600));
    handleLogNewAnswer(createNewAnswerEvent(QUESTION_ID, ANSWER_YES, answerTs));

    handleLogNotifyOfArbitrationRequest(createArbitrationRequestEvent(QUESTION_ID, answerTs.plus(BigInt.fromI32(60))));

    let fpmm = FixedProductMarketMakerCreation.load(MARKET);
    assert.assertNotNull(fpmm);
    assert.assertTrue(fpmm!.answerFinalizedTimestamp === null);
  });

  test("LogFinalize for unknown question is a no-op", () => {
    handleLogFinalize(createLogFinalizeEvent(QUESTION_ID, ANSWER_YES, START_TS));

    assert.notInStore("FixedProductMarketMakerCreation", MARKET.toHexString());
  });
});
