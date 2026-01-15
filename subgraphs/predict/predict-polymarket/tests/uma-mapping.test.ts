import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { extractTitle, extractBinaryOutcomes, handleQuestionInitialized } from "../src/uma-mapping";
import { QuestionInitialized } from "../generated/OptimisticOracleV3/OptimisticOracleV3";
import { MarketMetadata } from "../generated/schema";

const QUESTION_ID = Bytes.fromHexString("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
const TIMESTAMP = BigInt.fromI32(1710000000);
const REWARD = BigInt.fromI32(1000000);
const REQUESTER = Address.fromString("0x1234567890123456789012345678901234567890");
const CURRENCY = Address.fromString("0x2234567890123456789012345678901234567890");

function createQuestionInitializedEvent(
  questionID: Bytes,
  requestTimestamp: BigInt,
  requester: Address,
  ancillaryData: Bytes,
  currency: Address,
  reward: BigInt,
  proposalBond: BigInt
): QuestionInitialized {
  let event = changetype<QuestionInitialized>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(new ethereum.EventParam("questionID", ethereum.Value.fromFixedBytes(questionID)));
  event.parameters.push(new ethereum.EventParam("requestTimestamp", ethereum.Value.fromUnsignedBigInt(requestTimestamp)));
  event.parameters.push(new ethereum.EventParam("requester", ethereum.Value.fromAddress(requester)));
  event.parameters.push(new ethereum.EventParam("ancillaryData", ethereum.Value.fromBytes(ancillaryData)));
  event.parameters.push(new ethereum.EventParam("currency", ethereum.Value.fromAddress(currency)));
  event.parameters.push(new ethereum.EventParam("reward", ethereum.Value.fromUnsignedBigInt(reward)));
  event.parameters.push(new ethereum.EventParam("proposalBond", ethereum.Value.fromUnsignedBigInt(proposalBond)));

  return event;
}

describe("UMA Mapping - extractTitle function", () => {
  test("Should extract title from standard format with description", () => {
    let rawData = "q: title: Will BTC hit 100k?, description: Bitcoin price prediction, res_data: p1: 0, p2: 1";
    let title = extractTitle(rawData);
    assert.stringEquals(title, "Will BTC hit 100k?");
  });

  test("Should extract title from format with res_data", () => {
    let rawData = "q: title: Will Trump win 2024?, res_data: p1: 0, p2: 1";
    let title = extractTitle(rawData);
    assert.stringEquals(title, "Will Trump win 2024?");
  });

  test("Should extract title when followed by comma", () => {
    let rawData = "q: title: Simple question, other_field: value";
    let title = extractTitle(rawData);
    assert.stringEquals(title, "Simple question");
  });

  test("Should handle title at end of string", () => {
    let rawData = "q: title: Final question";
    let title = extractTitle(rawData);
    assert.stringEquals(title, "Final question");
  });

  test("Should return 'Unknown Market' when title key not found", () => {
    let rawData = "q: some_other_field: value, res_data: p1: 0, p2: 1";
    let title = extractTitle(rawData);
    assert.stringEquals(title, "Unknown Market");
  });

  test("Should handle title with special characters", () => {
    let rawData = "q: title: Will ETH/USD hit $5k?, description: test";
    let title = extractTitle(rawData);
    assert.stringEquals(title, "Will ETH/USD hit $5k?");
  });

  test("Should handle title with hashtag, commas and date range", () => {
    let rawData = "q: title: Elon Musk # tweets January 9 - January 16, 2026?, description: test";
    let title = extractTitle(rawData);
    assert.stringEquals(title, "Elon Musk # tweets January 9 - January 16, 2026?");
  });

  test("Should handle empty title", () => {
    let rawData = "q: title: , description: test";
    let title = extractTitle(rawData);
    assert.stringEquals(title, "");
  });

  test("Should extract title from real Polymarket format", () => {
    let rawData = "q: title: Will Israel invade Rafah by March 31?, description: This market will resolve to \"Yes\" if..., res_data: p1: 0, p2: 1, p3: 0.5. Where p1 corresponds to Yes, p2 to No, p3 to unknown/50-50";
    let title = extractTitle(rawData);
    assert.stringEquals(title, "Will Israel invade Rafah by March 31?");
  });
});

describe("UMA Mapping - extractBinaryOutcomes function", () => {
  test("Should extract outcomes from 'p1 corresponds to' format", () => {
    let rawData = "q: title: Test, res_data: p1: 0, p2: 1, p3: 0.5. Where p1 corresponds to Yes, p2 to No, p3 to unknown/50-50";
    let outcomes = extractBinaryOutcomes(rawData);

    assert.i32Equals(outcomes.length, 2);
    assert.stringEquals(outcomes[0], "Yes");
    assert.stringEquals(outcomes[1], "No");
  });

  test("Should extract outcomes from 'outcomes: []' format", () => {
    let rawData = "q: title: Test, outcomes: [Yes, No], res_data: p1: 0, p2: 1";
    let outcomes = extractBinaryOutcomes(rawData);

    assert.i32Equals(outcomes.length, 2);
    assert.stringEquals(outcomes[0], "Yes");
    assert.stringEquals(outcomes[1], "No");
  });

  test("Should handle custom team names in p1/p2 format", () => {
    let rawData = "res_data: p1: 0, p2: 1, p3: 0.5. Outcome Mapping: Where p1 corresponds to Team WE, p2 to EDward Gaming, p3 to unknown/50-50";
    let outcomes = extractBinaryOutcomes(rawData);

    assert.i32Equals(outcomes.length, 2);
    assert.stringEquals(outcomes[0], "Team WE");
    assert.stringEquals(outcomes[1], "EDward Gaming");
  });

  test("Should return empty array when no outcomes found", () => {
    let rawData = "q: title: Test, res_data: p1: 0, p2: 1";
    let outcomes = extractBinaryOutcomes(rawData);

    assert.i32Equals(outcomes.length, 0);
  });

  test("Should handle outcomes with trailing period", () => {
    let rawData = "res_data: p1: 0, p2: 1. Where p1 corresponds to Winner, p2 to Loser.";
    let outcomes = extractBinaryOutcomes(rawData);

    assert.i32Equals(outcomes.length, 2);
    assert.stringEquals(outcomes[0], "Winner");
    assert.stringEquals(outcomes[1], "Loser");
  });

  test("Should handle outcomes array with extra spaces", () => {
    let rawData = "q: title: Test, outcomes: [ Yes , No ], res_data: p1: 0";
    let outcomes = extractBinaryOutcomes(rawData);

    assert.i32Equals(outcomes.length, 2);
    assert.stringEquals(outcomes[0], "Yes");
    assert.stringEquals(outcomes[1], "No");
  });

  test("Should prioritize 'p1 corresponds to' format over 'outcomes: []'", () => {
    let rawData = "outcomes: [Wrong1, Wrong2], p1 corresponds to Right1, p2 to Right2, p3 to unknown";
    let outcomes = extractBinaryOutcomes(rawData);

    assert.i32Equals(outcomes.length, 2);
    assert.stringEquals(outcomes[0], "Right1");
    assert.stringEquals(outcomes[1], "Right2");
  });

  test("Should handle real Polymarket outcome format", () => {
    let rawData = "q: title: Will Israel invade Rafah by March 31?, description: test, res_data: p1: 0, p2: 1, p3: 0.5. Where p1 corresponds to Yes, p2 to No, p3 to unknown/50-50";
    let outcomes = extractBinaryOutcomes(rawData);

    assert.i32Equals(outcomes.length, 2);
    assert.stringEquals(outcomes[0], "Yes");
    assert.stringEquals(outcomes[1], "No");
  });

  test("Should return empty array for non-binary outcomes in array format", () => {
    let rawData = "outcomes: [Yes, No, Maybe], res_data: p1: 0";
    let outcomes = extractBinaryOutcomes(rawData);

    // The function specifically checks for length == 2
    assert.i32Equals(outcomes.length, 0);
  });

  test("Should handle outcomes with special characters", () => {
    let rawData = "p1 corresponds to Team A/B, p2 to Team C/D, p3 to unknown";
    let outcomes = extractBinaryOutcomes(rawData);

    assert.i32Equals(outcomes.length, 2);
    assert.stringEquals(outcomes[0], "Team A/B");
    assert.stringEquals(outcomes[1], "Team C/D");
  });
});

describe("UMA Mapping - handleQuestionInitialized", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Should create MarketMetadata with title and outcomes", () => {
    let ancillaryDataString = "q: title: Will BTC hit 100k?, description: Test, res_data: p1: 0, p2: 1. Where p1 corresponds to Yes, p2 to No, p3 to unknown";
    let ancillaryData = Bytes.fromUTF8(ancillaryDataString);

    let event = createQuestionInitializedEvent(
      QUESTION_ID,
      TIMESTAMP,
      REQUESTER,
      ancillaryData,
      CURRENCY,
      REWARD,
      BigInt.fromI32(1000)
    );

    handleQuestionInitialized(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("MarketMetadata", questionIdHex, "id", questionIdHex);
    assert.fieldEquals("MarketMetadata", questionIdHex, "title", "Will BTC hit 100k?");
    assert.fieldEquals("MarketMetadata", questionIdHex, "outcomes", "[Yes, No]");
  });

  test("Should handle metadata with outcomes array format", () => {
    let ancillaryDataString = "q: title: Simple Question, outcomes: [Option A, Option B], res_data: test";
    let ancillaryData = Bytes.fromUTF8(ancillaryDataString);

    let event = createQuestionInitializedEvent(
      QUESTION_ID,
      TIMESTAMP,
      REQUESTER,
      ancillaryData,
      CURRENCY,
      REWARD,
      BigInt.fromI32(1000)
    );

    handleQuestionInitialized(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("MarketMetadata", questionIdHex, "title", "Simple Question");
    assert.fieldEquals("MarketMetadata", questionIdHex, "outcomes", "[Option A, Option B]");
  });

  test("Should create MarketMetadata with 'Unknown Market' title when title not found", () => {
    let ancillaryDataString = "q: some_field: value, res_data: p1 corresponds to Yes, p2 to No";
    let ancillaryData = Bytes.fromUTF8(ancillaryDataString);

    let event = createQuestionInitializedEvent(
      QUESTION_ID,
      TIMESTAMP,
      REQUESTER,
      ancillaryData,
      CURRENCY,
      REWARD,
      BigInt.fromI32(1000)
    );

    handleQuestionInitialized(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("MarketMetadata", questionIdHex, "title", "Unknown Market");
  });

  test("Should create MarketMetadata with empty outcomes when not found", () => {
    let ancillaryDataString = "q: title: Test Question, res_data: p1: 0, p2: 1";
    let ancillaryData = Bytes.fromUTF8(ancillaryDataString);

    let event = createQuestionInitializedEvent(
      QUESTION_ID,
      TIMESTAMP,
      REQUESTER,
      ancillaryData,
      CURRENCY,
      REWARD,
      BigInt.fromI32(1000)
    );

    handleQuestionInitialized(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("MarketMetadata", questionIdHex, "title", "Test Question");
    assert.fieldEquals("MarketMetadata", questionIdHex, "outcomes", "[]");
  });

  test("Should handle real Polymarket ancillary data format", () => {
    let ancillaryDataString = "q: title: Will Israel invade Rafah by March 31?, description: This market will resolve to \"Yes\" if Israeli ground forces enter and conduct military operations in Rafah before March 31, 2024 11:59 PM ET., res_data: p1: 0, p2: 1, p3: 0.5. Where p1 corresponds to Yes, p2 to No, p3 to unknown/50-50";
    let ancillaryData = Bytes.fromUTF8(ancillaryDataString);

    let event = createQuestionInitializedEvent(
      QUESTION_ID,
      TIMESTAMP,
      REQUESTER,
      ancillaryData,
      CURRENCY,
      REWARD,
      BigInt.fromI32(1000)
    );

    handleQuestionInitialized(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("MarketMetadata", questionIdHex, "title", "Will Israel invade Rafah by March 31?");
    assert.fieldEquals("MarketMetadata", questionIdHex, "outcomes", "[Yes, No]");
  });

  test("Should handle team-based market format", () => {
    let ancillaryDataString = "q: title: Who will win the match?, res_data: p1: 0, p2: 1, p3: 0.5. Outcome Mapping: Where p1 corresponds to Team Alpha, p2 to Team Beta, p3 to unknown/50-50";
    let ancillaryData = Bytes.fromUTF8(ancillaryDataString);

    let event = createQuestionInitializedEvent(
      QUESTION_ID,
      TIMESTAMP,
      REQUESTER,
      ancillaryData,
      CURRENCY,
      REWARD,
      BigInt.fromI32(1000)
    );

    handleQuestionInitialized(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("MarketMetadata", questionIdHex, "title", "Who will win the match?");
    assert.fieldEquals("MarketMetadata", questionIdHex, "outcomes", "[Team Alpha, Team Beta]");
  });

  test("Should use questionID as entity ID", () => {
    let ancillaryDataString = "q: title: Test, p1 corresponds to Yes, p2 to No";
    let ancillaryData = Bytes.fromUTF8(ancillaryDataString);

    let event = createQuestionInitializedEvent(
      QUESTION_ID,
      TIMESTAMP,
      REQUESTER,
      ancillaryData,
      CURRENCY,
      REWARD,
      BigInt.fromI32(1000)
    );

    handleQuestionInitialized(event);

    let metadata = MarketMetadata.load(QUESTION_ID);
    assert.assertTrue(metadata !== null, "MarketMetadata should exist");
    if (metadata != null) {
      assert.bytesEquals(metadata.id, QUESTION_ID);
    }
  });

  test("Should handle multiple questions with different IDs", () => {
    let questionId1 = Bytes.fromHexString("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let questionId2 = Bytes.fromHexString("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    let ancillaryData1 = Bytes.fromUTF8("q: title: Question 1, p1 corresponds to Yes, p2 to No");
    let ancillaryData2 = Bytes.fromUTF8("q: title: Question 2, p1 corresponds to Agree, p2 to Disagree");

    let event1 = createQuestionInitializedEvent(questionId1, TIMESTAMP, REQUESTER, ancillaryData1, CURRENCY, REWARD, BigInt.fromI32(1000));
    let event2 = createQuestionInitializedEvent(questionId2, TIMESTAMP, REQUESTER, ancillaryData2, CURRENCY, REWARD, BigInt.fromI32(1000));

    handleQuestionInitialized(event1);
    handleQuestionInitialized(event2);

    assert.fieldEquals("MarketMetadata", questionId1.toHexString(), "title", "Question 1");
    assert.fieldEquals("MarketMetadata", questionId1.toHexString(), "outcomes", "[Yes, No]");
    assert.fieldEquals("MarketMetadata", questionId2.toHexString(), "title", "Question 2");
    assert.fieldEquals("MarketMetadata", questionId2.toHexString(), "outcomes", "[Agree, Disagree]");
  });
});

describe("UMA Mapping - Edge Cases and Error Handling", () => {
  test("extractTitle should handle malformed data gracefully", () => {
    let rawData = "garbage data with no structure";
    let title = extractTitle(rawData);
    assert.stringEquals(title, "Unknown Market");
  });

  test("extractBinaryOutcomes should handle malformed data gracefully", () => {
    let rawData = "garbage data with no structure";
    let outcomes = extractBinaryOutcomes(rawData);
    assert.i32Equals(outcomes.length, 0);
  });

  test("Should handle empty ancillary data", () => {
    clearStore();
    let ancillaryData = Bytes.fromUTF8("");

    let event = createQuestionInitializedEvent(
      QUESTION_ID,
      TIMESTAMP,
      REQUESTER,
      ancillaryData,
      CURRENCY,
      REWARD,
      BigInt.fromI32(1000)
    );

    handleQuestionInitialized(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("MarketMetadata", questionIdHex, "title", "Unknown Market");
    assert.fieldEquals("MarketMetadata", questionIdHex, "outcomes", "[]");
  });

  test("Should handle ancillary data with only title", () => {
    clearStore();
    let ancillaryData = Bytes.fromUTF8("title: Only a title here");

    let event = createQuestionInitializedEvent(
      QUESTION_ID,
      TIMESTAMP,
      REQUESTER,
      ancillaryData,
      CURRENCY,
      REWARD,
      BigInt.fromI32(1000)
    );

    handleQuestionInitialized(event);

    let questionIdHex = QUESTION_ID.toHexString();
    assert.fieldEquals("MarketMetadata", questionIdHex, "title", "Only a title here");
    assert.fieldEquals("MarketMetadata", questionIdHex, "outcomes", "[]");
  });
});
