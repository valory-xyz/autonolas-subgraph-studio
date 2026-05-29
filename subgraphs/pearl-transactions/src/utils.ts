import {
  Address,
  BigInt,
  Bytes,
  dataSource,
  ethereum,
  log,
} from "@graphprotocol/graph-ts";
import {
  AgentBondAttributionGuard,
  AgentSafe,
  FundsMovement,
  MasterSafe,
  PendingBondCounter,
  PendingBondRow,
  PendingRegistration,
  Service,
  ServiceIndex,
} from "../generated/schema";
import { GnosisSafe } from "../generated/ServiceRegistryL2/GnosisSafe";
import {
  CATEGORY_SAFE_DEPLOYED,
  SERVICE_STATE_REGISTERED,
  SOURCE_SEMANTIC,
} from "./constants";

// --- ID helpers ------------------------------------------------------

// Real event-derived IDs: txHash + logIndex. Matches the The-Graph
// canonical pattern used across the repo.
export function fundsMovementId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

// Synthetic-row IDs use a string-prefix Bytes so they cannot collide
// with real log-derived IDs (which are pure 32-byte-tx + 4-byte-logIndex
// concatenations). Both prefix and the appended Safe address are kept
// stable across replays.
export function safeDeployedId(masterSafe: Bytes): Bytes {
  return Bytes.fromUTF8("safe-deployed:").concat(masterSafe);
}

export function serviceIndexId(serviceId: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(serviceId));
}

export function pendingRegistrationId(serviceId: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(serviceId));
}

export function agentBondAttributionGuardId(
  txHash: Bytes,
  serviceId: BigInt
): Bytes {
  return txHash.concat(Bytes.fromByteArray(Bytes.fromBigInt(serviceId)));
}

export function pendingBondRowId(txHash: Bytes, slot: i32): Bytes {
  return txHash.concatI32(slot);
}

// --- Network ---------------------------------------------------------

export function currentNetwork(): string {
  return dataSource.network();
}

// --- MasterSafe ------------------------------------------------------

// getOrCreateMasterSafe — first-sighting derivation per plan §4.4 / §5.2.
//
// On creation:
//   1. eth_call GnosisSafe.getOwners() and GnosisSafe.getThreshold() to
//      populate masterEoa / owners / threshold.
//   2. Emit a SAFE_DEPLOYED FundsMovement row anchoring the consumer
//      wallet UI's "Setup complete" entry.
//
// Idempotent on subsequent calls: only lastActivityTimestamp is bumped.
export function getOrCreateMasterSafe(
  address: Address,
  event: ethereum.Event
): MasterSafe | null {
  let masterSafe = MasterSafe.load(address);
  if (masterSafe != null) {
    masterSafe.lastActivityTimestamp = event.block.timestamp;
    masterSafe.save();
    return masterSafe;
  }

  // Confirm `address` is actually a Gnosis Safe before treating it as a
  // Master Safe. The service NFT also lands on non-Safe recipients — a
  // staking proxy (when a service is staked), an EOA, etc. — none of
  // which are Master Safes. A real Safe always answers getOwners();
  // everything else reverts. On revert (or empty owners) we skip
  // entirely: no MasterSafe entity, no SAFE_DEPLOYED row, and the caller
  // leaves any existing service.masterSafe link untouched. (Phase 1b
  // replaces this probe with an explicit StakingContract allowlist.)
  const safeContract = GnosisSafe.bind(address);
  const ownersResult = safeContract.try_getOwners();
  if (ownersResult.reverted || ownersResult.value.length == 0) {
    log.info(
      "Skipping non-Safe NFT recipient {} (getOwners reverted/empty) (tx {})",
      [address.toHexString(), event.transaction.hash.toHexString()]
    );
    return null;
  }

  masterSafe = new MasterSafe(address);
  masterSafe.network = currentNetwork();
  masterSafe.firstSeenTimestamp = event.block.timestamp;
  masterSafe.firstSeenBlock = event.block.number;
  masterSafe.lastActivityTimestamp = event.block.timestamp;

  // Pearl's flow guarantees owners[0] == Master EOA (1-of-2 with a
  // non-signing backup).
  const ownersAsBytes: Bytes[] = [];
  for (let i = 0; i < ownersResult.value.length; i++) {
    ownersAsBytes.push(ownersResult.value[i]);
  }
  masterSafe.owners = ownersAsBytes;
  masterSafe.masterEoa = ownersResult.value[0];

  const thresholdResult = safeContract.try_getThreshold();
  masterSafe.threshold = thresholdResult.reverted
    ? BigInt.zero()
    : thresholdResult.value;

  masterSafe.save();

  // Emit SAFE_DEPLOYED anchor row.
  emitSafeDeployedRow(masterSafe, event);

  return masterSafe;
}

