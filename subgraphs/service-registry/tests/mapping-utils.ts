import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  CreateService,
  UpdateService,
  RegisterInstance,
  CreateMultisigWithAgents,
  TerminateService,
} from "../generated/ServiceRegistryL2/ServiceRegistryL2"

export function createCreateServiceEvent(
  serviceId: BigInt,
  configHash: Bytes
): CreateService {
  let event = changetype<CreateService>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  )
  event.parameters.push(
    new ethereum.EventParam(
      "configHash",
      ethereum.Value.fromFixedBytes(configHash)
    )
  )
  return event
}

export function createUpdateServiceEvent(
  serviceId: BigInt,
  configHash: Bytes
): UpdateService {
  let event = changetype<UpdateService>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  )
  event.parameters.push(
    new ethereum.EventParam(
      "configHash",
      ethereum.Value.fromFixedBytes(configHash)
    )
  )
  return event
}

export function createRegisterInstanceEvent(
  operator: Address,
  serviceId: BigInt,
  agentInstance: Address,
  agentId: BigInt
): RegisterInstance {
  let event = changetype<RegisterInstance>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam(
      "operator",
      ethereum.Value.fromAddress(operator)
    )
  )
  event.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  )
  event.parameters.push(
    new ethereum.EventParam(
      "agentInstance",
      ethereum.Value.fromAddress(agentInstance)
    )
  )
  event.parameters.push(
    new ethereum.EventParam(
      "agentId",
      ethereum.Value.fromUnsignedBigInt(agentId)
    )
  )
  return event
}

export function createCreateMultisigWithAgentsEvent(
  serviceId: BigInt,
  multisig: Address
): CreateMultisigWithAgents {
  let event = changetype<CreateMultisigWithAgents>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  )
  event.parameters.push(
    new ethereum.EventParam(
      "multisig",
      ethereum.Value.fromAddress(multisig)
    )
  )
  return event
}

export function createTerminateServiceEvent(
  serviceId: BigInt
): TerminateService {
  let event = changetype<TerminateService>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(
    new ethereum.EventParam(
      "serviceId",
      ethereum.Value.fromUnsignedBigInt(serviceId)
    )
  )
  return event
}
