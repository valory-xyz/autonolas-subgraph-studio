import { newMockEvent } from "matchstick-as";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { OrderFilled as OrderFilledEvent, TokenRegistered as TokenRegisteredEvent } from "../generated/CTFExchange/CTFExchange";
import { QuestionResolved as QuestionResolvedEvent } from "../generated/OptimisticOracleV3/OptimisticOracleV3";
import { PayoutRedemption as PayoutRedemptionEvent } from "../generated/ConditionalTokens/ConditionalTokens";

/**
 * Creates a TokenRegistered event for registering outcome tokens
 * @param token0 The token ID for outcome 0
 * @param token1 The token ID for outcome 1
 * @param conditionId The condition/market ID
 */
export function createTokenRegisteredEvent(
  token0: BigInt,
  token1: BigInt,
  conditionId: Bytes
): TokenRegisteredEvent {
  let event = changetype<TokenRegisteredEvent>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(new ethereum.EventParam("token0", ethereum.Value.fromUnsignedBigInt(token0)));
  event.parameters.push(new ethereum.EventParam("token1", ethereum.Value.fromUnsignedBigInt(token1)));
  event.parameters.push(new ethereum.EventParam("conditionId", ethereum.Value.fromFixedBytes(conditionId)));

  return event;
}

/**
 * Creates an OrderFilled event for a trader buying outcome tokens
 * @param maker The trader agent address
 * @param usdcAmount The USDC amount spent
 * @param sharesAmount The shares/tokens received
 * @param outcomeTokenId The token ID of the outcome being traded
 * @param timestamp The block timestamp
 * @param logIndex Optional log index for unique bet IDs
 */
export function createOrderFilledEvent(
  maker: Address,
  usdcAmount: BigInt,
  sharesAmount: BigInt,
  outcomeTokenId: BigInt,
  timestamp: BigInt,
  logIndex: i32 = 0
): OrderFilledEvent {
  let event = changetype<OrderFilledEvent>(newMockEvent());
  event.block.timestamp = timestamp;
  event.block.number = BigInt.fromI32(1000);
  event.logIndex = BigInt.fromI32(logIndex);
  event.transaction.hash = Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234");

  // For buying: maker gives USDC (assetId=0), receives tokens (assetId=outcomeTokenId)
  event.parameters = [
    new ethereum.EventParam("orderHash", ethereum.Value.fromFixedBytes(Bytes.fromHexString("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"))),
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(maker)),
    new ethereum.EventParam("taker", ethereum.Value.fromAddress(Address.fromString("0x9999999999999999999999999999999999999999"))),
    new ethereum.EventParam("makerAssetId", ethereum.Value.fromUnsignedBigInt(BigInt.zero())),
    new ethereum.EventParam("takerAssetId", ethereum.Value.fromUnsignedBigInt(outcomeTokenId)),
    new ethereum.EventParam("makerAmountFilled", ethereum.Value.fromUnsignedBigInt(usdcAmount)),
    new ethereum.EventParam("takerAmountFilled", ethereum.Value.fromUnsignedBigInt(sharesAmount)),
    new ethereum.EventParam("fee", ethereum.Value.fromUnsignedBigInt(BigInt.zero())),
  ];

  return event;
}

/**
 * Creates a QuestionResolved event from UMA oracle
 * @param questionId The question ID being resolved
 * @param payouts Array of payout values for each outcome
 * @param settledPrice The settled price
 * @param timestamp The block timestamp
 */
export function createQuestionResolvedEvent(
  questionId: Bytes,
  payouts: BigInt[],
  settledPrice: BigInt,
  timestamp: BigInt
): QuestionResolvedEvent {
  let event = changetype<QuestionResolvedEvent>(newMockEvent());
  event.block.timestamp = timestamp;
  
  // Create the array value correctly for AssemblyScript
  let payoutsValue = ethereum.Value.fromUnsignedBigIntArray(payouts);

  event.parameters = [
    new ethereum.EventParam("questionID", ethereum.Value.fromFixedBytes(questionId)),
    new ethereum.EventParam("settledPrice", ethereum.Value.fromSignedBigInt(settledPrice)),
    new ethereum.EventParam("payouts", payoutsValue),
  ];

  return event;
}

/**
 * Creates a PayoutRedemption event for claiming winnings
 * @param redeemer The agent redeeming the payout
 * @param payout The payout amount
 * @param conditionId The condition/market ID
 * @param timestamp The block timestamp
 */
export function createPayoutRedemptionEvent(
  redeemer: Address,
  payout: BigInt,
  conditionId: Bytes,
  timestamp: BigInt
): PayoutRedemptionEvent {
  let event = changetype<PayoutRedemptionEvent>(newMockEvent());
  event.block.timestamp = timestamp;
  event.block.number = BigInt.fromI32(1000);

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
