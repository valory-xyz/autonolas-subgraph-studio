import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ConditionPreparation as ConditionPreparationEvent,
  PayoutRedemption as PayoutRedemptionEvent,
} from "../generated/ConditionalTokens/ConditionalTokens";
import { Bet, ConditionPreparation, MarketParticipant, Question } from "../generated/schema";
import {
  updateTraderAgentPayout,
  updateMarketParticipantPayout,
  updateGlobalPayout,
  getDailyProfitStatistic,
  addProfitParticipant,
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

  // Update global payouts only for our markets
  updateGlobalPayout(event.params.payout);

  // Update payout for market participant
  updateMarketParticipantPayout(event.params.redeemer, question.fixedProductMarketMaker as Bytes, event.params.payout);

  // Update daily profit for agent (for won bets)
  let fpmmId = question.fixedProductMarketMaker as Bytes;
  let participantId = event.params.redeemer.toHexString() + "_" + fpmmId.toHexString();

  let fpmm = MarketParticipant.load(participantId);
  if (fpmm != null) {
    let bets = fpmm.bets;
    let totalCosts = BigInt.zero();

    for (let i = 0; i < bets.length; i++) {
      let bet = Bet.load(bets[i]);
      if (bet === null) {
        return;
      }

      if (bet.bettor == event.params.redeemer && bet.countedInProfit == false) {
        totalCosts = totalCosts.plus(bet.amount).plus(bet.feeAmount);
        bet.countedInProfit = true; // Mark as settled now that profit is recorded
        bet.save();
      }
    }

    let dailyStat = getDailyProfitStatistic(event.params.redeemer, event.block.timestamp);
    // Profit = Payout - Total Invested in this market
    dailyStat.totalPayout = dailyStat.totalPayout.plus(event.params.payout);
    dailyStat.dailyProfit = dailyStat.dailyProfit.plus(event.params.payout.minus(totalCosts));
    addProfitParticipant(dailyStat, fpmmId);
    dailyStat.save();
  }
}
