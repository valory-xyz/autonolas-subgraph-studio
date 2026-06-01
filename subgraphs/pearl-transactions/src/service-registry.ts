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
  attributeAgentBondOncePerService,
  bufferPendingRegistration,
  dequeueAndAttribute,
  drainPendingRegistration,
  fundsMovementId,
  getOrCreateAgentSafe,
  getOrCreateMasterSafe,
  getOrCreateService,
  setServiceIndex,
} from "./utils";

// handleRegisterInstance —
//   * If the Service already exists (CreateMultisigWithAgents fired
//     earlier in this tx), record agentId + operator directly on it.
//   * Otherwise buffer into PendingRegistration; drained at
//     CreateMultisigWithAgents time.
//   * Attribute the AGENT_BOND row enqueued by the preceding
//     registerAgentsTokenDeposit TokenDeposit (idempotent via the dedupe
//     guard, since RegisterInstance fires once per agent instance but
//     only one agent-bond row exists).
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

  attributeAgentBondOncePerService(
    event.transaction.hash,
    serviceId,
    BOND_TYPE_AGENT_BOND
  );
}

// handleActivateRegistration —
//   * Attribute the SECURITY_DEPOSIT row enqueued by the immediately-
//     preceding activateRegistrationTokenDeposit TokenDeposit (the SRTU
//     call runs before this registry call in ServiceManager).
//   * Service state transitions are handled at the SR contract level;
//     we don't mutate Service.state here (the canonical lifecycle
//     state machine isn't tracked in v1 — we record only the
//     terminal-ish states REGISTERED / DEPLOYED / TERMINATED).
export function handleActivateRegistration(
  event: ActivateRegistrationEvent
): void {
  dequeueAndAttribute(
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
// contract (the service NFT). Records every custody change, then tries
// to resolve the recipient to a Master Safe.
//
// Master Safe discovery is gated on getOrCreateMasterSafe succeeding
// (i.e. the recipient answers getOwners() — a real Safe). The recipient
// is NOT always a Master Safe: at mint it's the creator's Safe (the
// Master Safe), but when a service is staked the NFT moves to a staking
// proxy, and on burn it goes to the zero address. Only the Safe case
// links service.masterSafe; non-Safe recipients are skipped so the real
// Master Safe link (established at mint) is preserved. Phase 1b replaces
// the getOwners() probe with an explicit StakingContract allowlist.
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

  // Resolve the recipient to a Master Safe. Skip the zero address
  // (burn). getOrCreateMasterSafe returns null when `to` isn't a Safe
  // (staking proxy, EOA, …); only link when it resolves, so a stake hop
  // (Master Safe → staking proxy) doesn't clobber the real link.
  if (!to.equals(Address.zero())) {
    const masterSafe = getOrCreateMasterSafe(to, event);
    if (masterSafe != null) {
      service.masterSafe = masterSafe.id;
      service.save();
    }
  }
}

// handleTerminateService — state transition + SECURITY_DEPOSIT refund
// attribution for the immediately-preceding TokenRefund
// (terminateTokenRefund runs before terminate in ServiceManager).
export function handleTerminateService(event: TerminateServiceEvent): void {
  const serviceId = event.params.serviceId;
  const service = getOrCreateService(serviceId, event);
  service.state = SERVICE_STATE_TERMINATED;
  service.updatedTimestamp = event.block.timestamp;
  service.save();

  dequeueAndAttribute(
    event.transaction.hash,
    serviceId,
    BOND_TYPE_SECURITY_DEPOSIT
  );
}

// handleOperatorUnbond — AGENT_BOND refund attribution for the
// immediately-preceding TokenRefund (unbondTokenRefund runs before
// unbond in ServiceManager).
export function handleOperatorUnbond(event: OperatorUnbondEvent): void {
  dequeueAndAttribute(
    event.transaction.hash,
    event.params.serviceId,
    BOND_TYPE_AGENT_BOND
  );
}
