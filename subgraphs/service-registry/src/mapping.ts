import { BigInt, ethereum, log } from '@graphprotocol/graph-ts';
import {
  CreateMultisigWithAgents,
  CreateService,
  RegisterInstance,
  TerminateService,
} from '../generated/ServiceRegistryL2/ServiceRegistryL2';
import {
  ExecutionSuccess,
  ExecutionFromModuleSuccess,
} from '../generated/templates/GnosisSafe/GnosisSafe';
import {
  ServiceAgentLinked,
  AgentWalletSet,
  MetadataSet,
} from '../generated/IdentityRegistryBridger/IdentityRegistryBridger';
import { Multisig, Service } from '../generated/schema';
import { GnosisSafe as GnosisSafeTemplate } from '../generated/templates';
import {
  getOrCreateService,
  getOrCreateMultisig,
  getOrCreateDailyServiceActivity,
  getOrCreateDailyUniqueAgents,
  getOrCreateDailyAgentPerformance,
  getOrCreateDailyActiveMultisigs,
  getGlobal,
  getOrCreateAgentPerformance,
  createDailyUniqueAgent,
  createDailyAgentMultisig,
  createDailyActiveMultisig,
  createOrUpdateAgentRegistration,
  getMostRecentAgentId,
  updateUniqueOperators,
  getOrCreateServiceCreator,
  getOrCreateERC8004Agent,
  getOrCreateERC8004Metadata,
  initializeERC8004DefaultMetadata,
} from './utils';

function updateDailyAgentPerformance(
  event: ethereum.Event,
  multisig: Multisig,
): void {
  // Process each agent associated with this multisig
  for (let i = 0; i < multisig.agentIds.length; i++) {
    const agentId = multisig.agentIds[i];
    const entity = getOrCreateDailyAgentPerformance(event, agentId);

    // CRITICAL: Validate that this entity belongs to the correct agent
    // This prevents cross-agent contamination
    if (entity.agentId != agentId) {
      log.error(
        'CRITICAL BUG: Agent ID mismatch! Entity {} has agentId {} but expected {}',
        [entity.id, entity.agentId.toString(), agentId.toString()],
      );
      // Skip this update to prevent data corruption
      continue;
    }

    // Increment transaction count for this agent
    entity.txCount = entity.txCount + 1;
    entity.save();

    createDailyAgentMultisig(entity, multisig);

    // Update global agent entity
    const agent = getOrCreateAgentPerformance(agentId);
    agent.txCount = agent.txCount.plus(BigInt.fromI32(1));
    agent.save();
  }
}

function updateDailyUniqueAgents(
  event: ethereum.Event,
  multisig: Multisig,
): void {
  const dailyUniqueAgents = getOrCreateDailyUniqueAgents(event);
  for (let i = 0; i < multisig.agentIds.length; i++) {
    const agentId = multisig.agentIds[i];
    const agent = getOrCreateAgentPerformance(agentId);
    createDailyUniqueAgent(dailyUniqueAgents, agent);
  }
}

function updateDailyActivity(
  service: Service,
  event: ethereum.Event,
  multisig: Multisig,
): void {
  const dailyActivity = getOrCreateDailyServiceActivity(service.id, event);
  dailyActivity.agentIds = multisig.agentIds;
  dailyActivity.save();
}

function updateDailyActiveMultisigs(
  event: ethereum.Event,
  multisig: Multisig,
): void {
  const dailyEntity = getOrCreateDailyActiveMultisigs(event);
  createDailyActiveMultisig(dailyEntity, multisig);
}

function updateGlobalMetrics(event: ethereum.Event): void {
  const global = getGlobal();
  global.txCount = global.txCount.plus(BigInt.fromI32(1));
  global.lastUpdated = event.block.timestamp;
  global.save();
}

export function handleCreateService(event: CreateService): void {
  let service = getOrCreateService(
    event.params.serviceId,
    event.block.timestamp,
  );
  service.configHash = event.params.configHash;
  service.save();
}

