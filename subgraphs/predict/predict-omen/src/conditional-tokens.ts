import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ConditionPreparation as ConditionPreparationEvent,
  PayoutRedemption as PayoutRedemptionEvent,
} from "../generated/ConditionalTokens/ConditionalTokens";
import { Bet, ConditionPreparation, MarketParticipant, Question, TraderAgent } from "../generated/schema";
import {
  getDailyProfitStatistic,
  addProfitParticipant,
  getGlobal,
} from "./utils";

export function handleConditionPreparation(event: ConditionPreparationEvent): void {
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
  // Find the related market by traversing: condition → question → fixedProductMarketMaker
  let condition = ConditionPreparation.load(event.params.conditionId.toHexString());
  if (condition === null) {
    return;
  }

  let question = Question.load(condition.questionId.toHexString());
  if (question === null || question.fixedProductMarketMaker === null) {
    return;
  }
  
  const fpmmId = question.fixedProductMarketMaker as Bytes;
  const redeemer = event.params.redeemer;
  const participantId = redeemer.toHexString() + "_" + fpmmId.toHexString();
  const participant = MarketParticipant.load(participantId);
  
  if (participant === null) return;

  let agent = TraderAgent.load(redeemer);
  if (agent === null) return;

  let global = getGlobal();

  // 2. Identify the amount that needs to be moved to 'Settled'
  // (Total Traded - Already Settled)
  let amountToSettle = participant.totalTraded.minus(participant.totalTradedSettled);
  let feesToSettle = participant.totalFees.minus(participant.totalFeesSettled);

  if (amountToSettle.gt(BigInt.zero())) {
    // Update Agent Totals
    agent.totalTradedSettled = agent.totalTradedSettled.plus(amountToSettle);
    agent.totalFeesSettled = agent.totalFeesSettled.plus(feesToSettle);
    agent.totalPayout = agent.totalPayout.plus(event.params.payout);

    // Update Participant Totals
    participant.totalTradedSettled = participant.totalTradedSettled.plus(amountToSettle);
    participant.totalFeesSettled = participant.totalFeesSettled.plus(feesToSettle);
    participant.totalPayout = participant.totalPayout.plus(event.params.payout);

    // Update Global Totals
    global.totalTradedSettled = global.totalTradedSettled.plus(amountToSettle);
    global.totalFeesSettled = global.totalFeesSettled.plus(feesToSettle);
    global.totalPayout = global.totalPayout.plus(event.params.payout);
  }

  // 3. Update 'countedInProfit' for all bets in this specific market
  // We use participant.bets to avoid loading the agent's entire history
  let betIds = participant.bets;
  for (let i = 0; i < betIds.length; i++) {
    let bet = Bet.load(betIds[i]);
    if (bet !== null && !bet.countedInProfit) {
      bet.countedInProfit = true;
      // Also ensure countedInTotal is flipped if it wasn't already
      bet.countedInTotal = true; 
      bet.save();
    }
  }

  // 4. Update Daily Statistics
  let dailyStat = getDailyProfitStatistic(redeemer, event.block.timestamp);
  dailyStat.totalPayout = dailyStat.totalPayout.plus(event.params.payout);
  
  // Profit Calculation: Payout - (Investment + Fees)
  let totalCost = amountToSettle.plus(feesToSettle);
  dailyStat.dailyProfit = dailyStat.dailyProfit.plus(event.params.payout.minus(totalCost));
  
  addProfitParticipant(dailyStat, fpmmId);

  // 5. Save cached entities
  agent.save();
  participant.save();
  global.save();
  dailyStat.save();
}