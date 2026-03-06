import { Bytes } from "@graphprotocol/graph-ts";
import {
  ConditionPreparation as ConditionPreparationEvent,
  PayoutRedemption as PayoutRedemptionEvent,
} from "../generated/ConditionalTokens/ConditionalTokens";
import { ConditionPreparation, MarketParticipant, PayoutRedemption, Question, TraderAgent } from "../generated/schema";
import {
  getDailyProfitStatistic,
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
  const payoutAmount = event.params.payout;

  // 1. Create immutable debug log for every payout redemption event
  let logEntity = new PayoutRedemption(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  logEntity.redeemer = redeemer;
  logEntity.conditionId = event.params.conditionId;
  logEntity.payoutAmount = payoutAmount;
  logEntity.fixedProductMarketMaker = fpmmId;
  logEntity.blockNumber = event.block.number;
  logEntity.blockTimestamp = event.block.timestamp;
  logEntity.transactionHash = event.transaction.hash;
  logEntity.save();

  // 2. Update actual payout totals (profit is already calculated at settlement)
  const participantId = redeemer.toHexString() + "_" + fpmmId.toHexString();
  const participant = MarketParticipant.load(participantId);
  if (participant === null) return;

  let agent = TraderAgent.load(redeemer);
  if (agent === null) return;

  let global = getGlobal();

  agent.totalPayout = agent.totalPayout.plus(payoutAmount);
  participant.totalPayout = participant.totalPayout.plus(payoutAmount);
  global.totalPayout = global.totalPayout.plus(payoutAmount);

  // 3. Track actual payout in daily stats
  let dailyStat = getDailyProfitStatistic(redeemer, event.block.timestamp);
  dailyStat.totalPayout = dailyStat.totalPayout.plus(payoutAmount);
  dailyStat.save();

  // 4. Save
  agent.save();
  participant.save();
  global.save();
}