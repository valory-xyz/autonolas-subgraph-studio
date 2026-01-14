import { BigInt } from "@graphprotocol/graph-ts";
import { Bet, FixedProductMarketMakerCreation, TraderAgent } from "../generated/schema";
import {
  FPMMBuy as FPMMBuyEvent,
  FPMMSell as FPMMSellEvent,
} from "../generated/templates/FixedProductMarketMaker/FixedProductMarketMaker";
import {
  updateTraderAgentActivity,
  updateMarketParticipantActivity,
  incrementGlobalTotalBets,
  getDailyProfitStatistic,
} from "./utils";

export function handleBuy(event: FPMMBuyEvent): void {
  let betId = event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString();
  let bet = new Bet(betId);
  let fixedProductMarketMaker = FixedProductMarketMakerCreation.load(event.address);
  let traderAgent = TraderAgent.load(event.params.buyer);

  if (fixedProductMarketMaker !== null && traderAgent !== null) {
    // Update daily profit statistic
    let dailyStat = getDailyProfitStatistic(event.params.buyer, event.block.timestamp);

    dailyStat.totalBets += 1;
    dailyStat.totalTraded = dailyStat.totalTraded.plus(event.params.investmentAmount);
    dailyStat.totalFees = dailyStat.totalFees.plus(event.params.feeAmount);
    dailyStat.save();

    // Update bet
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

    // Update agent, agent-market and global statistics
    updateTraderAgentActivity(event.params.buyer, event.block.timestamp);
    updateMarketParticipantActivity(
      event.params.buyer,
      event.address,
      betId,
      event.block.timestamp,
      event.block.number,
      event.transaction.hash
    );
    incrementGlobalTotalBets();
  }
}

export function handleSell(event: FPMMSellEvent): void {
  let betId = event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString();
  let bet = new Bet(betId);
  let fixedProductMarketMaker = FixedProductMarketMakerCreation.load(event.address);
  let traderAgent = TraderAgent.load(event.params.seller);

  if (fixedProductMarketMaker !== null && traderAgent !== null) {
    // Update daily profit statistic
    let dailyStat = getDailyProfitStatistic(event.params.seller, event.block.timestamp);

    dailyStat.totalBets += 1;
    dailyStat.totalTraded = dailyStat.totalTraded.minus(event.params.returnAmount);
    dailyStat.totalFees = dailyStat.totalFees.plus(event.params.feeAmount);
    dailyStat.save();

    // Update bet
    bet.bettor = event.params.seller;
    bet.outcomeIndex = event.params.outcomeIndex;
    bet.amount = BigInt.zero().minus(event.params.returnAmount);
    bet.feeAmount = event.params.feeAmount;
    bet.timestamp = event.block.timestamp;
    bet.fixedProductMarketMaker = event.address;
    bet.dailyStatistic = dailyStat.id;
    bet.countedInTotal = false;
    bet.countedInProfit = false;
    bet.save();

    // Update agent, agent-market and global statistics
    updateTraderAgentActivity(event.params.seller, event.block.timestamp);
    updateMarketParticipantActivity(
      event.params.seller,
      event.address,
      betId,
      event.block.timestamp,
      event.block.number,
      event.transaction.hash
    );
    incrementGlobalTotalBets();
  }
}
