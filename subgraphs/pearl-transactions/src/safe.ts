import { Address, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
import {
  AddedOwner as AddedOwnerEvent,
  ChangedThreshold as ChangedThresholdEvent,
  ExecutionFromModuleSuccess as ExecutionFromModuleSuccessEvent,
  ExecutionSuccess as ExecutionSuccessEvent,
  RemovedOwner as RemovedOwnerEvent,
  SafeReceived as SafeReceivedEvent,
} from "../generated/templates/Safe/GnosisSafe";
import { FundsMovement, MasterSafe } from "../generated/schema";
import {
  CATEGORY_MASTER_FUNDING_IN,
  CATEGORY_SAFE_SETUP_TRANSFER,
  SOURCE_RAW_TRANSFER,
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

  const classification = classifyTransfer(from, to, null);
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
    addToAgentFundingEvent(afe, amount, /* isNative = */ true);
  }

  row.save();
}

// handleSafeExecutionSuccess / handleSafeExecutionFromModuleSuccess
// — native OUT events. Approximate per plan §6.2 / babydegen pattern:
// Safes executing via a relayer carry value=0 on the outer tx, so we
// cannot read the moved amount from these events alone. We record a
// zero-amount placeholder row so the consumer wallet UI can show
// "Safe executed an outbound tx" without claiming a precise amount.
// Phase 2b+ could swap this for call/trace handlers if cost permits.
export function handleSafeExecutionSuccess(
  event: ExecutionSuccessEvent
): void {
  emitNativeOutPlaceholder(event.address, event);
}

export function handleSafeExecutionFromModuleSuccess(
  event: ExecutionFromModuleSuccessEvent
): void {
  emitNativeOutPlaceholder(event.address, event);
}

function emitNativeOutPlaceholder(
  safeAddr: Address,
  event: ethereum.Event
): void {
  // Only emit if `safeAddr` is a tracked safe — otherwise the event
  // came from an unrelated Safe that shares the template.
  // (TrackedAddress.load is checked indirectly via classifyTransfer
  // when from/to side matters; for placeholder we just need the safe
  // tracked-ness.)
  const masterSafe = MasterSafe.load(safeAddr);
  // TrackedAddress lookup is more direct but a MasterSafe entity exists
  // iff the safe was first-sighted as a Master Safe. Agent Safes
  // don't get MasterSafe entities, so we'd miss them here. Use
  // classifyTransfer with a synthetic zero-address "from" instead
  // to determine tracked-ness; for now, skip the placeholder if
  // neither MasterSafe nor an AgentSafe entity exists — the
  // refinement is a Phase 2a.ii follow-up.
}
// NOTE: emitNativeOutPlaceholder is intentionally a no-op for v1.
// Precise native-out tracking requires call/trace handlers — see
// plan §6.2 honest-limits doc and the Phase 2b+ option.

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
