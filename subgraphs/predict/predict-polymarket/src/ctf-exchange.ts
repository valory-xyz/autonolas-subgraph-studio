import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  OrderFilled as OrderFilledEvent,
  TokenRegistered as TokenRegisteredEvent,
} from "../generated/CTFExchange/CTFExchange";
import {
  Bet,
  Question,
  TokenRegistry,
  TraderAgent,
} from "../generated/schema";
import { getGlobal, updateTraderAgentActivity } from "./utils";

export function handleTokenRegistered(event: TokenRegisteredEvent): void {
  // Register Outcome 0 (Usually "No")
  let token0Id = Bytes.fromBigInt(event.params.token0);
  let registry0 = new TokenRegistry(token0Id);
  registry0.tokenId = event.params.token0;
  registry0.conditionId = event.params.conditionId;
  registry0.outcomeIndex = BigInt.fromI32(0);
  registry0.save();

  // Register Outcome 1 (Usually "Yes")
  let token1Id = Bytes.fromBigInt(event.params.token1);
  let registry1 = new TokenRegistry(token1Id);
  registry1.tokenId = event.params.token1;
  registry1.conditionId = event.params.conditionId;
  registry1.outcomeIndex = BigInt.fromI32(1);
  registry1.save();
}

export function handleOrderFilled(event: OrderFilledEvent): void {
  // 1. Identify if the taker is one of our TraderAgents
  let agentId = event.params.taker;
  let agent = TraderAgent.load(agentId);
  
  if (agent === null) return;

  // 2. Identify the Trade direction and quantities
  // takerAssetId == 0 means Taker gave USDC and received Tokens (BUYING)
  // makerAssetId == 0 means Maker gave USDC and Taker gave Tokens (SELLING)
  let isBuying = event.params.takerAssetId.isZero();
  
  // The amount of USDC (money) involved in the trade
  let usdcAmount = isBuying ? event.params.takerAmountFilled : event.params.makerAmountFilled;
  
  // The amount of Shares (tokens) involved in the trade
  let sharesAmount = isBuying ? event.params.makerAmountFilled : event.params.takerAmountFilled;
  
  // The token ID of the outcome being traded
  let outcomeTokenId = isBuying ? event.params.makerAssetId : event.params.takerAssetId;

  // 3. Lookup the outcome index from our Registry
  let tokenRegistry = TokenRegistry.load(Bytes.fromBigInt(outcomeTokenId));
  if (tokenRegistry === null) {
    log.warning("TokenRegistry missing for token {} in tx {}", [
      outcomeTokenId.toString(),
      event.transaction.hash.toHexString()
    ]);
    return;
  }

  // 4. Create the Bet entity
  let betId = event.transaction.hash.concat(Bytes.fromI32(event.logIndex.toI32()));
  let bet = new Bet(betId);
  bet.bettor = agent.id;
  bet.outcomeIndex = tokenRegistry.outcomeIndex;
  
  bet.amount = usdcAmount;     // USDC value
  bet.shares = sharesAmount;   // Token quantity

  bet.timestamp = event.block.timestamp;
  bet.countedInTotal = false;

  // 5. Link to the Question
  let question = Question.load(tokenRegistry.conditionId);
  if (question !== null) {
    bet.question = question.id;
  }
  bet.save();

  // 6. Update TraderAgent Statistics
  updateTraderAgentActivity(event.params.taker, event.block.timestamp);
  agent.totalBets += 1;
  agent.totalTraded = agent.totalTraded.plus(usdcAmount);
  agent.save();

  // 7. Update Global Statistics
  let global = getGlobal();
  global.totalBets += 1;
  global.totalTraded = global.totalTraded.plus(usdcAmount);
  global.save();
}