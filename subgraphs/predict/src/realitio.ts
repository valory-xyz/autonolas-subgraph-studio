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

      let bets = fpmm.bets.load();
      for (let i = 0; i < bets.length; i++) {
        let bet = bets[i];
        if (bet === null) return;

        if (bet.countedInTotal === false) {
          let agent = TraderAgent.load(bet.bettor);
          if (agent !== null) {
            // Update global trader agent statistic
            agent.totalTraded = agent.totalTraded.plus(bet.amount);
            agent.totalFees = agent.totalFees.plus(bet.feeAmount);
            agent.save();

            // Update market participant statistic ()
            let participantId = bet.bettor.toHexString() + "_" + fpmm.id.toHexString();
            let participant = MarketParticipant.load(participantId);
            if (participant != null) {
              participant.totalTraded = participant.totalTraded.plus(bet.amount);
              participant.totalFees = participant.totalFees.plus(bet.feeAmount);
              participant.save();
            }

            bet.countedInTotal = true;
            bet.save();

            // Update global statistic across all agents
            let global = getGlobal();
            global.totalTraded = global.totalTraded.plus(bet.amount);
            global.totalFees = global.totalFees.plus(bet.feeAmount);
            global.save();
          }
        }

        // Update daily profit statistic if answer is incorrect
        let answerBigInt = bytesToBigInt(event.params.answer);
        if (bet.outcomeIndex != answerBigInt && bet.countedInProfit === false) {
          let dailyStat = getDailyProfitStatistic(bet.bettor, event.block.timestamp);

          let lossAmount = bet.amount.plus(bet.feeAmount);
          dailyStat.dailyProfit = dailyStat.dailyProfit.minus(lossAmount);
          addProfitParticipant(dailyStat, fpmm.id);
          bet.countedInProfit = true;
          bet.save();
          dailyStat.save();
        }
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
