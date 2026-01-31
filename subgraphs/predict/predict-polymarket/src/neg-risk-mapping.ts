import {
  QuestionPrepared as QuestionPreparedEvent,
  PayoutRedemption as PayoutRedemptionEvent,
} from "../generated/NegRiskAdapter/NegRiskAdapter";
import {
  Question,
  MarketMetadata,
  QuestionIdToConditionId,
} from "../generated/schema";
import { extractTitle } from "./uma-mapping";
import { log, BigInt } from "@graphprotocol/graph-ts";
import { processMarketResolution, processRedemption } from "./utils";
import { OutcomeReported } from "../generated/NegRiskAdapter/NegRiskAdapter";

export function handleQuestionPrepared(event: QuestionPreparedEvent): void {
  let questionId = event.params.questionId;
  let marketId = event.params.marketId;
  let rawData = event.params.data.toString();

  // 1. Find the conditionId from the CTF bridge
  let bridge = QuestionIdToConditionId.load(questionId);
  if (bridge == null) {
    log.warning("NegRisk QuestionPrepared: Bridge missing for questionId {}", [
      questionId.toHexString(),
    ]);
    return;
  }

  // 2. Create Metadata
  // For Neg Risk, Outcome 0 = Yes, Outcome 1 = No
  let metadata = new MarketMetadata(questionId);
  metadata.title = extractTitle(rawData);
  metadata.outcomes = ["Yes", "No"];
  metadata.rawAncillaryData = rawData;
  metadata.save();

  // 3. Create/Update Question
  let question = new Question(bridge.conditionId);
  question.questionId = questionId;
  question.marketId = marketId;
  question.isNegRisk = true;
  question.metadata = metadata.id;
  question.blockNumber = event.block.number;
  question.blockTimestamp = event.block.timestamp;
  question.transactionHash = event.transaction.hash;
  question.save();
}

export function handleOutcomeReported(event: OutcomeReported): void {
  let bridge = QuestionIdToConditionId.load(event.params.questionId);
  if (bridge == null) return;

  // NegRisk Logic: true = YES (outcome 0), false = NO (outcome 1)
  let isYes = event.params.outcome;
  let winningOutcome = isYes ? BigInt.fromI32(0) : BigInt.fromI32(1);

  // Payouts array for NegRisk is always [1, 0] if YES or [0, 1] if NO
  let payouts = isYes
    ? [BigInt.fromI32(1), BigInt.fromI32(0)]
    : [BigInt.fromI32(0), BigInt.fromI32(1)];

  processMarketResolution(
    bridge.conditionId,
    winningOutcome,
    isYes ? BigInt.fromI32(1) : BigInt.fromI32(0),
    payouts,
    event,
  );
}

/**
 * NegRiskAdapter has its own payout event because it wraps the CTF redemption.
 */
export function handleNegRiskPayoutRedemption(
  event: PayoutRedemptionEvent,
): void {
  processRedemption(
    event.params.redeemer,
    event.params.conditionId,
    event.params.payout,
    event.block.timestamp,
  );
}
