import { BigInt } from "@graphprotocol/graph-ts";
import {
  CreateMultisigWithAgents as CreateMultisigWithAgentsEvent,
  RegisterInstance as RegisterInstanceEvent,
} from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import { TraderAgent, TraderService } from "../generated/schema";
import { getGlobal } from "./utils";
import { PREDICT_AGENT_IDS } from "./constants";

export function handleRegisterInstance(event: RegisterInstanceEvent): void {
  let agentId = event.params.agentId.toI32();
  if (PREDICT_AGENT_IDS.indexOf(agentId) === -1) return;

  let serviceId = event.params.serviceId.toHexString();
  let traderService = TraderService.load(serviceId);
  if (traderService !== null) return;

  traderService = new TraderService(serviceId);
  traderService.save();
}

export function handleCreateMultisigWithAgents(
  event: CreateMultisigWithAgentsEvent
): void {
  let traderService = TraderService.load(event.params.serviceId.toHexString());
  if (traderService === null) return;

  let traderAgent = TraderAgent.load(event.params.multisig);
  if (traderAgent === null) {
    traderAgent = new TraderAgent(event.params.multisig);
    traderAgent.totalBets = 0;
    traderAgent.serviceId = event.params.serviceId;
    traderAgent.totalPayout = BigInt.zero();
    traderAgent.totalTraded = BigInt.zero();
    traderAgent.totalFees = BigInt.zero();
    traderAgent.totalTradedSettled = BigInt.zero();
    traderAgent.totalFeesSettled = BigInt.zero();
    traderAgent.totalExpectedPayout = BigInt.zero();

    traderAgent.blockNumber = event.block.number;
    traderAgent.blockTimestamp = event.block.timestamp;
    traderAgent.transactionHash = event.transaction.hash;

    traderAgent.save();

    let global = getGlobal();
    global.totalTraderAgents += 1;
    global.save();
  }
}
