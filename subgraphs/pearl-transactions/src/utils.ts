import {
  Address,
  BigInt,
  Bytes,
  dataSource,
  ethereum,
  log,
} from "@graphprotocol/graph-ts";
import {
  AgentBondStashGuard,
  AgentSafe,
  FundsMovement,
  MasterSafe,
  PendingBondAttribution,
  PendingBondCounter,
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

export function agentBondStashGuardId(
  txHash: Bytes,
  serviceId: BigInt
): Bytes {
  return txHash.concat(Bytes.fromByteArray(Bytes.fromBigInt(serviceId)));
}

export function pendingBondAttributionId(
  txHash: Bytes,
  slot: i32
): Bytes {
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
): MasterSafe {
  let masterSafe = MasterSafe.load(address);
  if (masterSafe != null) {
    masterSafe.lastActivityTimestamp = event.block.timestamp;
    masterSafe.save();
    return masterSafe;
  }

  masterSafe = new MasterSafe(address);
  masterSafe.network = currentNetwork();
  masterSafe.firstSeenTimestamp = event.block.timestamp;
  masterSafe.firstSeenBlock = event.block.number;
  masterSafe.lastActivityTimestamp = event.block.timestamp;

  // getOwners() + getThreshold() eth_calls. Pearl's flow guarantees
  // owners[0] == Master EOA (1-of-2 with non-signing backup). If the
  // call reverts (e.g. the address is not a GnosisSafe), fall back to
  // empty owners + threshold = 0 + masterEoa = zero address — better
  // than crashing the indexer; the consumer can detect the fallback
  // (threshold == 0).
  const safeContract = GnosisSafe.bind(address);
  const ownersResult = safeContract.try_getOwners();
  const thresholdResult = safeContract.try_getThreshold();

  if (!ownersResult.reverted && ownersResult.value.length > 0) {
    const ownersAsBytes: Bytes[] = [];
    for (let i = 0; i < ownersResult.value.length; i++) {
      ownersAsBytes.push(ownersResult.value[i]);
    }
    masterSafe.owners = ownersAsBytes;
    masterSafe.masterEoa = ownersResult.value[0];
  } else {
    log.warning(
      "getOwners() reverted or empty for putative Master Safe {} (tx {})",
      [
        address.toHexString(),
        event.transaction.hash.toHexString(),
      ]
    );
    masterSafe.owners = [];
    masterSafe.masterEoa = Address.zero();
  }

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

function getOrCreatePendingBondCounter(txHash: Bytes): PendingBondCounter {
  let counter = PendingBondCounter.load(txHash);
  if (counter == null) {
    counter = new PendingBondCounter(txHash);
    counter.nextStashSlot = 0;
    counter.nextConsumeSlot = 0;
    counter.save();
  }
  return counter;
}

// stashBondAttribution — append (serviceId, bondType) to the per-tx
// queue. Called by ServiceRegistryL2 handlers (ActivateRegistration,
// RegisterInstance via the dedupe guard, TerminateService,
// OperatorUnbond).
export function stashBondAttribution(
  txHash: Bytes,
  serviceId: BigInt,
  bondType: string
): void {
  const counter = getOrCreatePendingBondCounter(txHash);
  const slot = counter.nextStashSlot;

  const attribution = new PendingBondAttribution(
    pendingBondAttributionId(txHash, slot)
  );
  attribution.serviceId = serviceId;
  attribution.bondType = bondType;
  attribution.consumed = false;
  attribution.save();

  counter.nextStashSlot = slot + 1;
  counter.save();
}

// stashAgentBondOncePerService — same as stashBondAttribution but
// dedupes via AgentBondStashGuard so multiple RegisterInstance events
// (one per agent instance) only produce one AGENT_BOND attribution per
// (txHash, serviceId).
export function stashAgentBondOncePerService(
  txHash: Bytes,
  serviceId: BigInt,
  bondType: string
): void {
  const guardId = agentBondStashGuardId(txHash, serviceId);
  if (AgentBondStashGuard.load(guardId) != null) {
    return;
  }
  const guard = new AgentBondStashGuard(guardId);
  guard.save();
  stashBondAttribution(txHash, serviceId, bondType);
}

// consumeBondAttribution — pop the next unconsumed attribution from
// the per-tx queue. Returns null if the queue is empty (i.e. a
// TokenDeposit / TokenRefund fired without a matching prior
// ServiceRegistryL2 event — leaves bondType null on the resulting row).
export class ConsumedAttribution {
  serviceId: BigInt;
  bondType: string;
  constructor(serviceId: BigInt, bondType: string) {
    this.serviceId = serviceId;
    this.bondType = bondType;
  }
}

export function consumeBondAttribution(
  txHash: Bytes
): ConsumedAttribution | null {
  const counter = PendingBondCounter.load(txHash);
  if (counter == null) return null;

  // Advance past any already-consumed slots (defensive; in normal
  // operation we always consume the head, so consumeSlot == the first
  // non-consumed slot).
  let slot = counter.nextConsumeSlot;
  while (slot < counter.nextStashSlot) {
    const id = pendingBondAttributionId(txHash, slot);
    const attribution = PendingBondAttribution.load(id);
    if (attribution != null && !attribution.consumed) {
      attribution.consumed = true;
      attribution.save();
      counter.nextConsumeSlot = slot + 1;
      counter.save();
      return new ConsumedAttribution(
        attribution.serviceId,
        attribution.bondType
      );
    }
    slot += 1;
  }
  return null;
}
