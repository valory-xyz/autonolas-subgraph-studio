import { Bytes } from "@graphprotocol/graph-ts";
import {
  ConditionPreparation as ConditionPreparationEvent,
  PayoutRedemption as PayoutRedemptionEvent,
} from "../generated/ConditionalTokens/ConditionalTokens";
import { ConditionPreparation, Question } from "../generated/schema";
import { updateTraderAgentPayout, updateMarketParticipantPayout, updateGlobalPayout } from "./utils";

export function handleConditionPreparation(
  event: ConditionPreparationEvent
): void {
  let question = Question.load(event.params.questionId.toHexString());
  // only safe conditions for our markets
  if (question === null) {
    return;
  }

  let entity = new ConditionPreparation(event.params.conditionId.toHexString());
  entity.conditionId = event.params.conditionId;
  entity.oracle = event.params.oracle;
  entity.questionId = event.params.questionId;
  entity.outcomeSlotCount = event.params.outcomeSlotCount;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handlePayoutRedemption(event: PayoutRedemptionEvent): void {
  updateTraderAgentPayout(event.params.redeemer, event.params.payout);

  // Find the related market by traversing: condition → question → fixedProductMarketMaker
  let condition = ConditionPreparation.load(event.params.conditionId.toHexString());
  if (condition === null) {
    return;
  }

  let question = Question.load(condition.questionId.toHexString());
  if (question === null || question.fixedProductMarketMaker === null) {
    return;
  }

  // Update global payouts only for our market participants
  updateGlobalPayout( event.params.payout)

  updateMarketParticipantPayout(
    event.params.redeemer,
    question.fixedProductMarketMaker as Bytes,
    event.params.payout
  );
}
