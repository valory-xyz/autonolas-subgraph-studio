import { assert, describe, test, clearStore, beforeEach, newMockEvent } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { FixedProductMarketMakerCreation as FixedProductMarketMakerCreationEvent } from "../generated/FPMMDeterministicFactory/FPMMDeterministicFactory";
import { handleFixedProductMarketMakerCreation } from "../src/FPMMDeterministicFactoryMapping";
import { FixedProductMarketMakerCreation, Question, ConditionPreparation } from "../generated/schema";

const SEPARATOR = "\u241f";
const CREATOR = Address.fromString("0x89c5cc945dd550bcffb72fe42bff002429f46fec");
const DUMMY_HASH = Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234");
const START_TS = BigInt.fromI32(1710000000);

function createFixedProductMarketMakerCreationEvent(
  fixedProductMarketMaker: Address,
  conditionId: Bytes
): FixedProductMarketMakerCreationEvent {
  let event = changetype<FixedProductMarketMakerCreationEvent>(newMockEvent());
  event.block.number = BigInt.fromI32(1000);
  event.block.timestamp = START_TS;
  event.transaction.hash = DUMMY_HASH;

  event.parameters = [
    new ethereum.EventParam("creator", ethereum.Value.fromAddress(CREATOR)),
    new ethereum.EventParam("fixedProductMarketMaker", ethereum.Value.fromAddress(fixedProductMarketMaker)),
    new ethereum.EventParam("conditionalTokens", ethereum.Value.fromAddress(Address.zero())),
    new ethereum.EventParam("collateralToken", ethereum.Value.fromAddress(Address.zero())),
    new ethereum.EventParam("conditionIds", ethereum.Value.fromFixedBytesArray([conditionId])),
    new ethereum.EventParam("fee", ethereum.Value.fromUnsignedBigInt(BigInt.zero())),
  ];

  return event;
}

function setupConditionAndQuestion(questionId: Bytes, questionText: string): void {
  let question = new Question(questionId.toHexString());
  question.question = questionText;
  question.save();

  let condition = new ConditionPreparation(questionId.toHexString());
  condition.questionId = questionId;
  condition.conditionId = questionId;
  condition.oracle = Address.zero();
  condition.outcomeSlotCount = BigInt.fromI32(2);
  condition.blockNumber = BigInt.fromI32(1000);
  condition.blockTimestamp = START_TS;
  condition.transactionHash = DUMMY_HASH;
  condition.save();
}

describe("Market Category & Language Parsing", () => {
  beforeEach(() => {
    clearStore();
  });

  test("Full template (4 fields): category and language parsed", () => {
    let marketAddr = Address.fromString("0x0000000000000000000000000000000000000001");
    let conditionId = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001");

    let questionText = "Will BTC hit $50k?" + SEPARATOR + "Yes,No" + SEPARATOR + "Crypto" + SEPARATOR + "en-US";
    setupConditionAndQuestion(conditionId, questionText);

    handleFixedProductMarketMakerCreation(createFixedProductMarketMakerCreationEvent(marketAddr, conditionId));

    let entity = FixedProductMarketMakerCreation.load(marketAddr);
    assert.assertNotNull(entity);
    assert.stringEquals(entity!.question!, "Will BTC hit $50k?");
    assert.stringEquals(entity!.category!, "Crypto");
    assert.stringEquals(entity!.language!, "en-US");
  });

  test("3-field template: category parsed, language null", () => {
    let marketAddr = Address.fromString("0x0000000000000000000000000000000000000002");
    let conditionId = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000002");

    let questionText = "US Election Winner?" + SEPARATOR + "Trump,Harris" + SEPARATOR + "Politics";
    setupConditionAndQuestion(conditionId, questionText);

    handleFixedProductMarketMakerCreation(createFixedProductMarketMakerCreationEvent(marketAddr, conditionId));

    let entity = FixedProductMarketMakerCreation.load(marketAddr);
    assert.assertNotNull(entity);
    assert.stringEquals(entity!.question!, "US Election Winner?");
    assert.stringEquals(entity!.category!, "Politics");
    assert.assertNull(entity!.language);
  });

  test("2-field template (legacy): category and language null", () => {
    let marketAddr = Address.fromString("0x0000000000000000000000000000000000000003");
    let conditionId = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000003");

    let questionText = "Will it rain?" + SEPARATOR + "Yes,No";
    setupConditionAndQuestion(conditionId, questionText);

    handleFixedProductMarketMakerCreation(createFixedProductMarketMakerCreationEvent(marketAddr, conditionId));

    let entity = FixedProductMarketMakerCreation.load(marketAddr);
    assert.assertNotNull(entity);
    assert.stringEquals(entity!.question!, "Will it rain?");
    assert.assertNull(entity!.category);
    assert.assertNull(entity!.language);
  });

  test("Whitespace in category/language is trimmed", () => {
    let marketAddr = Address.fromString("0x0000000000000000000000000000000000000004");
    let conditionId = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000004");

    let questionText = "Sports Question?" + SEPARATOR + "Team A,Team B" + SEPARATOR + "  Sports  " + SEPARATOR + "  en  ";
    setupConditionAndQuestion(conditionId, questionText);

    handleFixedProductMarketMakerCreation(createFixedProductMarketMakerCreationEvent(marketAddr, conditionId));

    let entity = FixedProductMarketMakerCreation.load(marketAddr);
    assert.assertNotNull(entity);
    assert.stringEquals(entity!.category!, "Sports");
    assert.stringEquals(entity!.language!, "en");
  });

  test("Special characters in outcomes don't affect category parsing", () => {
    let marketAddr = Address.fromString("0x0000000000000000000000000000000000000005");
    let conditionId = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000005");

    let questionText = "Culture Question?" + SEPARATOR + "\"Yes/No\",\"Maybe/Not\"" + SEPARATOR + "Culture" + SEPARATOR + "fr";
    setupConditionAndQuestion(conditionId, questionText);

    handleFixedProductMarketMakerCreation(createFixedProductMarketMakerCreationEvent(marketAddr, conditionId));

    let entity = FixedProductMarketMakerCreation.load(marketAddr);
    assert.assertNotNull(entity);
    assert.stringEquals(entity!.category!, "Culture");
    assert.stringEquals(entity!.language!, "fr");
    assert.i32Equals(entity!.outcomes!.length, 2);
  });
});