function emitSafeDeployedRow(
  masterSafe: MasterSafe,
  event: ethereum.Event
): void {
  const row = new FundsMovement(safeDeployedId(masterSafe.id));
  row.masterSafe = masterSafe.id;
  row.category = CATEGORY_SAFE_DEPLOYED;
  row.source = SOURCE_SEMANTIC;
  row.amount = BigInt.zero();
  row.from = Address.zero();
  row.to = masterSafe.id;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();
}

// --- AgentSafe -------------------------------------------------------

export function getOrCreateAgentSafe(
  address: Address,
  service: Service,
  event: ethereum.Event
): AgentSafe {
  let agentSafe = AgentSafe.load(address);
  if (agentSafe != null) {
    return agentSafe;
  }
  agentSafe = new AgentSafe(address);
  agentSafe.service = service.id;
  if (service.masterSafe !== null) {
    agentSafe.masterSafe = service.masterSafe;
  }
  agentSafe.createdTimestamp = event.block.timestamp;
  agentSafe.save();
  return agentSafe;
}

// --- Service ---------------------------------------------------------

export function getOrCreateService(
  serviceId: BigInt,
  event: ethereum.Event
): Service {
  const id = serviceId.toString();
  let service = Service.load(id);
  if (service != null) {
    return service;
  }
  service = new Service(id);
  service.serviceId = serviceId;
  service.agentIds = [];
  service.operators = [];
  service.state = SERVICE_STATE_REGISTERED;
  service.registeredTimestamp = event.block.timestamp;
  service.updatedTimestamp = event.block.timestamp;
  service.save();
  return service;
}

// Append agentId + operator into a Service's deduped lists.
export function appendServiceRegistration(
  service: Service,
  agentId: i32,
  operator: Bytes
): void {
  const agentIds = service.agentIds;
  let agentSeen = false;
  for (let i = 0; i < agentIds.length; i++) {
    if (agentIds[i] == agentId) {
      agentSeen = true;
      break;
    }
  }
  if (!agentSeen) {
    agentIds.push(agentId);
    service.agentIds = agentIds;
  }

  const operators = service.operators;
  let opSeen = false;
  for (let i = 0; i < operators.length; i++) {
    if (operators[i].equals(operator)) {
      opSeen = true;
      break;
    }
  }
  if (!opSeen) {
    operators.push(operator);
    service.operators = operators;
  }
}

// --- PendingRegistration (RegisterInstance-before-CreateMultisig drain)

export function bufferPendingRegistration(
  serviceId: BigInt,
  agentId: i32,
  operator: Bytes
): void {
  const id = pendingRegistrationId(serviceId);
  let pending = PendingRegistration.load(id);
  if (pending == null) {
    pending = new PendingRegistration(id);
    pending.agentIds = [];
    pending.operators = [];
  }

  const agentIds = pending.agentIds;
  let agentSeen = false;
  for (let i = 0; i < agentIds.length; i++) {
    if (agentIds[i] == agentId) {
      agentSeen = true;
      break;
    }
  }
  if (!agentSeen) {
    agentIds.push(agentId);
    pending.agentIds = agentIds;
  }

  const operators = pending.operators;
  let opSeen = false;
  for (let i = 0; i < operators.length; i++) {
    if (operators[i].equals(operator)) {
      opSeen = true;
      break;
    }
  }
  if (!opSeen) {
    operators.push(operator);
    pending.operators = operators;
  }

  pending.save();
}

// drainPendingRegistration — merge a Service's buffered agentIds and
// operators into the Service's own deduped lists. The two arrays are
// independent (an operator can register multiple agents; an agent ID
// can have multiple operators), so they're deduped separately.
export function drainPendingRegistration(
  service: Service,
  serviceId: BigInt
): void {
  const id = pendingRegistrationId(serviceId);
  const pending = PendingRegistration.load(id);
  if (pending == null) return;

  const mergedAgentIds = service.agentIds;
  const pendingAgentIds = pending.agentIds;
  for (let i = 0; i < pendingAgentIds.length; i++) {
    const aid = pendingAgentIds[i];
    let seen = false;
    for (let j = 0; j < mergedAgentIds.length; j++) {
      if (mergedAgentIds[j] == aid) {
        seen = true;
        break;
      }
    }
    if (!seen) mergedAgentIds.push(aid);
  }
  service.agentIds = mergedAgentIds;

  const mergedOps = service.operators;
  const pendingOps = pending.operators;
  for (let i = 0; i < pendingOps.length; i++) {
    const op = pendingOps[i];
    let seen = false;
    for (let j = 0; j < mergedOps.length; j++) {
      if (mergedOps[j].equals(op)) {
        seen = true;
        break;
      }
    }
    if (!seen) mergedOps.push(op);
  }
  service.operators = mergedOps;
}

