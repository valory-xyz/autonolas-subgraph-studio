import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  RegisterInstance,
  CreateMultisigWithAgents
} from "../generated/ServiceRegistryL2/ServiceRegistryL2"

/**
 * Creates a mock RegisterInstance event.
 *
 * Solidity signature:
 *   RegisterInstance(indexed address operator, indexed uint256 serviceId,
 *                    indexed address agentInstance, uint256 agentId)
 */
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

/**
 * Creates a mock CreateMultisigWithAgents event.
 *
 * Solidity signature:
 *   CreateMultisigWithAgents(indexed uint256 serviceId, indexed address multisig)
 */
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
