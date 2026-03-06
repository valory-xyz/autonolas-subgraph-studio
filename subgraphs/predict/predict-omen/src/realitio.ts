import { BigInt, log } from "@graphprotocol/graph-ts";
import {
  LogNewQuestion as LogNewQuestionEvent,
  LogNewAnswer as LogNewAnswerEvent,
  LogAnswerReveal as LogAnswerRevealEvent,
  LogNotifyOfArbitrationRequest as LogNotifyOfArbitrationRequestEvent,
  LogFinalize as LogFinalizeEvent,
} from "../generated/Realitio/Realitio";
import {
  Bet,
  Question,
  QuestionFinalized,
  TraderAgent,
  FixedProductMarketMakerCreation,
  LogNotifyOfArbitrationRequest,
  DailyProfitStatistic,
} from "../generated/schema";
import { CREATOR_ADDRESSES } from "./constants";
import { addProfitParticipant, removeProfitParticipant, bytesToBigInt, getDailyProfitStatistic, getDayTimestamp, getGlobal, saveMapValues } from "./utils";

export function handleLogNewQuestion(event: LogNewQuestionEvent): void {
  // only safe questions for our creators
  if (CREATOR_ADDRESSES.indexOf(event.params.user.toHexString().toLowerCase()) === -1) {
    return;
  }

  let entity = new Question(event.params.question_id.toHexString());
  entity.question = event.params.question;
  entity.save();
}

