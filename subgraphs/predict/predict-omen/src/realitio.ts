import { BigInt, log } from "@graphprotocol/graph-ts";
import {
  LogNewQuestion as LogNewQuestionEvent,
  LogNewAnswer as LogNewAnswerEvent,
  LogAnswerReveal as LogAnswerRevealEvent,
  LogNotifyOfArbitrationRequest as LogNotifyOfArbitrationRequestEvent,
  LogFinalize as LogFinalizeEvent,
} from "../generated/Realitio/Realitio";
import {
  Question,
  QuestionFinalized,
  TraderAgent,
  FixedProductMarketMakerCreation,
  LogNotifyOfArbitrationRequest,
  MarketParticipant,
  DailyProfitStatistic,
} from "../generated/schema";
import { CREATOR_ADDRESSES } from "./constants";
import { addProfitParticipant, bytesToBigInt, getDailyProfitStatistic, getDayTimestamp, getGlobal, saveMapValues } from "./utils";

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
  if (fpmm.currentAnswer !== null) {
    log.critical("More than one Log New Answer event happened for fpmmId: {}", [id.toHexString()]);
    return;
  }

  fpmm.currentAnswer = event.params.answer;
  fpmm.currentAnswerTimestamp = event.block.timestamp;
  fpmm.save();

   // 1. Pre-compute values outside the loop to avoid redundant calculations
  // needed for performance and data integrity
  let answerBigInt = bytesToBigInt(event.params.answer);
  let global = getGlobal();
  let globalTradedSettledDelta = BigInt.zero();
  let globalFeesSettledDelta = BigInt.zero();
  
  let dailyStatsCache = new Map<string, DailyProfitStatistic>();
  let agentCache = new Map<string, TraderAgent>();
  let participantCache = new Map<string, MarketParticipant>();

  let bets = fpmm.bets.load();
  for (let i = 0; i < bets.length; i++) {
    let bet = bets[i];
    if (bet === null) continue;

    // use boolean to track if bet was modified to save it in the end
    let betModified = false;
    let agentId = bet.bettor.toHexString();

    // 2. Load Agent, use cache if available
    let agent = agentCache.has(agentId)
      ? agentCache.get(agentId)!
      : TraderAgent.load(bet.bettor);
    if (agent === null) continue;

    // 3. Process Incorrect Bets Only
    // Correct bets are ignored here and handled in handlePayoutRedemption
    if (!bet.outcomeIndex.equals(answerBigInt)) {
      
      // Update Settlement Totals (Volume & Fees)
      if (bet.countedInTotal === false) {
        agent.totalTradedSettled = agent.totalTradedSettled.plus(bet.amount);
        agent.totalFeesSettled = agent.totalFeesSettled.plus(bet.feeAmount);
        
        let partId = agentId + "_" + fpmm.id.toHexString();
        let participant = participantCache.has(partId)
          ? participantCache.get(partId)!
          : MarketParticipant.load(partId);

        if (participant != null) {
          participant.totalTradedSettled = participant.totalTradedSettled.plus(bet.amount);
          participant.totalFeesSettled = participant.totalFeesSettled.plus(bet.feeAmount);
          participantCache.set(partId, participant);
        }

        globalTradedSettledDelta = globalTradedSettledDelta.plus(bet.amount);
        globalFeesSettledDelta = globalFeesSettledDelta.plus(bet.feeAmount);
        
        bet.countedInTotal = true;
        betModified = true;
      }

      // Update Profit Statistics
      if (bet.countedInProfit === false) {
        let statId = agentId + "_" + getDayTimestamp(event.block.timestamp).toString();
        let dailyStat = dailyStatsCache.has(statId)
          ? dailyStatsCache.get(statId)!
          : getDailyProfitStatistic(bet.bettor, event.block.timestamp);

        let lossAmount = bet.amount.plus(bet.feeAmount);
        dailyStat.dailyProfit = dailyStat.dailyProfit.minus(lossAmount);
        addProfitParticipant(dailyStat, fpmm.id);
        
        dailyStatsCache.set(statId, dailyStat);
        bet.countedInProfit = true;
        betModified = true;
      }
    }

    if (betModified) {
      bet.save();
      agentCache.set(agentId, agent);
    }
  }

  // 4. Finalizing cached data and global
  saveMapValues(agentCache);
  saveMapValues(participantCache);
  saveMapValues(dailyStatsCache);

  if (globalTradedSettledDelta.gt(BigInt.zero()) || globalFeesSettledDelta.gt(BigInt.zero())) {
    global.totalTradedSettled = global.totalTradedSettled.plus(globalTradedSettledDelta);
    global.totalFeesSettled = global.totalFeesSettled.plus(globalFeesSettledDelta);
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
