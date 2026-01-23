import {
  ConditionPreparation as ConditionPreparationEvent,
  PayoutRedemption as PayoutRedemptionEvent,
} from "../generated/ConditionalTokens/ConditionalTokens";
import {
  QuestionIdToConditionId,
  Question,
  TraderAgent,
  MarketParticipant,
  Bet,
} from "../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";
import {
  getDailyProfitStatistic,
  addProfitParticipant,
  getGlobal
} from "./utils";

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
  const redeemer = event.params.redeemer;
  const conditionId = event.params.conditionId;

  // 1. Validation: Only process if it's one of our agents
  let agent = TraderAgent.load(redeemer);
  if (agent == null) return;

  // 2. Validation: Only process if it's one of markets we track
  let question = Question.load(conditionId);
  if (question == null) return;

  let participantId = redeemer.toHexString() + "_" + conditionId.toHexString();
  let participant = MarketParticipant.load(participantId);
  if (participant == null) return;

  let global = getGlobal();

  // 3. Identify the amount that needs to be moved to 'Settled'
  // (Total Traded - Already Settled)
  let amountToSettle = participant.totalTraded.minus(participant.totalTradedSettled);
  const payoutAmount = event.params.payout;

  if (amountToSettle.gt(BigInt.zero())) {
    // Update Agent
    agent.totalTradedSettled = agent.totalTradedSettled.plus(amountToSettle);

    // Update Participant
    participant.totalTradedSettled = participant.totalTradedSettled.plus(amountToSettle);

    // Update Global
    global.totalTradedSettled = global.totalTradedSettled.plus(amountToSettle);
  }

  // 4. Update Payout Totals across all entities
  agent.totalPayout = agent.totalPayout.plus(payoutAmount);
  participant.totalPayout = participant.totalPayout.plus(payoutAmount);
  global.totalPayout = global.totalPayout.plus(payoutAmount);

  // 5. Update booleans for all bets in this specific market
  // We use participant.bets to avoid loading the agent's entire history
  let betIds = participant.bets;
  for (let i = 0; i < betIds.length; i++) {
    let bet = Bet.load(betIds[i]);
    if (bet !== null && !bet.countedInProfit) {
      bet.countedInProfit = true;
      bet.countedInTotal = true; 
      bet.save();
    }
  }

  // 6. Update Daily Statistics
  let dailyStat = getDailyProfitStatistic(redeemer, event.block.timestamp);
  dailyStat.totalPayout = dailyStat.totalPayout.plus(payoutAmount);
  
  // Profit = Current Payout - Cost of shares being settled now
  dailyStat.dailyProfit = dailyStat.dailyProfit.plus(payoutAmount.minus(amountToSettle));
  
  addProfitParticipant(dailyStat, conditionId);

  // 7. Save cached entities
  agent.save();
  participant.save();
  global.save();
  dailyStat.save();
}
