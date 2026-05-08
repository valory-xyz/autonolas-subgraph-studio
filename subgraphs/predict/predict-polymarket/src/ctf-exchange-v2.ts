import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import { OrderFilled as OrderFilledV2Event } from "../generated/CTFExchangeV2/CTFExchangeV2";
import { Bet, Question, TokenRegistry, TraderAgent } from "../generated/schema";
import { getDailyProfitStatistic, processTradeActivity } from "./utils";

export function handleOrderFilledV2(event: OrderFilledV2Event): void {
  // 1. Identify if the maker is one of our TraderAgents
  let agent = TraderAgent.load(event.params.maker);
  if (agent === null) return;

  // 2. Direction: side 0 = BUY, 1 = SELL (v2 is explicit)
  //    BUY  — maker pays collateral (makerAmountFilled), receives shares (takerAmountFilled)
  //    SELL — maker gives shares (makerAmountFilled), receives collateral (takerAmountFilled)
  //
  //    Sells use NEGATIVE amounts/shares (omen convention, matches v1 handler).
  let isBuying = event.params.side == 0;

  let usdcAmount = isBuying
    ? event.params.makerAmountFilled
    : BigInt.zero().minus(event.params.takerAmountFilled);

  let sharesAmount = isBuying
    ? event.params.takerAmountFilled
    : BigInt.zero().minus(event.params.makerAmountFilled);

  // 3. Lookup the outcome index from TokenRegistry (populated at
  //    ConditionPreparation time for v2, or via v1 TokenRegistered for v1-era).
  let tokenIdBytes = Bytes.fromByteArray(
    Bytes.fromBigInt(event.params.tokenId),
  );
  let tokenRegistry = TokenRegistry.load(tokenIdBytes);
  if (tokenRegistry === null) {
    log.warning("TokenRegistry missing for token {} in tx {}", [
      event.params.tokenId.toString(),
      event.transaction.hash.toHexString(),
    ]);
    return;
  }

  // 4. Update Daily Stats
  let dailyStat = getDailyProfitStatistic(agent.id, event.block.timestamp);
  dailyStat.totalBets += 1;
  dailyStat.totalTraded = dailyStat.totalTraded.plus(usdcAmount);
  dailyStat.save();

  // 5. Create Bet
  let betId = event.transaction.hash.concat(
    Bytes.fromI32(event.logIndex.toI32()),
  );
  let bet = new Bet(betId);
  bet.bettor = agent.id;
  bet.outcomeIndex = tokenRegistry.outcomeIndex;
  bet.amount = usdcAmount;
  bet.shares = sharesAmount;
  bet.isBuy = isBuying;
  bet.blockTimestamp = event.block.timestamp;
  bet.transactionHash = event.transaction.hash;
  bet.dailyStatistic = dailyStat.id;
  bet.countedInTotal = false;
  bet.countedInProfit = false;
  bet.builder = event.params.builder;
  bet.metadata = event.params.metadata;

  let question = Question.load(tokenRegistry.conditionId);
  if (question !== null) {
    bet.question = question.id;
  }
  bet.save();

  // 6. Process Agent, Participant, and Global atomically
  processTradeActivity(
    agent,
    tokenRegistry.conditionId,
    betId,
    usdcAmount,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    tokenRegistry.outcomeIndex,
    sharesAmount,
  );
}
