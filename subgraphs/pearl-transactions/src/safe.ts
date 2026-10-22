import { BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
import {
  AddedOwner as AddedOwnerEvent,
  ChangedThreshold as ChangedThresholdEvent,
  ExecutionFromModuleSuccess as ExecutionFromModuleSuccessEvent,
  ExecutionSuccess as ExecutionSuccessEvent,
  RemovedOwner as RemovedOwnerEvent,
  SafeReceived as SafeReceivedEvent,
} from "../generated/templates/Safe/GnosisSafe";
import { FundsMovement, MasterSafe, TrackedAddress } from "../generated/schema";
import {
  CATEGORY_AGENT_SAFE_TO_AGENT_EOA,
  CATEGORY_MASTER_FUNDING_IN,
  CATEGORY_MASTER_TO_AGENT,
  CATEGORY_SAFE_SETUP_TRANSFER,
  ROLE_AGENT,
  SOURCE_RAW_TRANSFER,
  SOURCE_SEMANTIC,
} from "./constants";
import {
  addToAgentFundingEvent,
  classifyTransfer,
  fundsMovementId,
  getOrCreateAgentFundingEvent,
  markSetupTransferSeen,
} from "./utils";

// handleSafeReceived — native coin inbound. Reliable: the event
// fires for any plain native transfer that lands on the Safe. Same
// classification engine as the OLAS handler; `token` is null since
// the asset is the chain's native coin.
export function handleSafeReceived(event: SafeReceivedEvent): void {
  const from = event.params.sender;
  const to = event.address;
  const amount = event.params.value;

  const classification = classifyTransfer(from, to);
  if (classification === null) return;

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
  // token = null (native)
  row.amount = amount;
  row.from = from;
  row.to = to;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;

  if (
    classification.category == CATEGORY_SAFE_SETUP_TRANSFER &&
    classification.masterSafeId !== null
  ) {
    markSetupTransferSeen(classification.masterSafeId!);
  }
  if (
    classification.category == CATEGORY_MASTER_TO_AGENT &&
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
    addToAgentFundingEvent(afe, amount, /* isNative = */ true);
  }

  row.save();
}

// Selector of execTransaction(address,uint256,bytes,uint8,uint256,uint256,
// uint256,address,address,bytes).
const EXEC_TRANSACTION_SELECTOR: u8[] = [0x6a, 0x76, 0x12, 0x02];
const EXEC_TRANSACTION_ARGS =
  "(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)";
// Calldata args are the tuple's body; ethereum.decode reads a dynamic tuple
// as offset + body, so the offset word is prepended before decoding.
const TUPLE_OFFSET = Bytes.fromHexString(
  "0x0000000000000000000000000000000000000000000000000000000000000020"
);

function hasExecTransactionSelector(input: Bytes): boolean {
  if (input.length < 4) return false;
  for (let i = 0; i < 4; i++) {
    if (input[i] != EXEC_TRANSACTION_SELECTOR[i]) return false;
  }
  return true;
}

// handleSafeExecutionSuccess — native top-up Agent Safe → its own Agent
// Signer (AGENT_SAFE_TO_AGENT_EOA). ExecutionSuccess carries no amount or
// recipient, so they come from the outer tx: it must call the emitting Safe
// directly with one plain CALL, no data, value > 0, paying the tx sender.
// The Agent Signer submits its own Safe txs, so a payee equal to the sender
// is taken to be the Agent Signer (the signer is not a tracked address).
// Relayed or module executions are not decoded, and every other native
// outflow stays unindexed.
//
// Fires on every execution of every Safe sharing the template, so every
// shape check runs before the single store load.
export function handleSafeExecutionSuccess(
  event: ExecutionSuccessEvent
): void {
  const txTo = event.transaction.to;
  if (txTo === null || !txTo.equals(event.address)) return;

  const input = event.transaction.input;
  if (!hasExecTransactionSelector(input)) return;

  const decoded = ethereum.decode(
    EXEC_TRANSACTION_ARGS,
    TUPLE_OFFSET.concat(Bytes.fromUint8Array(input.subarray(4)))
  );
  if (decoded === null) {
    log.warning(
      "Safe {} execTransaction calldata not decodable (tx={}); skipping",
      [event.address.toHexString(), event.transaction.hash.toHexString()]
    );
    return;
  }
  const args = decoded.toTuple();

  const operation = args[3].toBigInt();
  if (!operation.isZero()) return;
  if (args[2].toBytes().length != 0) return;
  const value = args[1].toBigInt();
  if (value.le(BigInt.zero())) return;
  const recipient = args[0].toAddress();
  if (!recipient.equals(event.transaction.from)) return;

  const tracked = TrackedAddress.load(event.address);
  if (tracked === null || tracked.role != ROLE_AGENT) return;

  const row = new FundsMovement(fundsMovementId(event));
  if (tracked.service !== null) {
    row.service = tracked.service!;
  }
  if (tracked.masterSafe !== null) {
    row.masterSafe = tracked.masterSafe!;
  }
  row.agentSafe = tracked.id;
  row.category = CATEGORY_AGENT_SAFE_TO_AGENT_EOA;
  row.source = SOURCE_SEMANTIC;
  // token = null (native); no TokenBalance for native.
  row.amount = value;
  row.from = event.address;
  row.to = recipient;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();
}

// handleSafeExecutionFromModuleSuccess — intentional no-op: a module
// execution carries its call in the module's own calldata, not the outer
// tx. Deliberately NO store access: it fires on every module execution of
// every Safe sharing the template.
export function handleSafeExecutionFromModuleSuccess(
  event: ExecutionFromModuleSuccessEvent
): void {
  // no-op (see above)
}

// handleSafeAddedOwner / handleSafeRemovedOwner /
// handleSafeChangedThreshold — keep MasterSafe.owners / masterEoa /
// threshold current after first sighting. We only update Master
// Safes (Agent Safe owner lists are out of scope; their signers are
// indexed via Service.operators).
export function handleSafeAddedOwner(event: AddedOwnerEvent): void {
  const masterSafe = MasterSafe.load(event.address);
  if (masterSafe == null) return;
  const owners = masterSafe.owners;
  const newOwner: Bytes = event.params.owner;
  // Dedupe (defensive).
  for (let i = 0; i < owners.length; i++) {
    if (owners[i].equals(newOwner)) return;
  }
  owners.push(newOwner);
  masterSafe.owners = owners;
  masterSafe.lastActivityTimestamp = event.block.timestamp;
  masterSafe.save();
}

export function handleSafeRemovedOwner(event: RemovedOwnerEvent): void {
  const masterSafe = MasterSafe.load(event.address);
  if (masterSafe == null) return;
  const owners = masterSafe.owners;
  const removed: Bytes = event.params.owner;
  const filtered: Bytes[] = [];
  for (let i = 0; i < owners.length; i++) {
    if (!owners[i].equals(removed)) filtered.push(owners[i]);
  }
  masterSafe.owners = filtered;
  // If the removed owner was masterEoa (owners[0]), promote next
  // signer. Pearl's onboarding makes the Master EOA owners[0] and
  // does not rotate it in normal operation, so this is defensive.
  if (filtered.length > 0 && masterSafe.masterEoa.equals(removed)) {
    masterSafe.masterEoa = filtered[0];
  }
  masterSafe.lastActivityTimestamp = event.block.timestamp;
  masterSafe.save();
}

export function handleSafeChangedThreshold(
  event: ChangedThresholdEvent
): void {
  const masterSafe = MasterSafe.load(event.address);
  if (masterSafe == null) return;
  masterSafe.threshold = event.params.threshold;
  masterSafe.lastActivityTimestamp = event.block.timestamp;
  masterSafe.save();
}