export function handleLogNewAnswer(event: LogNewAnswerEvent): void {
  if (event.params.is_commitment) {
    // only record confirmed answers
    return;
  }

  let question = Question.load(event.params.question_id.toHexString());

  if (question === null || question.fixedProductMarketMaker === null) {
    // only record data for our markets
    return;
  }

  question.currentAnswer = event.params.answer;
  question.currentAnswerTimestamp = event.block.timestamp;
  question.save();

  let id = question.fixedProductMarketMaker;
  if (id === null) return;

  let fpmm = FixedProductMarketMakerCreation.load(id);
  if (fpmm === null) return;

  let previousAnswer = fpmm.currentAnswer;
  let previousAnswerTimestamp = fpmm.currentAnswerTimestamp;
  fpmm.currentAnswer = event.params.answer;
  fpmm.currentAnswerTimestamp = event.block.timestamp;
  fpmm.save();

  let isReAnswer = previousAnswer !== null && previousAnswer != event.params.answer;

  if (isReAnswer) {
    log.warning("Re-answer for market {}: prev={}, new={}", [
      fpmm.id.toHexString(),
      previousAnswer!.toHexString(),
      event.params.answer.toHexString()
    ]);
  }

  // 1. Pre-compute values outside the loop
  let answerBigInt = bytesToBigInt(event.params.answer);
  let isAnswer0 = answerBigInt.equals(BigInt.zero());
  let isAnswer1 = answerBigInt.equals(BigInt.fromI32(1));
  let TWO = BigInt.fromI32(2);

  let global = getGlobal();
  let globalTradedSettledDelta = BigInt.zero();
  let globalFeesSettledDelta = BigInt.zero();
  let globalExpectedPayoutDelta = BigInt.zero();

  let agentCache = new Map<string, TraderAgent>();
  let dailyStatsCache = new Map<string, DailyProfitStatistic>();

  // 2. Iterate participants (not bets) — fewer entities, pruning-resilient
  let participants = fpmm.participants.load();
  for (let i = 0; i < participants.length; i++) {
    let participant = participants[i];
    if (participant === null) continue;

    if (participant.settled) {
      if (!isReAnswer) continue; // unlikely, but if same answer resubmission — skip

      // --- RE-ANSWER PATH: reverse old settlement, apply new ---
      let agentId = participant.traderAgent.toHexString();
      let agent = agentCache.has(agentId)
        ? agentCache.get(agentId)!
        : TraderAgent.load(participant.traderAgent);
      if (agent === null) continue;

      // 1. Reconstruct old profit from stored settlement values
      let oldExpectedPayout = participant.expectedPayout;
      let oldProfit = oldExpectedPayout
        .minus(participant.totalTradedSettled)
        .minus(participant.totalFeesSettled);

      // 2. Calculate new expected payout from current token balances + new answer
      let newExpectedPayout = BigInt.zero();
      if (isAnswer0) {
        let balance = participant.outcomeTokenBalance0;
        newExpectedPayout = balance.gt(BigInt.zero()) ? balance : BigInt.zero();
      } else if (isAnswer1) {
        let balance = participant.outcomeTokenBalance1;
        newExpectedPayout = balance.gt(BigInt.zero()) ? balance : BigInt.zero();
      } else {
        let b0 = participant.outcomeTokenBalance0;
        let b1 = participant.outcomeTokenBalance1;
        let payout0 = b0.gt(BigInt.zero()) ? b0.div(TWO) : BigInt.zero();
        let payout1 = b1.gt(BigInt.zero()) ? b1.div(TWO) : BigInt.zero();
        newExpectedPayout = payout0.plus(payout1);
      }

      // 3. Calculate incremental settlement for any bets placed between answers
      let newAmountToSettle = participant.totalTraded.minus(participant.totalTradedSettled);
      let newFeesToSettle = participant.totalFees.minus(participant.totalFeesSettled);

      // 4. Calculate new profit using full market cost (not incremental) — ensures correct
      //    reconstruction on subsequent re-answers via expectedPayout - totalTradedSettled - totalFeesSettled
      let newProfit = newExpectedPayout.minus(participant.totalTraded).minus(participant.totalFees);

      // 5. Reverse old daily stat (using previous answer's timestamp)
      let oldTimestamp = previousAnswerTimestamp !== null
        ? previousAnswerTimestamp as BigInt
        : event.block.timestamp;
      let oldStatId = agentId + "_" + getDayTimestamp(oldTimestamp).toString();
      let oldDailyStat = dailyStatsCache.has(oldStatId)
        ? dailyStatsCache.get(oldStatId)!
        : getDailyProfitStatistic(participant.traderAgent, oldTimestamp);
      oldDailyStat.dailyProfit = oldDailyStat.dailyProfit.minus(oldProfit);
      removeProfitParticipant(oldDailyStat, fpmm.id);
      dailyStatsCache.set(oldStatId, oldDailyStat);

      // 6. Apply to new daily stat
      let newStatId = agentId + "_" + getDayTimestamp(event.block.timestamp).toString();
      let newDailyStat = dailyStatsCache.has(newStatId)
        ? dailyStatsCache.get(newStatId)!
        : getDailyProfitStatistic(participant.traderAgent, event.block.timestamp);
      newDailyStat.dailyProfit = newDailyStat.dailyProfit.plus(newProfit);
      addProfitParticipant(newDailyStat, fpmm.id);
      dailyStatsCache.set(newStatId, newDailyStat);

      // 7. Update agent
      agent.totalExpectedPayout = agent.totalExpectedPayout
        .minus(oldExpectedPayout)
        .plus(newExpectedPayout);
      agent.totalTradedSettled = agent.totalTradedSettled.plus(newAmountToSettle);
      agent.totalFeesSettled = agent.totalFeesSettled.plus(newFeesToSettle);
      agentCache.set(agentId, agent);

      // 8. Update participant
      participant.expectedPayout = newExpectedPayout;
      participant.totalTradedSettled = participant.totalTraded;
      participant.totalFeesSettled = participant.totalFees;

      // 9. Accumulate global deltas
      globalExpectedPayoutDelta = globalExpectedPayoutDelta
        .plus(newExpectedPayout)
        .minus(oldExpectedPayout);
      globalTradedSettledDelta = globalTradedSettledDelta.plus(newAmountToSettle);
      globalFeesSettledDelta = globalFeesSettledDelta.plus(newFeesToSettle);

      // 10. Mark any new bets as counted
      let reBetIds = participant.bets;
      for (let j = 0; j < reBetIds.length; j++) {
        let bet = Bet.load(reBetIds[j]);
        if (bet !== null && !bet.countedInProfit) {
          bet.countedInProfit = true;
          bet.countedInTotal = true;
          bet.save();
        }
      }

      participant.save();
      continue;
    }

    // --- FRESH SETTLEMENT PATH (non-settled participants) ---
    let agentId = participant.traderAgent.toHexString();
    let agent = agentCache.has(agentId)
      ? agentCache.get(agentId)!
      : TraderAgent.load(participant.traderAgent);
    if (agent === null) continue;

    // 3. Calculate expected payout from outcome token balances
    let expectedPayout = BigInt.zero();
    if (isAnswer0) {
      let balance = participant.outcomeTokenBalance0;
      expectedPayout = balance.gt(BigInt.zero()) ? balance : BigInt.zero();
    } else if (isAnswer1) {
      let balance = participant.outcomeTokenBalance1;
      expectedPayout = balance.gt(BigInt.zero()) ? balance : BigInt.zero();
    } else {
      // Invalid answer — equal split [1,1] payouts, each token worth 1/2 collateral
      let b0 = participant.outcomeTokenBalance0;
      let b1 = participant.outcomeTokenBalance1;
      let payout0 = b0.gt(BigInt.zero()) ? b0.div(TWO) : BigInt.zero();
      let payout1 = b1.gt(BigInt.zero()) ? b1.div(TWO) : BigInt.zero();
      expectedPayout = payout0.plus(payout1);
    }

    // 4. Calculate settlement amounts
    let amountToSettle = participant.totalTraded.minus(participant.totalTradedSettled);
    let feesToSettle = participant.totalFees.minus(participant.totalFeesSettled);

    // 5. Calculate profit: expectedPayout - cost
    let profit = expectedPayout.minus(amountToSettle).minus(feesToSettle);

    // 6. Update participant — settle everything at once
    participant.expectedPayout = expectedPayout;
    participant.totalTradedSettled = participant.totalTraded;
    participant.totalFeesSettled = participant.totalFees;
    participant.settled = true;

    // 7. Update agent (via cache)
    agent.totalTradedSettled = agent.totalTradedSettled.plus(amountToSettle);
    agent.totalFeesSettled = agent.totalFeesSettled.plus(feesToSettle);
    agent.totalExpectedPayout = agent.totalExpectedPayout.plus(expectedPayout);
    agentCache.set(agentId, agent);

    // 8. Update daily stats (via cache)
    let statId = agentId + "_" + getDayTimestamp(event.block.timestamp).toString();
    let dailyStat = dailyStatsCache.has(statId)
      ? dailyStatsCache.get(statId)!
      : getDailyProfitStatistic(participant.traderAgent, event.block.timestamp);
    dailyStat.dailyProfit = dailyStat.dailyProfit.plus(profit);
    addProfitParticipant(dailyStat, fpmm.id);
    dailyStatsCache.set(statId, dailyStat);

    // 9. Accumulate global deltas
    globalTradedSettledDelta = globalTradedSettledDelta.plus(amountToSettle);
    globalFeesSettledDelta = globalFeesSettledDelta.plus(feesToSettle);
    globalExpectedPayoutDelta = globalExpectedPayoutDelta.plus(expectedPayout);

    // 10. Mark individual bets via participant.bets (stored array, not derived)
    let betIds = participant.bets;
    for (let j = 0; j < betIds.length; j++) {
      let bet = Bet.load(betIds[j]);
      if (bet !== null && !bet.countedInProfit) {
        bet.countedInProfit = true;
        bet.countedInTotal = true;
        bet.save();
      }
    }

    participant.save();
  }

  // 11. Batch save cached entities
  saveMapValues(agentCache);
  saveMapValues(dailyStatsCache);

  // 12. Update global with accumulated deltas
  if (!globalTradedSettledDelta.equals(BigInt.zero()) || !globalFeesSettledDelta.equals(BigInt.zero()) || !globalExpectedPayoutDelta.equals(BigInt.zero())) {
    global.totalTradedSettled = global.totalTradedSettled.plus(globalTradedSettledDelta);
    global.totalFeesSettled = global.totalFeesSettled.plus(globalFeesSettledDelta);
    global.totalExpectedPayout = global.totalExpectedPayout.plus(globalExpectedPayoutDelta);
    global.save();
  }
}

