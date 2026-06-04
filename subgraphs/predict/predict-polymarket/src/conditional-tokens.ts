import {
  ConditionPreparation as ConditionPreparationEvent,
  PayoutRedemption as PayoutRedemptionEvent,
  ConditionalTokens,
} from "../generated/ConditionalTokens/ConditionalTokens";
import {
  QuestionIdToConditionId,
  TokenRegistry,
} from "../generated/schema";
import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import { processRedemption } from "./utils";
import {
  NEG_RISK_ADAPTER_ADDRESS,
  PAYOUT_SOURCE_CONDITIONAL_TOKENS,
  USDC_E_ADDRESS,
  ZERO_BYTES32,
} from "./constants";

function registerOutcomeToken(
  ctf: ConditionalTokens,
  conditionId: Bytes,
  collateral: Address,
  indexSet: i32,
  outcomeIndex: i32,
  txHash: Bytes,
): void {
  let collectionIdCall = ctf.try_getCollectionId(
    ZERO_BYTES32,
    conditionId,
    BigInt.fromI32(indexSet),
  );
  if (collectionIdCall.reverted) {
    log.warning(
      "getCollectionId reverted for condition {} indexSet {}",
      [conditionId.toHexString(), indexSet.toString()],
    );
    return;
  }

  let positionIdCall = ctf.try_getPositionId(
    collateral,
    collectionIdCall.value,
  );
  if (positionIdCall.reverted) {
    log.warning(
      "getPositionId reverted for condition {} indexSet {}",
      [conditionId.toHexString(), indexSet.toString()],
    );
    return;
  }

  let tokenId = positionIdCall.value;
  let tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId));

  if (TokenRegistry.load(tokenIdBytes) != null) return;

  let registry = new TokenRegistry(tokenIdBytes);
  registry.tokenId = tokenId;
  registry.conditionId = conditionId;
  registry.outcomeIndex = BigInt.fromI32(outcomeIndex);
  registry.transactionHash = txHash;
  registry.save();
}

export function handleConditionPreparation(
  event: ConditionPreparationEvent,
): void {
  // we don't handle conditions with more than 2 outcomes
  if (event.params.outcomeSlotCount.toI32() != 2) {
    return;
  }

  let bridge = QuestionIdToConditionId.load(event.params.questionId);

  if (bridge !== null) {
    // NOTE: this early-return also gates the v2 TokenRegistry derivation below.
    // For v2-exclusive markets with questionId reuse, the second conditionId's
    // tokens won't be derived and handleOrderFilledV2 will drop trades via the
    // TokenRegistry.load === null warning path. v1-era repeats are covered by
    // handleTokenRegistered.
    log.warning(
      "REPETITIVE_QUESTION_ID detected: {} | Existing ConditionId: {} | New ConditionId: {} | Txn Hash: {}",
      [
        event.params.questionId.toHexString(),
        bridge.conditionId.toHexString(),
        event.params.conditionId.toHexString(),
        event.transaction.hash.toHexString(),
      ],
    );

    return;
  }

  let entity = new QuestionIdToConditionId(event.params.questionId);
  entity.conditionId = event.params.conditionId;
  entity.oracle = event.params.oracle;
  entity.transactionHash = event.transaction.hash;
  entity.save();

  // v2 exchanges do not emit TokenRegistered — derive outcome tokenIds here
  // so MarketParticipant lookups work for post-cutover markets. Idempotent:
  // if TokenRegistry row already exists (v1 handler path), we skip.
  let isNegRisk = event.params.oracle.equals(NEG_RISK_ADAPTER_ADDRESS);
  let collateral = isNegRisk ? NEG_RISK_ADAPTER_ADDRESS : USDC_E_ADDRESS;

  let ctf = ConditionalTokens.bind(event.address);
  registerOutcomeToken(
    ctf,
    event.params.conditionId,
    collateral,
    1,
    0,
    event.transaction.hash,
  );
  registerOutcomeToken(
    ctf,
    event.params.conditionId,
    collateral,
    2,
    1,
    event.transaction.hash,
  );
}

export function handlePayoutRedemption(event: PayoutRedemptionEvent): void {
  processRedemption(
    event.params.redeemer,
    event.params.conditionId,
    event.params.payout,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    event.logIndex.toI32(),
    PAYOUT_SOURCE_CONDITIONAL_TOKENS,
  );
}
