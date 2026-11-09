import { Address, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
import {
  AddedOwner as AddedOwnerEvent,
  ChangedThreshold as ChangedThresholdEvent,
  ExecutionFromModuleSuccess as ExecutionFromModuleSuccessEvent,
  ExecutionSuccess as ExecutionSuccessEvent,
  RemovedOwner as RemovedOwnerEvent,
  SafeReceived as SafeReceivedEvent,
} from "../generated/templates/Safe/GnosisSafe";
import {
  AgentInstance,
  FundsMovement,
  MasterSafe,
  Service,
  TrackedAddress,
} from "../generated/schema";
import {
  CATEGORY_AGENT_SAFE_TO_AGENT_EOA,
  CATEGORY_MASTER_FUNDING_IN,
  CATEGORY_MASTER_TO_AGENT,
  CATEGORY_SAFE_SETUP_TRANSFER,
  ROLE_AGENT,
  ROLE_MASTER,
  SOURCE_RAW_TRANSFER,
  SOURCE_SEMANTIC,
} from "./constants";
import {
  MULTISEND_V130,
  NativeLeg,
  addToAgentFundingEvent,
  agentSafeTopUpId,
  agentSignerLegId,
  classifyTransfer,
  fundsMovementId,
  getOrCreateAgentFundingEvent,
  markSetupTransferSeen,
  multiSendNativeLegs,
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
// Positions of the fields read from the decoded EXEC_TRANSACTION_ARGS tuple.
const ARG_TO = 0;
const ARG_VALUE = 1;
const ARG_DATA = 2;
const ARG_OPERATION = 3;

function hasExecTransactionSelector(input: Bytes): boolean {
  if (input.length < 4) return false;
  for (let i = 0; i < 4; i++) {
    if (input[i] != EXEC_TRANSACTION_SELECTOR[i]) return false;
  }
  return true;
}

// handleSafeExecutionSuccess — the event has no amount or recipient, so both
// come from decoding the outer tx. Row ids are fixed per tx, so a reentrant
// execTransaction from the same Safe in the same tx writes no second row.
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
      "Safe {} execTransaction calldata not decodable (tx={}, input_len={}); skipping",
      [
        event.address.toHexString(),
        event.transaction.hash.toHexString(),
        input.length.toString(),
      ]
    );
    return;
  }
  const args = decoded.toTuple();

  const operation = args[ARG_OPERATION].toBigInt();
  const data = args[ARG_DATA].toBytes();
  const value = args[ARG_VALUE].toBigInt();
  const target = args[ARG_TO].toAddress();
  const plainNative =
    operation.isZero() && data.length == 0 && value.gt(BigInt.zero());
  const multiSend =
    operation.equals(BigInt.fromI32(1)) && target.equals(MULTISEND_V130);
  if (!plainNative && !multiSend) return;

  const tracked = TrackedAddress.load(event.address);
  if (tracked !== null && tracked.role == ROLE_MASTER) {
    if (plainNative) {
      writeAgentSignerLegs(event, [new NativeLeg(0, target, value)]);
      return;
    }
    const legs = multiSendNativeLegs(data);
    if (legs === null) {
      log.warning(
        "Pearl Safe {} MultiSend calldata does not unpack (tx={}, data_len={}); skipping",
        [
          event.address.toHexString(),
          event.transaction.hash.toHexString(),
          data.length.toString(),
        ]
      );
      return;
    }
    writeAgentSignerLegs(event, legs);
    return;
  }

  if (!plainNative) return;
  if (!target.equals(event.transaction.from)) {
    log.debug(
      "Safe {} native CALL not paid to the tx sender (tx={}); skipping",
      [event.address.toHexString(), event.transaction.hash.toHexString()]
    );
    return;
  }
  if (tracked === null || tracked.role != ROLE_AGENT) {
    log.debug(
      "Safe {} with top-up shape is not an Agent Safe (role={}, tx={}); skipping",
      [
        event.address.toHexString(),
        tracked === null ? "untracked" : tracked.role,
        event.transaction.hash.toHexString(),
      ]
    );
    return;
  }

  const id = agentSafeTopUpId(event.transaction.hash);
  if (FundsMovement.load(id) !== null) return;

  const row = nativeOutflowRow(
    id,
    event,
    CATEGORY_AGENT_SAFE_TO_AGENT_EOA,
    target,
    value
  );
  if (tracked.service !== null) {
    row.service = tracked.service!;
  }
  if (tracked.masterSafe !== null) {
    row.masterSafe = tracked.masterSafe!;
  }
  row.agentSafe = tracked.id;
  row.save();
}

// token stays null (native), and native has no TokenBalance.
function nativeOutflowRow(
  id: Bytes,
  event: ExecutionSuccessEvent,
  category: string,
  to: Address,
  amount: BigInt
): FundsMovement {
  const row = new FundsMovement(id);
  row.category = category;
  row.source = SOURCE_SEMANTIC;
  row.amount = amount;
  row.from = event.address;
  row.to = to;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  return row;
}

function writeAgentSignerLegs(
  event: ExecutionSuccessEvent,
  legs: NativeLeg[]
): void {
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const instance = AgentInstance.load(leg.to);
    if (instance === null) continue;
    const service = Service.load(instance.serviceId);
    if (service === null) continue;
    const masterSafe = service.masterSafe;
    if (masterSafe === null || !masterSafe.equals(event.address)) continue;

    const id = agentSignerLegId(event.transaction.hash, leg.index);
    if (FundsMovement.load(id) !== null) continue;

    const row = nativeOutflowRow(
      id,
      event,
      CATEGORY_MASTER_TO_AGENT,
      leg.to,
      leg.value
    );
    row.service = service.id;
    row.masterSafe = event.address;
    row.agentSafe = service.agentSafe;

    const afe = getOrCreateAgentFundingEvent(
      event.transaction.hash,
      event.address,
      service.id,
      event
    );
    row.agentFundingEvent = afe.id;
    addToAgentFundingEvent(afe, leg.value, /* isNative = */ true);
    row.save();
  }
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
