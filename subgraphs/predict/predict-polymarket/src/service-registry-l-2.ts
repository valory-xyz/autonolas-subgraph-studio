import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  CreateMultisigWithAgents as CreateMultisigWithAgentsEvent,
  RegisterInstance as RegisterInstanceEvent,
} from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import { TraderAgent, TraderService } from "../generated/schema";
import { getGlobal } from "./utils";
import { PREDICT_AGENT_ID } from "./constants";

export function handleRegisterInstance(event: RegisterInstanceEvent): void {
  let agentId = event.params.agentId.toI32();
  // Only create TraderService if it has relevant agent id
  // Allows then to track TraderAgent properly
  if (agentId !== PREDICT_AGENT_ID) return;
 
  let serviceId = Bytes.fromBigInt(event.params.serviceId);
  let traderService = TraderService.load(serviceId);
  if (traderService !== null) return;

  traderService = new TraderService(serviceId);
  traderService.save()
}

export function handleCreateMultisigWithAgents(
  event: CreateMultisigWithAgentsEvent
): void {
  // Skip non-trader services
  let traderService = TraderService.load(Bytes.fromBigInt(event.params.serviceId))
  if (traderService === null) return;
  
  let traderAgent = TraderAgent.load(event.params.multisig);
  if (traderAgent === null) {
    traderAgent = new TraderAgent(event.params.multisig);
    traderAgent.totalBets = 0;
    traderAgent.serviceId = event.params.serviceId;
    traderAgent.totalPayout = BigInt.zero();
    traderAgent.totalTraded = BigInt.zero();
    traderAgent.totalFees = BigInt.zero();

    traderAgent.blockNumber = event.block.number;
    traderAgent.blockTimestamp = event.block.timestamp;
    traderAgent.transactionHash = event.transaction.hash;

    traderAgent.save();

    let global = getGlobal();
    global.totalTraderAgents += 1;
    global.save();
  }
}
