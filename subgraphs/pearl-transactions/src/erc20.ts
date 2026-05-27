import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Transfer as TransferEvent } from "../generated/OLAS/ERC20";
import { FundsMovement } from "../generated/schema";
import { SOURCE_RAW_TRANSFER } from "./constants";
import {
  addToAgentFundingEvent,
  classifyTransfer,
  fundsMovementId,
  getOrCreateAgentFundingEvent,
  markSetupTransferSeen,
  upsertTokenBalance,
} from "./utils";

// handleErc20Transfer — generic ERC-20 Transfer handler shared by
// every ERC-20 data source (OLAS + WrappedNative in Phase 2a, plus
// USDC / USDC.e in Phase 2b once those ship). The `token` field on
// the resulting row comes from `event.address`, so the same handler
// works regardless of which token contract fired the event.
//
// Filters to transfers where at least one side is a tracked address
// (Master / Agent Safe / EOA / staking proxy / SRTU), classifies the
// hop via classifyTransfer, and emits a FundsMovement(source=RAW_TRANSFER)
// row.
//
// Same-tx Master → Agent constituent transfers across multiple tokens
// (or Agent Safe + Agent EOA together) group under a shared
// AgentFundingEvent per (txHash, masterSafe, service); each row links
// via FundsMovement.agentFundingEvent.
export function handleErc20Transfer(event: TransferEvent): void {
  const from = event.params.from;
  const to = event.params.to;
  const amount = event.params.value;
  const token = event.address;

  const classification = classifyTransfer(from, to, null);
  if (classification === null) {
    return;
  }

  const row = new FundsMovement(fundsMovementId(event));
  if (classification.service !== null) {
    row.service = classification.service!;
  }
  if (classification.masterSafeId !== null) {
    row.masterSafe = classification.masterSafeId!;
  }
  if (classification.agentSafeId !== null) {
    row.agentSafe = classification.agentSafeId!;
  }
  row.category = classification.category;
  row.source = SOURCE_RAW_TRANSFER;
  row.token = token;
  row.amount = amount;
  row.from = from;
  row.to = to;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;

  // SAFE_SETUP_TRANSFER → flip the MasterSafe flag so subsequent
  // hops are MASTER_FUNDING_IN.
  if (
    classification.category == "SAFE_SETUP_TRANSFER" &&
    classification.masterSafeId !== null
  ) {
    markSetupTransferSeen(classification.masterSafeId!);
  }

  // MASTER_TO_AGENT → group under AgentFundingEvent.
  if (
    classification.category == "MASTER_TO_AGENT" &&
    classification.masterSafeId !== null &&
    classification.service !== null
  ) {
    const afe = getOrCreateAgentFundingEvent(
      event.transaction.hash,
      classification.masterSafeId!,
      classification.service!,
      event
    );
    row.agentFundingEvent = afe.id;
    addToAgentFundingEvent(afe, amount, /* isNative = */ false);
  }

  row.save();

  // Update TokenBalance for both sides if they're tracked.
  if (
    classification.category == "SAFE_SETUP_TRANSFER" ||
    classification.category == "MASTER_FUNDING_IN" ||
    classification.category == "AGENT_TO_MASTER" ||
    classification.category == "APP_TO_AGENT" ||
    classification.category == "STAKING_REWARD_CLAIM"
  ) {
    // "to" is the tracked safe receiving funds.
    upsertTokenBalance(to, token, amount, event, /* isDelta = */ true);
  }
  if (
    classification.category == "MASTER_WITHDRAWAL" ||
    classification.category == "MASTER_TO_AGENT" ||
    classification.category == "AGENT_TO_APP" ||
    classification.category == "AGENT_TO_MASTER"
  ) {
    // "from" sends funds; bump down.
    upsertTokenBalance(
      from,
      token,
      amount.neg(),
      event,
      /* isDelta = */ true
    );
  }
  // MASTER_TO_AGENT updates both sides.
  if (classification.category == "MASTER_TO_AGENT") {
    upsertTokenBalance(to, token, amount, event, /* isDelta = */ true);
  }
  // AGENT_TO_MASTER also updates Master side; handled above for "to".
}
