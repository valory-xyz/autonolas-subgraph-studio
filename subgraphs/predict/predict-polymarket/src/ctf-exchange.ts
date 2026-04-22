import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  OrderFilled as OrderFilledEvent,
  TokenRegistered as TokenRegisteredEvent,
} from "../generated/CTFExchange/CTFExchange";
import {
  Bet,
  Multisig,
  Question,
  TokenRegistry,
  TraderAgent,
} from "../generated/schema";
import {
  getDailyProfitStatistic,
  getGlobal,
  processTradeActivity,
} from "./utils";

export function handleTokenRegistered(event: TokenRegisteredEvent): void {
  // Register Outcome 0 (Usually "No")
  let token0Id = Bytes.fromByteArray(Bytes.fromBigInt(event.params.token0));

  // Check if we've already registered these tokens
  // The Polymarket CTFExchange uses a "bidirectional" registry logic
  // and registers two events with swapped tokenIds. We store only first pair.
  let existing = TokenRegistry.load(token0Id);
  if (existing != null) {
    return;
  }

  let registry0 = new TokenRegistry(token0Id);
  registry0.tokenId = event.params.token0;
  registry0.conditionId = event.params.conditionId;
  registry0.outcomeIndex = BigInt.fromI32(0);
  registry0.transactionHash = event.transaction.hash;
  registry0.save();

  // Register Outcome 1 (Usually "Yes")
  let token1Id = Bytes.fromByteArray(Bytes.fromBigInt(event.params.token1));
  let registry1 = new TokenRegistry(token1Id);
  registry1.tokenId = event.params.token1;
  registry1.conditionId = event.params.conditionId;
  registry1.outcomeIndex = BigInt.fromI32(1);
  registry1.transactionHash = event.transaction.hash;
  registry1.save();
}

export function handleOrderFilled(event: OrderFilledEvent): void {
  // 1. Filter by Multisig index — only Olas-registered multisigs pass.
  let maker = event.params.maker;
  let multisig = Multisig.load(maker);
  if (multisig === null) return;

  // 2. Lazy-create TraderAgent on first trade.
  let agent = TraderAgent.load(maker);
  if (agent === null) {
    agent = new TraderAgent(maker);
    agent.multisig = multisig.id;
    agent.serviceId = multisig.serviceId;
    agent.totalBets = 0;
    agent.totalTraded = BigInt.zero();
    agent.totalTradedSettled = BigInt.zero();
    agent.totalPayout = BigInt.zero();
    agent.totalExpectedPayout = BigInt.zero();
    agent.blockNumber = event.block.number;
    agent.blockTimestamp = event.block.timestamp;
    agent.transactionHash = event.transaction.hash;
    agent.save();

    multisig.traderAgent = agent.id;
    multisig.save();

    let global = getGlobal();
    global.totalTraderAgents += 1;
    global.save();
  }

  // 3. Identify the Trade direction and quantities
  // makerAssetId == 0 means Maker gave USDC and received Tokens (BUYING)
  // takerAssetId == 0 means Taker gave USDC and Maker gave Tokens (SELLING)
  let isBuying = event.params.makerAssetId.isZero();

  // For sells, amounts are NEGATIVE (omen convention):
  // - Negative amount = USDC received back
  // - Negative shares = tokens given away
  let usdcAmount = isBuying
    ? event.params.makerAmountFilled
    : BigInt.zero().minus(event.params.takerAmountFilled);

  let sharesAmount = isBuying
    ? event.params.takerAmountFilled
    : BigInt.zero().minus(event.params.makerAmountFilled);

  // The token ID of the outcome being traded
  let outcomeTokenId = isBuying
    ? event.params.takerAssetId
    : event.params.makerAssetId;

  // 4. Lookup the outcome index from our Registry
  let tokenRegistry = TokenRegistry.load(
    Bytes.fromByteArray(Bytes.fromBigInt(outcomeTokenId)),
  );
  if (tokenRegistry === null) {
    log.warning("TokenRegistry missing for token {} in tx {}", [
      outcomeTokenId.toString(),
      event.transaction.hash.toHexString(),
    ]);
    return;
  }

  // 5. Update Daily Stats
  let dailyStat = getDailyProfitStatistic(agent.id, event.block.timestamp);
  dailyStat.totalBets += 1;
  dailyStat.totalTraded = dailyStat.totalTraded.plus(usdcAmount);
  dailyStat.save();

  // 6. Initialize Bet
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

  let question = Question.load(tokenRegistry.conditionId);
  if (question !== null) {
    bet.question = question.id;
  }
  bet.save();

  // 7. Process Agent, Participant, and Global atomically
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
