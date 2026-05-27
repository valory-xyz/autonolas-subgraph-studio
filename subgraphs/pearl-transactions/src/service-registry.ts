import { Address, log } from "@graphprotocol/graph-ts";
import {
  ActivateRegistration as ActivateRegistrationEvent,
  CreateMultisigWithAgents as CreateMultisigWithAgentsEvent,
  OperatorUnbond as OperatorUnbondEvent,
  RegisterInstance as RegisterInstanceEvent,
  TerminateService as TerminateServiceEvent,
  Transfer as TransferEvent,
} from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import { Service, ServiceNftCustodyChange } from "../generated/schema";
import {
  BOND_TYPE_AGENT_BOND,
  BOND_TYPE_SECURITY_DEPOSIT,
  SERVICE_STATE_DEPLOYED,
  SERVICE_STATE_TERMINATED,
} from "./constants";
import {
  appendServiceRegistration,
  bufferPendingRegistration,
  drainPendingRegistration,
  fundsMovementId,
  getOrCreateAgentSafe,
  getOrCreateMasterSafe,
  getOrCreateService,
  setServiceIndex,
  stashAgentBondOncePerService,
  stashBondAttribution,
} from "./utils";

// handleRegisterInstance —
//   * If the Service already exists (CreateMultisigWithAgents fired
//     earlier in this tx), record agentId + operator directly on it.
//   * Otherwise buffer into PendingRegistration; drained at
//     CreateMultisigWithAgents time.
//   * Always stash AGENT_BOND attribution for the per-tx queue
//     (idempotent via the dedupe guard).
export function handleRegisterInstance(event: RegisterInstanceEvent): void {
  const serviceId = event.params.serviceId;
  const agentId = event.params.agentId.toI32();
  const operator = event.params.operator;

  const existing = Service.load(serviceId.toString());
  if (existing != null) {
    appendServiceRegistration(existing, agentId, operator);
    existing.updatedTimestamp = event.block.timestamp;
    existing.save();
  } else {
    bufferPendingRegistration(serviceId, agentId, operator);
  }

  stashAgentBondOncePerService(
    event.transaction.hash,
    serviceId,
    BOND_TYPE_AGENT_BOND
  );
}

// handleActivateRegistration —
//   * Stash SECURITY_DEPOSIT attribution for the per-tx queue so the
//     immediately-following TokenDeposit gets bondType =
//     SECURITY_DEPOSIT.
//   * Service state transitions are handled at the SR contract level;
//     we don't mutate Service.state here (the canonical lifecycle
//     state machine isn't tracked in v1 — we record only the
//     terminal-ish states REGISTERED / DEPLOYED / TERMINATED).
export function handleActivateRegistration(
  event: ActivateRegistrationEvent
): void {
  stashBondAttribution(
    event.transaction.hash,
    event.params.serviceId,
    BOND_TYPE_SECURITY_DEPOSIT
  );
}

// handleCreateMultisigWithAgents — service deployment / multisig
// creation. This is the point where Service + AgentSafe become a
// linkable entity-graph; we drain PendingRegistration into Service
// and write the reverse-index ServiceIndex (serviceId → multisig).
export function handleCreateMultisigWithAgents(
  event: CreateMultisigWithAgentsEvent
): void {
  const serviceId = event.params.serviceId;
  const multisig = event.params.multisig;

  const service = getOrCreateService(serviceId, event);
  service.state = SERVICE_STATE_DEPLOYED;
  service.updatedTimestamp = event.block.timestamp;
  drainPendingRegistration(service, serviceId);
  service.save();

  const agentSafe = getOrCreateAgentSafe(multisig, service, event);
  service.agentSafe = agentSafe.id;
  service.save();

  setServiceIndex(serviceId, multisig);
}

// handleServiceNftTransfer — ERC-721 Transfer on the ServiceRegistryL2
// contract (the service NFT). Records every custody change. If the
// recipient is not the zero address and not a known staking proxy, the
// recipient is (or becomes) the Master Safe — call getOrCreateMasterSafe
// which derives Master EOA via getOwners() and emits SAFE_DEPLOYED.
//
// In Phase 1a we have no StakingContract entity yet (Phase 1b), so
// "known staking proxy" check is deferred. For now: skip Master Safe
// derivation only for the zero address (mint/burn). For staked
// services, the recipient is the staking proxy contract — getOwners()
// will revert on a non-Safe contract and Master EOA will be set to
// zero; we log it and move on. Phase 1b will narrow this by checking
// against the StakingContract entity set.
export function handleServiceNftTransfer(event: TransferEvent): void {
  const serviceId = event.params.id;
  const from = event.params.from;
  const to = event.params.to;

  const service = getOrCreateService(serviceId, event);
  service.nftCustodian = to;
  service.updatedTimestamp = event.block.timestamp;
  service.save();

  const change = new ServiceNftCustodyChange(fundsMovementId(event));
  change.service = service.id;
  change.from = from;
  change.to = to;
  change.blockNumber = event.block.number;
  change.blockTimestamp = event.block.timestamp;
  change.transactionHash = event.transaction.hash;
  change.save();

  // Master Safe discovery via the NFT path. Skip the mint case
  // (from == zero address: NFT minted to recipient — recipient is the
  // sender of createService, which is the Master Safe for Pearl). We
  // also call getOrCreateMasterSafe on the mint recipient so the
  // SAFE_DEPLOYED row fires immediately.
  if (!to.equals(Address.zero())) {
    // Phase 1b will filter out the staking proxy recipient here.
    const masterSafe = getOrCreateMasterSafe(to, event);
    service.masterSafe = masterSafe.id;
    service.save();
  }
}

// handleTerminateService — state transition + SECURITY_DEPOSIT refund
// attribution for the immediately-following TokenRefund.
export function handleTerminateService(event: TerminateServiceEvent): void {
  const serviceId = event.params.serviceId;
  const service = getOrCreateService(serviceId, event);
  service.state = SERVICE_STATE_TERMINATED;
  service.updatedTimestamp = event.block.timestamp;
  service.save();

  stashBondAttribution(
    event.transaction.hash,
    serviceId,
    BOND_TYPE_SECURITY_DEPOSIT
  );
}

// handleOperatorUnbond — AGENT_BOND refund attribution for the
// immediately-following TokenRefund (unbondTokenRefund call).
export function handleOperatorUnbond(event: OperatorUnbondEvent): void {
  stashBondAttribution(
    event.transaction.hash,
    event.params.serviceId,
    BOND_TYPE_AGENT_BOND
  );
}
