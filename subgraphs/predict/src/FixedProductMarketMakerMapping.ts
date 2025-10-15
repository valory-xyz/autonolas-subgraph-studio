import { BigInt } from "@graphprotocol/graph-ts";
import {
  Bet,
  FixedProductMarketMakerCreation,
  TraderAgent,
} from "../generated/schema";
import {
  FPMMBuy as FPMMBuyEvent,
  FPMMSell as FPMMSellEvent,
} from "../generated/templates/FixedProductMarketMaker/FixedProductMarketMaker";
import { updateTraderAgentActivity } from "./utils";

export function handleBuy(event: FPMMBuyEvent): void {
  let bet = new Bet(
    event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString()
  );
  let fixedProductMarketMaker = FixedProductMarketMakerCreation.load(
    event.address
  );
  let traderAgent = TraderAgent.load(event.params.buyer);

  if (fixedProductMarketMaker !== null && traderAgent !== null) {
    updateTraderAgentActivity(event.params.buyer, event.block.timestamp);

    bet.bettor = event.params.buyer;
    bet.outcomeIndex = event.params.outcomeIndex;
    bet.amount = event.params.investmentAmount;
    bet.feeAmount = event.params.feeAmount;
    bet.timestamp = event.block.timestamp;
    bet.fixedProductMarketMaker = event.address;
    bet.countedInTotal = false;
    bet.save();
  }
}

export function handleSell(event: FPMMSellEvent): void {
  let bet = new Bet(
    event.transaction.hash.concatI32(event.logIndex.toI32()).toHexString()
  );
  let fixedProductMarketMaker = FixedProductMarketMakerCreation.load(
    event.address
  );
  let traderAgent = TraderAgent.load(event.params.seller);

  if (fixedProductMarketMaker !== null && traderAgent !== null) {
    updateTraderAgentActivity(event.params.seller, event.block.timestamp);

    bet.bettor = event.params.seller;
    bet.outcomeIndex = event.params.outcomeIndex;
    bet.amount = BigInt.zero().minus(event.params.returnAmount);
    bet.feeAmount = event.params.feeAmount;
    bet.timestamp = event.block.timestamp;
    bet.fixedProductMarketMaker = event.address;
    bet.countedInTotal = false;
    bet.save();
  }
}
