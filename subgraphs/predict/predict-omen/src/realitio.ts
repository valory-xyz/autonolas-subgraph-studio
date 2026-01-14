import { BigInt } from "@graphprotocol/graph-ts";
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

  fpmm.currentAnswer = event.params.answer;
  fpmm.currentAnswerTimestamp = event.block.timestamp;
  fpmm.save();

  // 1. Pre-compute values outside the loop to avoid redundant calculations
  // needed for performance and data integrity
  let answerBigInt = bytesToBigInt(event.params.answer);
  let global = getGlobal();
  let globalTradedDelta = BigInt.zero();
  let globalFeesDelta = BigInt.zero();
  let fpmmIdHex = fpmm.id.toHexString();
  let dailyStatsCache = new Map<string, DailyProfitStatistic>();
  let agentCache = new Map<string, TraderAgent>();
  let participantCache = new Map<string, MarketParticipant>();

  let bets = fpmm.bets.load();
  for (let i = 0; i < bets.length; i++) {
    let bet = bets[i];
    if (bet === null) continue;

    // use boolean to track if bet was modified to save it in the end
    let betModified = false;

    // 2. Process Trading Volume
    if (bet.countedInTotal === false) {
      // Use cache for TraderAgent
      let agentId = bet.bettor.toHexString();
      let agent = agentCache.has(agentId) 
        ? agentCache.get(agentId)! 
        : TraderAgent.load(bet.bettor);

      if (agent !== null) {
        agent.totalTraded = agent.totalTraded.plus(bet.amount);
        agent.totalFees = agent.totalFees.plus(bet.feeAmount);
        agentCache.set(agentId, agent); // Put back in cache

        // Use cache for MarketParticipant
        let participantId = bet.bettor.toHexString() + "_" + fpmmIdHex;
        let participant = participantCache.has(participantId) 
          ? participantCache.get(participantId)! 
          : MarketParticipant.load(participantId);

        if (participant != null) {
          participant.totalTraded = participant.totalTraded.plus(bet.amount);
          participant.totalFees = participant.totalFees.plus(bet.feeAmount);
          participantCache.set(participantId, participant);
        }

        bet.countedInTotal = true;
        betModified = true;
        globalTradedDelta = globalTradedDelta.plus(bet.amount);
        globalFeesDelta = globalFeesDelta.plus(bet.feeAmount);
      }
    }

    // 3. Process Profit Statistics
    if (bet.countedInProfit === false) {
      if (!bet.outcomeIndex.equals(answerBigInt)) {
        let dayTimestamp = getDayTimestamp(event.block.timestamp);
        let statId = bet.bettor.toHexString() + "_" + dayTimestamp.toString();
        
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
    }
  }

  // 4. Final Batch Saves
  saveMapValues(agentCache);
  saveMapValues(participantCache);
  saveMapValues(dailyStatsCache);

  // Update global statistics once at the end
  if (!globalTradedDelta.equals(BigInt.zero()) || !globalFeesDelta.equals(BigInt.zero())) {
    global.totalTraded = global.totalTraded.plus(globalTradedDelta);
    global.totalFees = global.totalFees.plus(globalFeesDelta);
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
