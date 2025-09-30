import { BigInt, ethereum, Bytes } from "@graphprotocol/graph-ts";
import {
  AgentPerformance,
  AgentRegistration,
  DailyActiveMultisig,
  DailyActiveMultisigs,
  DailyAgentMultisig,
  DailyAgentPerformance,
  DailyServiceActivity,
  DailyUniqueAgent,
  DailyUniqueAgents,
  Global,
  Multisig,
  Service,
  Operator,
} from "./generated/schema";

const ONE_DAY = BigInt.fromI32(86400);

export function getDayTimestamp(event: ethereum.Event): BigInt {
  return event.block.timestamp.div(ONE_DAY).times(ONE_DAY);
}

export function getOrCreateService(serviceId: BigInt): Service {
  let service = Service.load(serviceId.toString());
  if (service == null) {
    service = new Service(serviceId.toString());
    service.agentIds = [];
    service.save();
  }
  return service;
}

export function getOrCreateMultisig(
  multisigAddress: Bytes,
  event: ethereum.Event
): Multisig {
  let multisig = Multisig.load(multisigAddress);
  if (multisig == null) {
    multisig = new Multisig(multisigAddress);
    multisig.creator = event.transaction.from;
    multisig.creationTimestamp = event.block.timestamp;
    multisig.agentIds = [];
    multisig.serviceId = 0;
    multisig.txHash = event.transaction.hash;
    multisig.save();
  }
  return multisig;
}

export function getOrCreateDailyServiceActivity(
  serviceId: string,
  event: ethereum.Event
): DailyServiceActivity {
  const dayTimestamp = getDayTimestamp(event);
  const id = "day-"
    .concat(dayTimestamp.toString())
    .concat("-service-")
    .concat(serviceId);
  let dailyActivity = DailyServiceActivity.load(id);
  if (dailyActivity == null) {
    dailyActivity = new DailyServiceActivity(id);
    dailyActivity.service = serviceId;
    dailyActivity.dayTimestamp = dayTimestamp;
    dailyActivity.agentIds = [];
    dailyActivity.save();
  }
  return dailyActivity;
}

export function getOrCreateDailyUniqueAgents(
  event: ethereum.Event
): DailyUniqueAgents {
  const dayTimestamp = getDayTimestamp(event);
  const id = "day-".concat(dayTimestamp.toString());
  let dailyUniqueAgents = DailyUniqueAgents.load(id);
  if (dailyUniqueAgents == null) {
    dailyUniqueAgents = new DailyUniqueAgents(id);
    dailyUniqueAgents.dayTimestamp = dayTimestamp;
    dailyUniqueAgents.count = 0;
    dailyUniqueAgents.save();
  }
  return dailyUniqueAgents;
}

export function getOrCreateDailyAgentPerformance(
  event: ethereum.Event,
  agentId: i32
): DailyAgentPerformance {
  const dayTimestamp = getDayTimestamp(event);
  const id = "day-"
    .concat(dayTimestamp.toString())
    .concat("-agent-")
    .concat(agentId.toString());
  let entity = DailyAgentPerformance.load(id);
  if (entity == null) {
    entity = new DailyAgentPerformance(id);
    entity.agentId = agentId;
    entity.dayTimestamp = dayTimestamp;
    entity.txCount = 0;
    entity.activeMultisigCount = 0;
    entity.save();
  }
  return entity;
}

export function getOrCreateDailyActiveMultisigs(
  event: ethereum.Event
): DailyActiveMultisigs {
  const dayTimestamp = getDayTimestamp(event);
  const dailyId = "day-" + dayTimestamp.toString();
  let dailyEntity = DailyActiveMultisigs.load(dailyId);
  if (dailyEntity == null) {
    dailyEntity = new DailyActiveMultisigs(dailyId);
    dailyEntity.dayTimestamp = dayTimestamp;
    dailyEntity.count = 0;
    dailyEntity.save();
  }
  return dailyEntity;
}

export function getGlobal(): Global {
  let global = Global.load("");
  if (global == null) {
    global = new Global("");
    global.txCount = BigInt.fromI32(0);
    global.lastUpdated = BigInt.fromI32(0);
    global.totalOperators = 0;
    global.save();
  }
  return global;
}

export function getOrCreateAgentPerformance(
  agentId: i32
): AgentPerformance {
  let agent = AgentPerformance.load(agentId.toString());
  if (agent == null) {
    agent = new AgentPerformance(agentId.toString());
    agent.txCount = BigInt.fromI32(0);
    agent.save();
  }
  return agent;
}

export function getOrCreateOperator(operatorAddress: Bytes): Operator {
  let operator = Operator.load(operatorAddress);
  if (operator == null) {
    operator = new Operator(operatorAddress);
    operator.save();
  }
  return operator;
}

