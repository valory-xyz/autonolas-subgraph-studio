import {
  ConditionPreparation as ConditionPreparationEvent,
  PayoutRedemption as PayoutRedemptionEvent,
} from "../generated/ConditionalTokens/ConditionalTokens";
import { QuestionIdToConditionId } from "../generated/schema";

export function handleConditionPreparation(event: ConditionPreparationEvent): void {
  // we don't handle conditions with more than 2 outcomes
  if (event.params.outcomeSlotCount.toI32() != 2) {
    return;
  }

  let entity = new QuestionIdToConditionId(event.params.questionId);
  entity.conditionId = event.params.conditionId;
  entity.save();
}

// TODO: tbd
export function handlePayoutRedemption(event: PayoutRedemptionEvent): void {}
