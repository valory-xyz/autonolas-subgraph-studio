import { Bytes } from "@graphprotocol/graph-ts";
import {
  CreateMultisigWithAgents as CreateMultisigWithAgentsEvent,
  RegisterInstance as RegisterInstanceEvent,
  TerminateService as TerminateServiceEvent,
} from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import {
  Multisig,
  PendingMultisig,
  ServiceIndex,
} from "../generated/schema";

function serviceIdKey(serviceIdBytes: Bytes): Bytes {
  return serviceIdBytes;
}

function dedupPushI32(arr: i32[], value: i32): i32[] {
  if (arr.indexOf(value) == -1) arr.push(value);
  return arr;
}

function dedupPushBytes(arr: Bytes[], value: Bytes): Bytes[] {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].equals(value)) return arr;
  }
  arr.push(value);
  return arr;
}

export function handleRegisterInstance(event: RegisterInstanceEvent): void {
  let serviceIdBytes = Bytes.fromByteArray(
    Bytes.fromBigInt(event.params.serviceId),
  );
  let agentId = event.params.agentId.toI32();
  let operator = event.params.operator;

  let index = ServiceIndex.load(serviceIdKey(serviceIdBytes));
  if (index !== null) {
    let multisig = Multisig.load(index.multisig);
    if (multisig !== null) {
      multisig.agentIds = dedupPushI32(multisig.agentIds, agentId);
      multisig.operators = dedupPushBytes(multisig.operators, operator);
      multisig.save();
      return;
    }
  }

  let pending = PendingMultisig.load(serviceIdKey(serviceIdBytes));
  if (pending === null) {
    pending = new PendingMultisig(serviceIdKey(serviceIdBytes));
    pending.agentIds = [];
    pending.operators = [];
  }
  pending.agentIds = dedupPushI32(pending.agentIds, agentId);
  pending.operators = dedupPushBytes(pending.operators, operator);
  pending.save();
}

export function handleCreateMultisigWithAgents(
  event: CreateMultisigWithAgentsEvent,
): void {
  let multisigAddress = event.params.multisig;
  let serviceIdBytes = Bytes.fromByteArray(
    Bytes.fromBigInt(event.params.serviceId),
  );

  let multisig = Multisig.load(multisigAddress);
  if (multisig === null) {
    multisig = new Multisig(multisigAddress);
    multisig.serviceId = event.params.serviceId;
    multisig.agentIds = [];
    multisig.operators = [];
    multisig.createdAt = event.block.timestamp;
    multisig.blockNumber = event.block.number;
    multisig.transactionHash = event.transaction.hash;
  }

  let pending = PendingMultisig.load(serviceIdKey(serviceIdBytes));
  if (pending !== null) {
    let agentIds = multisig.agentIds;
    let pendingAgentIds = pending.agentIds;
    for (let i = 0; i < pendingAgentIds.length; i++) {
      agentIds = dedupPushI32(agentIds, pendingAgentIds[i]);
    }
    let operators = multisig.operators;
    let pendingOperators = pending.operators;
    for (let i = 0; i < pendingOperators.length; i++) {
      operators = dedupPushBytes(operators, pendingOperators[i]);
    }
    multisig.agentIds = agentIds;
    multisig.operators = operators;
  }
  multisig.save();

  let index = ServiceIndex.load(serviceIdKey(serviceIdBytes));
  if (index === null) {
    index = new ServiceIndex(serviceIdKey(serviceIdBytes));
  }
  index.multisig = multisigAddress;
  index.save();
}

export function handleTerminateService(event: TerminateServiceEvent): void {
  let serviceIdBytes = Bytes.fromByteArray(
    Bytes.fromBigInt(event.params.serviceId),
  );
  let index = ServiceIndex.load(serviceIdKey(serviceIdBytes));
  if (index === null) return;
  let multisig = Multisig.load(index.multisig);
  if (multisig === null) return;
  multisig.terminatedAt = event.block.timestamp;
  multisig.save();
}
