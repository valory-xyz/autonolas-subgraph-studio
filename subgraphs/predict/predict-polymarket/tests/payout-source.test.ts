// Asserts `PayoutRedemption.source` is tagged correctly per redemption path:
//   - vanilla CTF redemption        → CONDITIONAL_TOKENS
//   - NegRiskAdapter redemption     → NEG_RISK_ADAPTER
//   - CtfCollateralAdapter redeem   → COLLATERAL_ADAPTER (covers both standard
//                                     and neg-risk adapters; they share the
//                                     PositionsRedeemed event signature)
//
// Each handler delegates to `processRedemption` which writes the entity.

import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  newMockEvent,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handlePayoutRedemption } from "../src/conditional-tokens";
import { handleNegRiskPayoutRedemption } from "../src/neg-risk-mapping";
import { handlePositionsRedeemed } from "../src/collateral-adapter";
import {
  createPayoutRedemptionEvent,
  createNegRiskPayoutRedemptionEvent,
} from "./profit";
import { PositionsRedeemed as PositionsRedeemedEvent } from "../generated/CtfCollateralAdapter/CtfCollateralAdapter";
import {
  TraderAgent,
  TraderService,
  Question,
  MarketMetadata,
  MarketParticipant,
} from "../generated/schema";

const AGENT = Address.fromString("0x1234567890123456789012345678901234567890");
const SERVICE_ID = BigInt.fromI32(100);
const CONDITION = Bytes.fromHexString(
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
);
const QUESTION_ID = Bytes.fromHexString(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
);
const DUMMY_HASH = Bytes.fromHexString(
  "0x1234567890123456789012345678901234567890123456789012345678901234"
);
const START_TS = BigInt.fromI32(1710000000);

function createPositionsRedeemedEvent(
  initiator: Address,
  conditionId: Bytes,
  amounts: BigInt[],
  payout: BigInt,
  timestamp: BigInt
): PositionsRedeemedEvent {
  let event = changetype<PositionsRedeemedEvent>(newMockEvent());
  event.block.timestamp = timestamp;
  event.block.number = BigInt.fromI32(1000);
  event.transaction.hash = DUMMY_HASH;
  event.parameters = [
    new ethereum.EventParam("initiator", ethereum.Value.fromAddress(initiator)),
    new ethereum.EventParam("conditionId", ethereum.Value.fromFixedBytes(conditionId)),
    new ethereum.EventParam("amounts", ethereum.Value.fromUnsignedBigIntArray(amounts)),
    new ethereum.EventParam("payout", ethereum.Value.fromUnsignedBigInt(payout)),
  ];
  return event;
}

// Seeds the minimal entity graph that `processRedemption` requires to NOT
// early-return (TraderAgent + Question + MarketParticipant). Without this
// the handlers under test would be no-ops.
function seedAgentWithMarket(): void {
  const serviceKey = SERVICE_ID.toHexString();
  let service = new TraderService(serviceKey);
  service.agentIds = [];
  service.operators = [];
  service.save();

  let agent = new TraderAgent(AGENT);
  agent.serviceId = SERVICE_ID;
  agent.traderService = service.id;
  agent.totalBets = 0;
  agent.totalTraded = BigInt.zero();
  agent.totalTradedSettled = BigInt.zero();
  agent.totalPayout = BigInt.zero();
  agent.totalExpectedPayout = BigInt.zero();
  agent.blockNumber = BigInt.fromI32(1000);
  agent.blockTimestamp = START_TS;
  agent.transactionHash = DUMMY_HASH;
  agent.save();

  let metadata = new MarketMetadata(QUESTION_ID);
  metadata.title = "Will the test pass?";
  metadata.outcomes = ["No", "Yes"];
  metadata.rawAncillaryData = "irrelevant";
  metadata.save();

  let question = new Question(CONDITION);
  question.questionId = QUESTION_ID;
  question.isNegRisk = false;
  question.metadata = metadata.id;
  question.blockNumber = BigInt.fromI32(1000);
  question.blockTimestamp = START_TS;
  question.transactionHash = DUMMY_HASH;
  question.save();

  const participantId = AGENT.toHexString() + "_" + CONDITION.toHexString();
  let participant = new MarketParticipant(participantId);
  participant.traderAgent = agent.id;
  participant.question = question.id;
  participant.totalBets = 0;
  participant.totalTraded = BigInt.zero();
  participant.totalTradedSettled = BigInt.zero();
  participant.totalPayout = BigInt.zero();
  participant.outcomeShares0 = BigInt.zero();
  participant.outcomeShares1 = BigInt.zero();
  participant.expectedPayout = BigInt.zero();
  participant.settled = false;
  participant.bets = [];
  participant.createdAt = START_TS;
  participant.blockNumber = BigInt.fromI32(1000);
  participant.blockTimestamp = START_TS;
  participant.transactionHash = DUMMY_HASH;
  participant.save();
}

// Single PayoutRedemption row in the store right now — used to assert the
// `source` field without knowing the auto-generated entity id format.
function singlePayoutRedemptionId(logIndex: i32): string {
  return DUMMY_HASH.concat(Bytes.fromI32(logIndex)).toHexString();
}

describe("PayoutRedemption.source — per-handler tagging", () => {
  beforeEach(() => {
    clearStore();
    seedAgentWithMarket();
  });

  test("Vanilla CTF redemption tags source = CONDITIONAL_TOKENS", () => {
    const event = createPayoutRedemptionEvent(
      AGENT,
      BigInt.fromI32(1_000_000),
      CONDITION,
      START_TS
    );
    event.transaction.hash = DUMMY_HASH;
    event.logIndex = BigInt.fromI32(0);

    handlePayoutRedemption(event);

    assert.fieldEquals(
      "PayoutRedemption",
      singlePayoutRedemptionId(0),
      "source",
      "CONDITIONAL_TOKENS"
    );
  });

  test("NegRiskAdapter redemption tags source = NEG_RISK_ADAPTER", () => {
    const event = createNegRiskPayoutRedemptionEvent(
      AGENT,
      CONDITION,
      [BigInt.fromI32(1)],
      BigInt.fromI32(2_000_000),
      START_TS
    );
    event.transaction.hash = DUMMY_HASH;
    event.logIndex = BigInt.fromI32(1);

    handleNegRiskPayoutRedemption(event);

    assert.fieldEquals(
      "PayoutRedemption",
      singlePayoutRedemptionId(1),
      "source",
      "NEG_RISK_ADAPTER"
    );
  });

  test("CtfCollateralAdapter redemption tags source = COLLATERAL_ADAPTER", () => {
    const event = createPositionsRedeemedEvent(
      AGENT,
      CONDITION,
      [BigInt.fromI32(1)],
      BigInt.fromI32(3_000_000),
      START_TS
    );
    event.transaction.hash = DUMMY_HASH;
    event.logIndex = BigInt.fromI32(2);

    handlePositionsRedeemed(event);

    assert.fieldEquals(
      "PayoutRedemption",
      singlePayoutRedemptionId(2),
      "source",
      "COLLATERAL_ADAPTER"
    );
  });
});
