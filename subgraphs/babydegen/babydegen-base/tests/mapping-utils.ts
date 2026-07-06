import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  RegisterInstance,
  CreateMultisigWithAgents
} from "../generated/ServiceRegistryL2/ServiceRegistryL2"
import {
  Transfer as V2Transfer,
  Mint as V2Mint
} from "../generated/templates/VeloV2Pool/VelodromeV2Pool"

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

/**
 * Creates a mock VelodromeV2Pool (Aerodrome v2) LP Transfer event.
 *
 * Solidity signature:
 *   Transfer(indexed address from, indexed address to, uint256 value)
 */
export function createV2TransferEvent(
  pool: Address,
  from: Address,
  to: Address,
  value: BigInt
): V2Transfer {
  let event = changetype<V2Transfer>(newMockEvent())
  event.address = pool
  event.parameters = new Array()

  event.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from))
  )
  event.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to))
  )
  event.parameters.push(
    new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(value))
  )

  return event
}

/**
 * Creates a mock VelodromeV2Pool (Aerodrome v2) Mint event.
 *
 * Solidity signature:
 *   Mint(indexed address sender, uint256 amount0, uint256 amount1)
 */
export function createV2MintEvent(
  pool: Address,
  sender: Address,
  amount0: BigInt,
  amount1: BigInt
): V2Mint {
  let event = changetype<V2Mint>(newMockEvent())
  event.address = pool
  event.parameters = new Array()

  event.parameters.push(
    new ethereum.EventParam("sender", ethereum.Value.fromAddress(sender))
  )
  event.parameters.push(
    new ethereum.EventParam("amount0", ethereum.Value.fromUnsignedBigInt(amount0))
  )
  event.parameters.push(
    new ethereum.EventParam("amount1", ethereum.Value.fromUnsignedBigInt(amount1))
  )

  return event
}
