import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  newMockEvent,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleOrderFilled, handleTokenRegistered } from "../src/ctf-exchange";
import { handleOOQuestionResolved } from "../src/uma-mapping";
import { handlePayoutRedemption } from "../src/conditional-tokens";
import { handleNegRiskPayoutRedemption } from "../src/neg-risk-mapping";
import {
  createOrderFilledEvent,
  createQuestionResolvedEvent,
  createPayoutRedemptionEvent,
  createTokenRegisteredEvent,
  createNegRiskPayoutRedemptionEvent,
} from "./profit";
import { Multisig, Question, MarketMetadata } from "../generated/schema";
import {
  TestAddresses,
  TestBytes,
  TestConstants,
  createBridge,
  normalizeTimestamp,
} from "./test-helpers";

const AGENT = TestAddresses.TRADER_AGENT_1;
const CONDITION_WON = TestBytes.CONDITION_ID_2;
const QUESTION_WON = TestBytes.QUESTION_ID_2;
const TOKEN_0 = BigInt.fromI32(200);
const TOKEN_1 = BigInt.fromI32(201);
const DAY = 86400;
const START_TS = TestConstants.TIMESTAMP_START;

function setupMultisig(address: Address, serviceId: BigInt): void {
  let multisig = new Multisig(address);
  multisig.serviceId = serviceId;
  multisig.agentIds = [86];
  let ops: Bytes[] = [];
  multisig.operators = ops;
  multisig.createdAt = START_TS;
  multisig.blockNumber = TestConstants.BLOCK_NUMBER_START;
  multisig.transactionHash = TestBytes.DUMMY_HASH;
  multisig.save();
}

function setupMarket(conditionId: Bytes, questionId: Bytes, isNegRisk: boolean): void {
  createBridge(questionId, conditionId);

  let metadata = new MarketMetadata(questionId);
  metadata.title = "test market";
  metadata.outcomes = ["Yes", "No"];
  metadata.rawAncillaryData = "test";
  metadata.save();

  let question = new Question(conditionId);
  question.questionId = questionId;
  question.metadata = metadata.id;
  question.isNegRisk = isNegRisk;
  question.blockNumber = TestConstants.BLOCK_NUMBER_START;
  question.blockTimestamp = START_TS;
  question.transactionHash = TestBytes.DUMMY_HASH;
  question.save();

  handleTokenRegistered(createTokenRegisteredEvent(TOKEN_0, TOKEN_1, conditionId));
}

describe("PayoutRedemption - PayoutSource annotation", () => {
  beforeEach(() => {
    clearStore();
    setupMultisig(AGENT, TestConstants.SERVICE_ID_1);
  });

  test("Vanilla ConditionalTokens redemption is marked CONDITIONAL_TOKENS", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, false);

    handleOrderFilled(
      createOrderFilledEvent(
        AGENT,
        BigInt.fromI32(1000),
        BigInt.fromI32(2000),
        TOKEN_0,
        START_TS,
      ),
    );

    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(
      createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS),
    );

    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    let redemption = createPayoutRedemptionEvent(
      AGENT,
      BigInt.fromI32(2000),
      CONDITION_WON,
      day7TS,
    );
    handlePayoutRedemption(redemption);

    let redemptionId = redemption.transaction.hash
      .concat(Bytes.fromI32(redemption.logIndex.toI32()))
      .toHexString();
    assert.fieldEquals(
      "PayoutRedemption",
      redemptionId,
      "source",
      "CONDITIONAL_TOKENS",
    );
    assert.fieldEquals(
      "PayoutRedemption",
      redemptionId,
      "redeemer",
      AGENT.toHexString(),
    );
    assert.fieldEquals(
      "PayoutRedemption",
      redemptionId,
      "payoutAmount",
      "2000",
    );
  });

  test("NegRiskAdapter redemption is marked NEG_RISK_ADAPTER", () => {
    setupMarket(CONDITION_WON, QUESTION_WON, true);

    handleOrderFilled(
      createOrderFilledEvent(
        AGENT,
        BigInt.fromI32(1000),
        BigInt.fromI32(2000),
        TOKEN_0,
        START_TS,
      ),
    );

    let day3TS = START_TS.plus(BigInt.fromI32(DAY * 2));
    let payouts = [BigInt.fromString("1000000000000000000"), BigInt.fromI32(0)];
    handleOOQuestionResolved(
      createQuestionResolvedEvent(QUESTION_WON, payouts, BigInt.fromI32(0), day3TS),
    );

    let day7TS = START_TS.plus(BigInt.fromI32(DAY * 6));
    let redemption = createNegRiskPayoutRedemptionEvent(
      AGENT,
      CONDITION_WON,
      [BigInt.fromI32(2000), BigInt.zero()],
      BigInt.fromI32(2000),
      day7TS,
    );
    handleNegRiskPayoutRedemption(redemption);

    let redemptionId = redemption.transaction.hash
      .concat(Bytes.fromI32(redemption.logIndex.toI32()))
      .toHexString();
    assert.fieldEquals(
      "PayoutRedemption",
      redemptionId,
      "source",
      "NEG_RISK_ADAPTER",
    );
    assert.fieldEquals(
      "PayoutRedemption",
      redemptionId,
      "payoutAmount",
      "2000",
    );
  });
});