export function handleRegisterInstance(event: RegisterInstance): void {
  let service = getOrCreateService(event.params.serviceId);
  const newAgentId = event.params.agentId.toI32();

  // Track agent registration timestamp for later use in multisig creation
  createOrUpdateAgentRegistration(
    event.params.serviceId.toI32(),
    newAgentId,
    event.block.timestamp,
  );

  // Add agent if not already in the list to avoid duplicates
  if (!service.agentIds.includes(newAgentId)) {
    let agentIds = service.agentIds;
    agentIds.push(newAgentId);
    service.agentIds = agentIds;
  }
  service.save();

  // Track unique operators (updates Global.totalOperators on first seen)
  updateUniqueOperators(event.params.operator);
}

export function handleCreateMultisig(event: CreateMultisigWithAgents): void {
  let service = Service.load(event.params.serviceId.toString());

  if (service != null) {
    // Set creator's relationship with the service
    const creator = getOrCreateServiceCreator(event.transaction.from);
    service.creator = creator.id;

    const multisig = getOrCreateMultisig(event.params.multisig, event);
    service.multisig = multisig.id;
    service.save();

    GnosisSafeTemplate.create(event.params.multisig);

    multisig.serviceId = event.params.serviceId.toI32();
    multisig.txHash = event.transaction.hash;

    // Use the most recently registered agent instead of all agents
    // This matches the SQL query logic to prevent double counting
    const mostRecentAgentId = getMostRecentAgentId(
      event.params.serviceId.toI32(),
      service.agentIds,
      event.block.timestamp,
    );

    if (mostRecentAgentId != -1) {
      multisig.agentIds = [mostRecentAgentId];
    } else {
      // Fallback to existing logic if no agent found
      log.warning('No recent agent found for service {}, using all agents', [
        event.params.serviceId.toString(),
      ]);
      multisig.agentIds = service.agentIds;
    }

    multisig.save();
  }
}

export function handleTerminateService(event: TerminateService): void {
  let service = Service.load(event.params.serviceId.toString());
  if (service != null) {
    service.agentIds = [];
    service.multisig = null;
    service.creator = null;
    service.save();
  }
}

export function handleExecutionSuccess(event: ExecutionSuccess): void {
  let multisig = Multisig.load(event.address);
  if (multisig != null) {
    let service = Service.load(multisig.serviceId.toString());
    if (service != null) {
      updateDailyActivity(service, event, multisig);
      updateDailyUniqueAgents(event, multisig);
      updateDailyAgentPerformance(event, multisig);
      updateDailyActiveMultisigs(event, multisig);
      updateGlobalMetrics(event);
    } else {
      log.error('Service {} not found for multisig {}', [
        multisig.serviceId.toString(),
        event.address.toHexString(),
      ]);
    }
  }
}

export function handleExecutionFromModuleSuccess(
  event: ExecutionFromModuleSuccess,
): void {
  let multisig = Multisig.load(event.address);
  if (multisig != null) {
    let service = Service.load(multisig.serviceId.toString());
    if (service != null) {
      updateDailyActivity(service, event, multisig);
      updateDailyUniqueAgents(event, multisig);
      updateDailyAgentPerformance(event, multisig);
      updateDailyActiveMultisigs(event, multisig);
      updateGlobalMetrics(event);
    } else {
      log.error('Service {} not found for multisig {}', [
        multisig.serviceId.toString(),
        event.address.toHexString(),
      ]);
    }
  }
}

export function handleServiceAgentLinked(event: ServiceAgentLinked): void {
  let service = Service.load(event.params.serviceId.toString());
  if (service != null) {
    let agentId = event.params.agentId.toI32();
    let serviceId = event.params.serviceId.toI32();
    let erc8004Agent = getOrCreateERC8004Agent(agentId);
    service.erc8004Agent = erc8004Agent.id;
    service.save();
    initializeERC8004DefaultMetadata(agentId, serviceId);
  } else {
    log.warning('Service {} not found for ServiceAgentLinked event', [
      event.params.serviceId.toString(),
    ]);
  }
}

export function handleAgentWalletSet(event: AgentWalletSet): void {
  let agentId = event.params.agentId.toI32();
  let erc8004Agent = getOrCreateERC8004Agent(agentId);
  erc8004Agent.agentWallet = event.params.multisig;
  erc8004Agent.save();
}

export function handleMetadataSet(event: MetadataSet): void {
  let agentId = event.params.agentId.toI32();
  let metadata = getOrCreateERC8004Metadata(agentId, event.params.metadataKey);
  metadata.value = event.params.metadataValue;
  metadata.save();
}