export function updateUniqueOperators(operatorAddress: Bytes): void {
  let existed = Operator.load(operatorAddress);
  if (existed == null) {
    // Create then increment global unique operators
    getOrCreateOperator(operatorAddress);
    const global = getGlobal();
    global.totalOperators = global.totalOperators + 1;
    global.save();
  }
}

export function createDailyUniqueAgent(
  dailyUniqueAgents: DailyUniqueAgents,
  agent: AgentPerformance
): void {
  // Links an agent to the daily unique agents list for deduplication
  // Ensures each agent is counted only once per day, regardless of how many transactions they made
  // Updates the daily unique agent count automatically
  const id = dailyUniqueAgents.id
    .concat("-")
    .concat(agent.id);
  let dailyUniqueAgent = DailyUniqueAgent.load(id);
  if (dailyUniqueAgent == null) {
    dailyUniqueAgent = new DailyUniqueAgent(id);
    dailyUniqueAgent.dailyUniqueAgents = dailyUniqueAgents.id;
    dailyUniqueAgent.agent = agent.id;
    dailyUniqueAgent.save();

    dailyUniqueAgents.count = dailyUniqueAgents.count + 1;
    dailyUniqueAgents.save();
  }
}

export function createDailyAgentMultisig(
  dailyAgentPerformance: DailyAgentPerformance,
  multisig: Multisig
): void {
  // Tracks which multisigs a specific agent was active in on a given day (agent-centric view)
  // Example: Agent 40 worked with Multisig A and B today, so we create 2 links
  // Used for agent performance analytics: "How many different multisigs did this agent work with?"
  const id = dailyAgentPerformance.id
    .concat("-")
    .concat(multisig.id.toHexString());
  let dailyAgentMultisig = DailyAgentMultisig.load(id);
  if (dailyAgentMultisig == null) {
    dailyAgentMultisig = new DailyAgentMultisig(id);
    dailyAgentMultisig.dailyAgentPerformance = dailyAgentPerformance.id;
    dailyAgentMultisig.multisig = multisig.id;
    dailyAgentMultisig.save();

    dailyAgentPerformance.activeMultisigCount =
      dailyAgentPerformance.activeMultisigCount + 1;
    dailyAgentPerformance.save();
  }
}

export function createDailyActiveMultisig(
  dailyActiveMultisigs: DailyActiveMultisigs,
  multisig: Multisig
): void {
  // Tracks which multisigs had any activity at all on a given day (system-wide view)
  // Example: Today Multisig A and B were active, regardless of which agents used them
  // Used for system analytics: "How many total multisigs were active today?"
  const id = dailyActiveMultisigs.id
    .concat("-")
    .concat(multisig.id.toHexString());
  let dailyActiveMultisig = DailyActiveMultisig.load(id);
  if (dailyActiveMultisig == null) {
    dailyActiveMultisig = new DailyActiveMultisig(id);
    dailyActiveMultisig.dailyActiveMultisigs = dailyActiveMultisigs.id;
    dailyActiveMultisig.multisig = multisig.id;
    dailyActiveMultisig.save();

    dailyActiveMultisigs.count = dailyActiveMultisigs.count + 1;
    dailyActiveMultisigs.save();
  }
}

export function createOrUpdateAgentRegistration(
  serviceId: i32,
  agentId: i32,
  timestamp: BigInt
): void {
  const id = serviceId.toString().concat("-").concat(agentId.toString());
  let registration = AgentRegistration.load(id);
  if (registration == null) {
    registration = new AgentRegistration(id);
  }
  registration.serviceId = serviceId;
  registration.agentId = agentId;
  registration.registrationTimestamp = timestamp;
  registration.save();
}

export function getMostRecentAgentId(
  serviceId: i32,
  agentIds: i32[],
  deploymentTimestamp: BigInt
): i32 {
  // Find the agent that was registered most recently before the multisig deployment
  // This matches the SQL query logic: order by registered_at desc, rn = 1

  let mostRecentAgentId: i32 = -1;
  let mostRecentTimestamp = BigInt.fromI32(0);

  // We need to iterate through all possible agent registrations for this service
  // Since we can't do complex queries in AssemblyScript, we'll check common agent IDs
  // This is a limitation but should cover most cases
  for (let i = 0; i < agentIds.length; i++) {
    const agentId = agentIds[i];
    const registrationId = serviceId
      .toString()
      .concat("-")
      .concat(agentId.toString());
    const registration = AgentRegistration.load(registrationId);

    if (
      registration != null &&
      registration.registrationTimestamp <= deploymentTimestamp &&
      registration.registrationTimestamp > mostRecentTimestamp
    ) {
      mostRecentAgentId = agentId;
      mostRecentTimestamp = registration.registrationTimestamp;
    }
  }

  return mostRecentAgentId;
}
