import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  CreateMultisigWithAgents as CreateMultisigWithAgentsEvent,
  RegisterInstance as RegisterInstanceEvent,
} from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import { TraderAgent, TraderService } from "../generated/schema";
import { getGlobal } from "./utils";

// Load-or-create a TraderService row, append (agentId, operator) with dedup.
// Mirrors `appendServiceRegistration` + `bufferPendingRegistration` in
// pearl-transactions: same dedup semantics so the two subgraphs surface the
// same per-service cohort metadata.
function recordRegistration(
  serviceId: string,
  agentId: i32,
  operator: Bytes
): TraderService {
  let service = TraderService.load(serviceId);
  if (service == null) {
    service = new TraderService(serviceId);
    service.agentIds = [];
    service.operators = [];
  }

  let agentIds = service.agentIds;
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

  let operators = service.operators;
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

  service.save();
  return service;
}

// handleRegisterInstance — every Olas service on Polygon is indexed.
// (Previously this gated on `agentId == PREDICT_AGENT_ID (86)` so only
// polystrat services produced a TraderService; that silently dropped
// non-polystrat cohorts like Pearl Mini from trader-P&L analytics.)
//
// The TraderService row is the per-service cohort metadata — accumulates
// agentIds + operators across all RegisterInstance events for the service
// (a service can register multiple agent instances, each with its own
// agentId/operator). Cohort filtering happens client-side via
// `traderService_: { agentIds_contains: [...] }` / `operators_contains: [...]`.
export function handleRegisterInstance(event: RegisterInstanceEvent): void {
  const serviceId = event.params.serviceId.toHexString();
  const agentId = event.params.agentId.toI32();
  const operator = event.params.operator;

  recordRegistration(serviceId, agentId, operator);
}

// handleCreateMultisigWithAgents — service deployment / multisig creation.
// Creates the TraderAgent (keyed on multisig address) and wires it to the
// already-buffered TraderService row.
//
// TraderService is load-or-created here too: in the rare case where
// CreateMultisigWithAgents fires before any RegisterInstance for the
// service (not the canonical Polygon order, but defensively handled), we
// still get a TraderService row with empty arrays — RegisterInstance
// events that follow will dedup-append into it.
export function handleCreateMultisigWithAgents(
  event: CreateMultisigWithAgentsEvent
): void {
  const serviceId = event.params.serviceId.toHexString();
  const multisig = event.params.multisig;

  let service = TraderService.load(serviceId);
  if (service == null) {
    service = new TraderService(serviceId);
    service.agentIds = [];
    service.operators = [];
    service.save();
  }

  let traderAgent = TraderAgent.load(multisig);
  if (traderAgent === null) {
    traderAgent = new TraderAgent(multisig);
    traderAgent.serviceId = event.params.serviceId;
    traderAgent.traderService = service.id;
    traderAgent.totalBets = 0;
    traderAgent.totalPayout = BigInt.zero();
    traderAgent.totalTraded = BigInt.zero();
    traderAgent.totalTradedSettled = BigInt.zero();
    traderAgent.totalExpectedPayout = BigInt.zero();

    traderAgent.blockNumber = event.block.number;
    traderAgent.blockTimestamp = event.block.timestamp;
    traderAgent.transactionHash = event.transaction.hash;

    traderAgent.save();

    service.traderAgent = traderAgent.id;
    service.save();

    let global = getGlobal();
    global.totalTraderAgents += 1;
    global.save();
  }
}