export function handleLogAnswerReveal(event: LogAnswerRevealEvent): void {
  let question = Question.load(event.params.question_id.toHexString());

  if (question === null || question.fixedProductMarketMaker === null) {
    // only record data for our markets
    return;
  }

  let questionFinalized = QuestionFinalized.load(event.params.question_id.toHexString());

  if (questionFinalized === null) {
    questionFinalized = new QuestionFinalized(event.params.question_id.toHexString());
  }
  questionFinalized.currentAnswer = event.params.answer;
  questionFinalized.currentAnswerTimestamp = event.block.timestamp;
  questionFinalized.save();
}

export function handleLogNotifyOfArbitrationRequest(event: LogNotifyOfArbitrationRequestEvent): void {
  let question = Question.load(event.params.question_id.toHexString());

  if (question === null || question.fixedProductMarketMaker === null) {
    // only record data for our markets
    return;
  }

  let entity = new LogNotifyOfArbitrationRequest(event.transaction.hash.concatI32(event.logIndex.toI32()));
  entity.question_id = event.params.question_id;
  entity.user = event.params.user;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleLogFinalize(event: LogFinalizeEvent): void {
  let question = Question.load(event.params.question_id.toHexString());

  if (question === null || question.fixedProductMarketMaker === null) {
    // only record data for our markets
    return;
  }

  let questionFinalized = new QuestionFinalized(event.params.question_id.toHexString());
  questionFinalized.currentAnswer = event.params.answer;
  questionFinalized.currentAnswerTimestamp = event.block.timestamp;
  questionFinalized.save();
}
