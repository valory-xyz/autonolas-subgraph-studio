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
} from "../generated/schema";
import { CREATOR_ADDRESSES, INVALID_ANSWER_HEX } from "./constants";
import { addProfitParticipant, bytesToBigInt, getDailyProfitStatistic, getGlobal } from "./utils";

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
  if (event.params.answer.toHexString() === INVALID_ANSWER_HEX) {
    return;
  }

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

  if (id !== null) {
    let fpmm = FixedProductMarketMakerCreation.load(id);

    if (fpmm !== null) {
      fpmm.currentAnswer = event.params.answer;
      fpmm.currentAnswerTimestamp = event.block.timestamp;
      fpmm.save();

      // Pre-compute values outside the loop to avoid redundant calculations
      let answerBigInt = bytesToBigInt(event.params.answer);
      let global = getGlobal();
      let globalTradedDelta = BigInt.zero();
      let globalFeesDelta = BigInt.zero();
      let fpmmIdHex = fpmm.id.toHexString();

      let bets = fpmm.bets.load();
      for (let i = 0; i < bets.length; i++) {
        let bet = bets[i];
        if (bet === null) continue;
        
        // use boolean to track if bet was modified to save it in the end
        // needed for optimization in case of too many bets
        let betModified = false;
        
        if (bet.countedInTotal === false) {
          let agent = TraderAgent.load(bet.bettor);
          if (agent !== null) {
            // Update global trader agent statistic
            agent.totalTraded = agent.totalTraded.plus(bet.amount);
            agent.totalFees = agent.totalFees.plus(bet.feeAmount);
            agent.save();

            // Update market participant statistic
            let participantId = bet.bettor.toHexString() + "_" + fpmmIdHex;
            let participant = MarketParticipant.load(participantId);
            if (participant != null) {
              participant.totalTraded = participant.totalTraded.plus(bet.amount);
              participant.totalFees = participant.totalFees.plus(bet.feeAmount);
              participant.save();
            }

            bet.countedInTotal = true;
            betModified = true;

            // Accumulate global deltas
            globalTradedDelta = globalTradedDelta.plus(bet.amount);
            globalFeesDelta = globalFeesDelta.plus(bet.feeAmount);
          }
        }

        // Update daily profit statistic if answer is incorrect
        if (bet.countedInProfit === false) {
          if (!bet.outcomeIndex.equals(answerBigInt)) {
            let dailyStat = getDailyProfitStatistic(bet.bettor, event.block.timestamp);
            let lossAmount = bet.amount.plus(bet.feeAmount);
            dailyStat.dailyProfit = dailyStat.dailyProfit.minus(lossAmount);
            addProfitParticipant(dailyStat, fpmm.id);
            bet.countedInProfit = true;
            betModified = true;
            dailyStat.save();
          }
        }

        // Save bet once at the end if it was modified
        if (betModified) {
          bet.save();
        }
      }

      // Update global statistics once at the end
      if (!globalTradedDelta.equals(BigInt.zero()) || !globalFeesDelta.equals(BigInt.zero())) {
        global.totalTraded = global.totalTraded.plus(globalTradedDelta);
        global.totalFees = global.totalFees.plus(globalFeesDelta);
        global.save();
      }
    }
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
