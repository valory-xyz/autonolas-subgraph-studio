import {
  ConditionPreparation as ConditionPreparationEvent,
  PayoutRedemption as PayoutRedemptionEvent,
} from "../generated/ConditionalTokens/ConditionalTokens";
import { QuestionIdToConditionId, Question } from "../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";
import { updateTraderAgentPayout, updateGlobalPayout, updateMarketParticipantPayout } from "./utils";

export function handleConditionPreparation(event: ConditionPreparationEvent): void {
  // we don't handle conditions with more than 2 outcomes
  if (event.params.outcomeSlotCount.toI32() != 2) {
    return;
  }

  let entity = new QuestionIdToConditionId(event.params.questionId);
  entity.conditionId = event.params.conditionId;
  entity.save();
}

/**
 * Handles payout redemption when an agent claims winnings
 * Updates totalPayout for winning bets and marks them as counted
 */
export function handlePayoutRedemption(event: PayoutRedemptionEvent): void {
  // 1. Load Question from conditionId
  let question = Question.load(event.params.conditionId);
  if (question == null) {
    // Only process redemptions for our tracked markets
    return;
  }

  // 2. Get the redeemer and payout amount
  let redeemer = event.params.redeemer;
  let payoutAmount = event.params.payout;

  // 3. Load all bets for this redeemer in this market
  let bets = question.bets.load();
  let totalCosts = BigInt.zero();

  // 4. Process winning bets (countedInProfit == false)
  for (let i = 0; i < bets.length; i++) {
    let bet = bets[i];
    if (bet && bet.bettor.toHexString() == redeemer.toHexString() && bet.countedInProfit == false) {
      // This is a winning bet being redeemed
      totalCosts = totalCosts.plus(bet.amount);
      bet.countedInProfit = true;
      // TODO: handle profit and daily statistics update
      bet.save();
    }
  }

  // 5. Only update payouts if there were winning bets
  if (!totalCosts.equals(BigInt.zero())) {
    // Update agent totalPayout
    updateTraderAgentPayout(redeemer, payoutAmount);

    // Update global totalPayout
    updateGlobalPayout(payoutAmount);

    // Update market participant totalPayout
    updateMarketParticipantPayout(redeemer, event.params.conditionId, payoutAmount);
  }
}