// --- ServiceIndex ----------------------------------------------------

export function setServiceIndex(serviceId: BigInt, multisig: Bytes): void {
  const id = serviceIndexId(serviceId);
  let idx = ServiceIndex.load(id);
  if (idx == null) {
    idx = new ServiceIndex(id);
  }
  idx.multisig = multisig;
  idx.save();
}

// --- Bond attribution queue (per-tx) ---------------------------------
//
// On-chain the SRTU event (TokenDeposit / TokenRefund) always fires
// *before* its ServiceRegistryL2 counterpart (ServiceManager calls the
// *TokenDeposit / *TokenRefund function before the registry function in
// every path: activateRegistration, registerAgents, terminate, unbond).
// So the SRTU handler is the PRODUCER — it creates the FundsMovement row
// and enqueues its id — and the ServiceRegistryL2 handler is the
// CONSUMER, dequeuing the oldest pending row and backfilling serviceId +
// bondType.

function getOrCreatePendingBondCounter(txHash: Bytes): PendingBondCounter {
  let counter = PendingBondCounter.load(txHash);
  if (counter == null) {
    counter = new PendingBondCounter(txHash);
    counter.nextEnqueueSlot = 0;
    counter.nextDequeueSlot = 0;
    counter.save();
  }
  return counter;
}

// enqueuePendingBondRow — append a FundsMovement row id to the per-tx
// queue. Called by SRTU handlers (handleTokenDeposit / handleTokenRefund)
// right after they create the (as-yet unattributed) row.
export function enqueuePendingBondRow(
  txHash: Bytes,
  fundsMovementId: Bytes
): void {
  const counter = getOrCreatePendingBondCounter(txHash);
  const slot = counter.nextEnqueueSlot;

  const ptr = new PendingBondRow(pendingBondRowId(txHash, slot));
  ptr.fundsMovement = fundsMovementId;
  ptr.attributed = false;
  ptr.save();

  counter.nextEnqueueSlot = slot + 1;
  counter.save();
}

// dequeueAndAttribute — pop the oldest not-yet-attributed row from the
// per-tx queue and backfill its serviceId + bondType. No-op if the queue
// is empty (a ServiceRegistryL2 event fired without a matching prior
// TokenDeposit / TokenRefund — e.g. a native-secured service that never
// touches SRTU; the row simply doesn't exist, nothing to attribute).
export function dequeueAndAttribute(
  txHash: Bytes,
  serviceId: BigInt,
  bondType: string
): void {
  const counter = PendingBondCounter.load(txHash);
  if (counter == null) return;

  let slot = counter.nextDequeueSlot;
  while (slot < counter.nextEnqueueSlot) {
    const ptr = PendingBondRow.load(pendingBondRowId(txHash, slot));
    if (ptr != null && !ptr.attributed) {
      ptr.attributed = true;
      ptr.save();
      counter.nextDequeueSlot = slot + 1;
      counter.save();

      const movement = FundsMovement.load(ptr.fundsMovement);
      if (movement != null) {
        movement.service = serviceId.toString();
        movement.bondType = bondType;
        movement.save();
      }
      return;
    }
    slot += 1;
  }
}

// attributeAgentBondOncePerService — same as dequeueAndAttribute but
// dedupes via AgentBondAttributionGuard so multiple RegisterInstance
// events (one per agent instance) only attribute the single AGENT_BOND
// row once per (txHash, serviceId). registerAgentsTokenDeposit emits one
// TokenDeposit for the combined agent bond, so only one row is enqueued.
export function attributeAgentBondOncePerService(
  txHash: Bytes,
  serviceId: BigInt,
  bondType: string
): void {
  const guardId = agentBondAttributionGuardId(txHash, serviceId);
  if (AgentBondAttributionGuard.load(guardId) != null) {
    return;
  }
  const guard = new AgentBondAttributionGuard(guardId);
  guard.save();
  dequeueAndAttribute(txHash, serviceId, bondType);
}
