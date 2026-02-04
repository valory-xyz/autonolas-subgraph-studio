import {
  ConditionPreparation as ConditionPreparationEvent,
  PayoutRedemption as PayoutRedemptionEvent,
} from "../generated/ConditionalTokens/ConditionalTokens";
import { QuestionIdToConditionId } from "../generated/schema";
import { log } from "@graphprotocol/graph-ts";
import { processRedemption } from "./utils";

export function handleConditionPreparation(
  event: ConditionPreparationEvent,
): void {
  // we don't handle conditions with more than 2 outcomes
  if (event.params.outcomeSlotCount.toI32() != 2) {
    return;
  }

  let bridge = QuestionIdToConditionId.load(event.params.questionId);

  if (bridge !== null) {
    log.warning(
      "REPETITIVE_QUESTION_ID detected: {} | Existing ConditionId: {} | New ConditionId: {} | Txn Hash: {}",
      [
        event.params.questionId.toHexString(),
        bridge.conditionId.toHexString(),
        event.params.conditionId.toHexString(),
        event.transaction.hash.toHexString(),
      ],
    );

    return;
  }

  let entity = new QuestionIdToConditionId(event.params.questionId);
  entity.conditionId = event.params.conditionId;
  entity.oracle = event.params.oracle;
  entity.transactionHash = event.transaction.hash;
  entity.save();
}

export function handlePayoutRedemption(event: PayoutRedemptionEvent): void {
  processRedemption(
    event.params.redeemer,
    event.params.conditionId,
    event.params.payout,
    event.block.timestamp,
  );
}
