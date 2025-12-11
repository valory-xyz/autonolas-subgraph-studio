import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Global, TraderAgent, MarketParticipant } from "../generated/schema";

export function updateTraderAgentActivity(
  address: Address,
  blockTimestamp: BigInt
): void {
  let agent = TraderAgent.load(address);
  if (agent !== null) {
    if (agent.firstParticipation === null) {
      agent.firstParticipation = blockTimestamp;
      let global = getGlobal();
      global.totalActiveTraderAgents += 1;
      global.save();
    }

    agent.totalBets += 1;
    agent.lastActive = blockTimestamp;
    agent.save();
  }
}

export function updateTraderAgentPayout(
  address: Address,
  payout: BigInt
): void {
  let agent = TraderAgent.load(address);
  if (agent !== null) {
    agent.totalPayout = agent.totalPayout.plus(payout);
    agent.save();
  }
}

export function updateMarketParticipantActivity(
  trader: Address, market: Address, betId: string, blockTimestamp: BigInt, blockNumber: BigInt, txHash: Bytes
): void {
  let participantId = trader.toHexString() + "_" + market.toHexString();
  let participant = MarketParticipant.load(participantId);
  if (participant == null) {
    participant = new MarketParticipant(participantId);
    participant.traderAgent = trader;
    participant.fixedProductMarketMaker = market;
    participant.totalBets = 0;
    participant.totalTraded = BigInt.zero();
    participant.totalPayout = BigInt.zero();
    participant.totalFees = BigInt.zero();
    participant.createdAt = blockTimestamp;
    participant.bets = [];
  }
  let bets = participant.bets;
  bets.push(betId);
  participant.bets = bets;
  participant.totalBets += 1;
  participant.blockTimestamp = blockTimestamp;
  participant.blockNumber = blockNumber;
  participant.transactionHash = txHash;
  participant.save();
}

export function updateMarketParticipantPayout(
  trader: Address, market: Bytes, payout: BigInt
): void {
  let participantId = trader.toHexString() + "_" + market.toHexString();
  let participant = MarketParticipant.load(participantId);
  if (participant != null) {
    participant.totalPayout = participant.totalPayout.plus(payout);
    participant.save();
  }
}

export function getGlobal(): Global {
  let global = Global.load("");
  if (global == null) {
    global = new Global("");
    global.totalTraderAgents = 0;
    global.totalActiveTraderAgents = 0;
    global.totalBets = 0;
    global.totalTraded = BigInt.zero();
    global.totalFees = BigInt.zero();
    global.totalPayout = BigInt.zero();
  }
  return global as Global;
}

export function incrementGlobalTotalBets(): void {
  let global = getGlobal();
  global.totalBets += 1;
  global.save();
}

export function updateGlobalPayout(payout: BigInt): void {
  let global = getGlobal();
  global.totalPayout = global.totalPayout.plus(payout);
  global.save();
}