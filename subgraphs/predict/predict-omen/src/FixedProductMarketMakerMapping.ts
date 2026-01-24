import { BigInt } from "@graphprotocol/graph-ts";
import { Bet, FixedProductMarketMakerCreation, TraderAgent } from "../generated/schema";
import {
  FPMMBuy as FPMMBuyEvent,
  FPMMSell as FPMMSellEvent,
} from "../generated/templates/FixedProductMarketMaker/FixedProductMarketMaker";
import {
  getDailyProfitStatistic,
  processTradeActivity,
} from "./utils";

export function handleBuy(event: FPMMBuyEvent): void {
  let fixedProductMarketMaker = FixedProductMarketMakerCreation.load(event.address);
  let traderAgent = TraderAgent.load(event.params.buyer);

  if (fixedProductMarketMaker !== null && traderAgent !== null) {
    let betId = event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString();
    let dailyStat = getDailyProfitStatistic(event.params.buyer, event.block.timestamp);

    // 1. Update Daily Stats
    dailyStat.totalBets += 1;
    dailyStat.totalTraded = dailyStat.totalTraded.plus(event.params.investmentAmount);
    dailyStat.totalFees = dailyStat.totalFees.plus(event.params.feeAmount);
    dailyStat.save();

    // 2. Process Agent, Participant, and Global
    // This ensures the participant exists before we save the bet
    processTradeActivity(
      traderAgent,
      event.address,
      betId,
      event.params.investmentAmount,
      event.params.feeAmount,
      event.block.timestamp,
      event.block.number,
      event.transaction.hash
    );

    // 3. Initialize and save Bet
    let bet = new Bet(betId);
    bet.bettor = event.params.buyer;
    bet.outcomeIndex = event.params.outcomeIndex;
    bet.amount = event.params.investmentAmount;
    bet.feeAmount = event.params.feeAmount;
    bet.timestamp = event.block.timestamp;
    bet.fixedProductMarketMaker = event.address;
    bet.dailyStatistic = dailyStat.id;
    bet.countedInTotal = false;
    bet.countedInProfit = false;
    bet.save();
  }
}

export function handleSell(event: FPMMSellEvent): void {
  let fixedProductMarketMaker = FixedProductMarketMakerCreation.load(event.address);
  let traderAgent = TraderAgent.load(event.params.seller);

  if (fixedProductMarketMaker !== null && traderAgent !== null) {
    let betId = event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString();
    let dailyStat = getDailyProfitStatistic(event.params.seller, event.block.timestamp);

    // Sells use negative investment amounts for volume tracking
    let negAmount = BigInt.zero().minus(event.params.returnAmount);

    // 1. Update Daily Stats
    dailyStat.totalBets += 1;
    dailyStat.totalTraded = dailyStat.totalTraded.plus(negAmount);
    dailyStat.totalFees = dailyStat.totalFees.plus(event.params.feeAmount);
    dailyStat.save();

    // 2. Process Agent, Participant, and Global atomically FIRST
    // This ensures the participant exists before we save the bet
    processTradeActivity(
      traderAgent,
      event.address,
      betId,
      negAmount,
      event.params.feeAmount,
      event.block.timestamp,
      event.block.number,
      event.transaction.hash
    );

    // 3. Initialize and save Bet AFTER participant is created
    let bet = new Bet(betId);
    bet.bettor = event.params.seller;
    bet.outcomeIndex = event.params.outcomeIndex;
    bet.amount = negAmount;
    bet.feeAmount = event.params.feeAmount;
    bet.timestamp = event.block.timestamp;
    bet.fixedProductMarketMaker = event.address;
    bet.dailyStatistic = dailyStat.id;
    bet.countedInTotal = false;
    bet.countedInProfit = false;
    bet.save();
  }
}
