import { newMockEvent } from "matchstick-as";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { FPMMBuy as FPMMBuyEvent } from "../generated/templates/FixedProductMarketMaker/FixedProductMarketMaker";
import { LogNewAnswer as LogNewAnswerEvent } from "../generated/Realitio/Realitio";
import { PayoutRedemption as PayoutRedemptionEvent } from "../generated/ConditionalTokens/ConditionalTokens";

export function createBuyEvent(
  buyer: Address,
  investment: BigInt,
  fee: BigInt,
  outcomeIndex: BigInt,
  fpmm: Address,
  timestamp: BigInt,
  logIndex: i32 = 0
): FPMMBuyEvent {
  let event = changetype<FPMMBuyEvent>(newMockEvent());
  event.address = fpmm;
  event.block.timestamp = timestamp;
  event.logIndex = BigInt.fromI32(logIndex);

  event.parameters = [
    new ethereum.EventParam("buyer", ethereum.Value.fromAddress(buyer)),
    new ethereum.EventParam("investmentAmount", ethereum.Value.fromUnsignedBigInt(investment)),
    new ethereum.EventParam("feeAmount", ethereum.Value.fromUnsignedBigInt(fee)),
    new ethereum.EventParam("outcomeIndex", ethereum.Value.fromUnsignedBigInt(outcomeIndex)),
  ];

  return event;
}

export function createNewAnswerEvent(questionId: Bytes, answer: Bytes, timestamp: BigInt): LogNewAnswerEvent {
  let event = changetype<LogNewAnswerEvent>(newMockEvent());
  event.block.timestamp = timestamp;

  event.parameters = [
    new ethereum.EventParam("answer", ethereum.Value.fromFixedBytes(answer)),
    new ethereum.EventParam("question_id", ethereum.Value.fromFixedBytes(questionId)),
    new ethereum.EventParam("history_hash", ethereum.Value.fromFixedBytes(Bytes.fromI32(0))),
    new ethereum.EventParam("user", ethereum.Value.fromAddress(Address.zero())),
    new ethereum.EventParam("bond", ethereum.Value.fromUnsignedBigInt(BigInt.zero())),
    new ethereum.EventParam("ts", ethereum.Value.fromUnsignedBigInt(timestamp)),
    new ethereum.EventParam("is_commitment", ethereum.Value.fromBoolean(false)),
  ];

  return event;
}

export function createPayoutRedemptionEvent(
  redeemer: Address,
  payout: BigInt,
  conditionId: Bytes,
  timestamp: BigInt
): PayoutRedemptionEvent {
  let event = changetype<PayoutRedemptionEvent>(newMockEvent());
  event.block.timestamp = timestamp;

  event.parameters = [
    new ethereum.EventParam("redeemer", ethereum.Value.fromAddress(redeemer)),
    new ethereum.EventParam("collateralToken", ethereum.Value.fromAddress(Address.zero())),
    new ethereum.EventParam("parentCollectionId", ethereum.Value.fromFixedBytes(Bytes.fromI32(0))),
    new ethereum.EventParam("conditionId", ethereum.Value.fromFixedBytes(conditionId)),
    new ethereum.EventParam("indexSets", ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(1)])),
    new ethereum.EventParam("payout", ethereum.Value.fromUnsignedBigInt(payout)),
  ];

  return event;
}
