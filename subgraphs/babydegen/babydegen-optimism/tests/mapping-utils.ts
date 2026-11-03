import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  RegisterInstance,
  CreateMultisigWithAgents
} from "../generated/ServiceRegistryL2/ServiceRegistryL2"
import { Transfer as V2Transfer } from "../generated/templates/VeloV2Pool/VelodromeV2Pool"
import { Transfer as NFTTransfer } from "../generated/VeloNFTManager/VelodromePositionNFTManager"
import { IncreaseLiquidity as AeroIncreaseLiquidity } from "../generated/AeroNFTManager/AeroPositionNFTManager"
import { PoolCreated as AeroV2PoolCreated } from "../generated/AeroV2StableFactory/AeroV2PoolFactory"
import { GaugeCreated } from "../generated/AeroGaugeManager/AeroGaugeManager"
import { Mint as AeroV2Mint } from "../generated/templates/AeroV2Pool/AeroV2Pool"

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
 * Creates a mock VelodromeV2Pool (Velodrome v2) LP Transfer event.
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
 * Creates a mock CL NFPM Transfer event (Slipstream or Aero — same signature).
 *
 * Solidity signature:
 *   Transfer(indexed address from, indexed address to, indexed uint256 tokenId)
 */
export function createNFTTransferEvent(
  manager: Address,
  from: Address,
  to: Address,
  tokenId: BigInt
): NFTTransfer {
  let event = changetype<NFTTransfer>(newMockEvent())
  event.address = manager
  event.parameters = new Array()

  event.parameters.push(new ethereum.EventParam("from", ethereum.Value.fromAddress(from)))
  event.parameters.push(new ethereum.EventParam("to", ethereum.Value.fromAddress(to)))
  event.parameters.push(new ethereum.EventParam("tokenId", ethereum.Value.fromUnsignedBigInt(tokenId)))

  return event
}

/**
 * Creates a mock Aero NFPM IncreaseLiquidity event.
 *
 * Solidity signature:
 *   IncreaseLiquidity(indexed uint256 tokenId, uint128 liquidity, uint256 amount0,
 *                     uint256 amount1, int24 tickLower, int24 tickUpper)
 */
export function createAeroIncreaseLiquidityEvent(
  manager: Address,
  tokenId: BigInt,
  liquidity: BigInt,
  amount0: BigInt,
  amount1: BigInt,
  tickLower: i32,
  tickUpper: i32
): AeroIncreaseLiquidity {
  let event = changetype<AeroIncreaseLiquidity>(newMockEvent())
  event.address = manager
  event.parameters = new Array()

  event.parameters.push(new ethereum.EventParam("tokenId", ethereum.Value.fromUnsignedBigInt(tokenId)))
  event.parameters.push(new ethereum.EventParam("liquidity", ethereum.Value.fromUnsignedBigInt(liquidity)))
  event.parameters.push(new ethereum.EventParam("amount0", ethereum.Value.fromUnsignedBigInt(amount0)))
  event.parameters.push(new ethereum.EventParam("amount1", ethereum.Value.fromUnsignedBigInt(amount1)))
  event.parameters.push(new ethereum.EventParam("tickLower", ethereum.Value.fromI32(tickLower)))
  event.parameters.push(new ethereum.EventParam("tickUpper", ethereum.Value.fromI32(tickUpper)))

  return event
}

/**
 * Creates a mock Aero v2 factory PoolCreated event.
 *
 * Solidity signature:
 *   PoolCreated(indexed address token0, indexed address token1, address pool, uint256)
 */
export function createAeroV2PoolCreatedEvent(
  factory: Address,
  token0: Address,
  token1: Address,
  pool: Address
): AeroV2PoolCreated {
  let event = changetype<AeroV2PoolCreated>(newMockEvent())
  event.address = factory
  event.parameters = new Array()

  event.parameters.push(new ethereum.EventParam("token0", ethereum.Value.fromAddress(token0)))
  event.parameters.push(new ethereum.EventParam("token1", ethereum.Value.fromAddress(token1)))
  event.parameters.push(new ethereum.EventParam("pool", ethereum.Value.fromAddress(pool)))
  event.parameters.push(new ethereum.EventParam("", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))))

  return event
}

/**
 * Creates a mock Aero GaugeManager GaugeCreated event.
 *
 * Solidity signature:
 *   GaugeCreated(indexed address _target, indexed address _gauge, indexed address _module,
 *                address _gaugeFactory, address _votingRewardsManager, address _creator, bool _activated)
 */
export function createGaugeCreatedEvent(target: Address, gauge: Address): GaugeCreated {
  let event = changetype<GaugeCreated>(newMockEvent())
  event.parameters = new Array()

  event.parameters.push(new ethereum.EventParam("_target", ethereum.Value.fromAddress(target)))
  event.parameters.push(new ethereum.EventParam("_gauge", ethereum.Value.fromAddress(gauge)))
  event.parameters.push(new ethereum.EventParam("_module", ethereum.Value.fromAddress(Address.zero())))
  event.parameters.push(new ethereum.EventParam("_gaugeFactory", ethereum.Value.fromAddress(Address.zero())))
  event.parameters.push(new ethereum.EventParam("_votingRewardsManager", ethereum.Value.fromAddress(Address.zero())))
  event.parameters.push(new ethereum.EventParam("_creator", ethereum.Value.fromAddress(Address.zero())))
  event.parameters.push(new ethereum.EventParam("_activated", ethereum.Value.fromBoolean(true)))

  return event
}

/**
 * Creates a mock Aero v2 pool Mint event.
 *
 * Solidity signature:
 *   Mint(indexed address sender, indexed address to, uint256 amount0, uint256 amount1)
 */
export function createAeroV2MintEvent(
  pool: Address,
  sender: Address,
  to: Address,
  amount0: BigInt,
  amount1: BigInt
): AeroV2Mint {
  let event = changetype<AeroV2Mint>(newMockEvent())
  event.address = pool
  event.parameters = new Array()

  event.parameters.push(new ethereum.EventParam("sender", ethereum.Value.fromAddress(sender)))
  event.parameters.push(new ethereum.EventParam("to", ethereum.Value.fromAddress(to)))
  event.parameters.push(new ethereum.EventParam("amount0", ethereum.Value.fromUnsignedBigInt(amount0)))
  event.parameters.push(new ethereum.EventParam("amount1", ethereum.Value.fromUnsignedBigInt(amount1)))

  return event
}
