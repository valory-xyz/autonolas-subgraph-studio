import { newMockEvent } from "matchstick-as/assembly/index"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  ServiceStaked,
  Checkpoint,
  ServiceUnstaked,
  ServiceForceUnstaked,
  RewardClaimed,
  ServicesEvicted,
} from "../generated/templates/StakingProxy/StakingProxy"

export function createServiceStakedEvent(
  serviceId: BigInt,
  epoch: BigInt,
  contractAddress: Address
): ServiceStaked {
  let serviceStakedEvent = changetype<ServiceStaked>(newMockEvent())

  serviceStakedEvent.address = contractAddress
  serviceStakedEvent.parameters = new Array()

  serviceStakedEvent.parameters.push(
    new ethereum.EventParam("epoch", ethereum.Value.fromUnsignedBigInt(epoch))
  )
  serviceStakedEvent.parameters.push(
    new ethereum.EventParam("serviceId", ethereum.Value.fromUnsignedBigInt(serviceId))
  )
  serviceStakedEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(Address.fromString("0x0000000000000000000000000000000000000099")))
  )
  serviceStakedEvent.parameters.push(
    new ethereum.EventParam("multisig", ethereum.Value.fromAddress(Address.fromString("0x0000000000000000000000000000000000000098")))
  )
  serviceStakedEvent.parameters.push(
    new ethereum.EventParam("nonces", ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(1)]))
  )

  return serviceStakedEvent
}

export function createCheckpointEvent(
  epoch: BigInt,
  serviceIds: BigInt[],
  rewards: BigInt[],
  contractAddress: Address
): Checkpoint {
  let checkpointEvent = changetype<Checkpoint>(newMockEvent())

  checkpointEvent.address = contractAddress
  checkpointEvent.parameters = new Array()

  checkpointEvent.parameters.push(
    new ethereum.EventParam("epoch", ethereum.Value.fromUnsignedBigInt(epoch))
  )
  checkpointEvent.parameters.push(
    new ethereum.EventParam("availableRewards", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10000)))
  )
  checkpointEvent.parameters.push(
    new ethereum.EventParam("serviceIds", ethereum.Value.fromUnsignedBigIntArray(serviceIds))
  )
  checkpointEvent.parameters.push(
    new ethereum.EventParam("rewards", ethereum.Value.fromUnsignedBigIntArray(rewards))
  )
  checkpointEvent.parameters.push(
    new ethereum.EventParam("epochLength", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(86400)))
  )

  return checkpointEvent
}

export function createServiceUnstakedEvent(
  serviceId: BigInt,
  epoch: BigInt,
  reward: BigInt,
  contractAddress: Address
): ServiceUnstaked {
  let serviceUnstakedEvent = changetype<ServiceUnstaked>(newMockEvent())

  serviceUnstakedEvent.address = contractAddress
  serviceUnstakedEvent.parameters = new Array()

  serviceUnstakedEvent.parameters.push(
    new ethereum.EventParam("epoch", ethereum.Value.fromUnsignedBigInt(epoch))
  )
  serviceUnstakedEvent.parameters.push(
    new ethereum.EventParam("serviceId", ethereum.Value.fromUnsignedBigInt(serviceId))
  )
  serviceUnstakedEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(Address.fromString("0x0000000000000000000000000000000000000099")))
  )
  serviceUnstakedEvent.parameters.push(
    new ethereum.EventParam("multisig", ethereum.Value.fromAddress(Address.fromString("0x0000000000000000000000000000000000000098")))
  )
  serviceUnstakedEvent.parameters.push(
    new ethereum.EventParam("nonces", ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(1)]))
  )
  serviceUnstakedEvent.parameters.push(
    new ethereum.EventParam("reward", ethereum.Value.fromUnsignedBigInt(reward))
  )
  serviceUnstakedEvent.parameters.push(
    new ethereum.EventParam("availableRewards", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10000)))
  )

  return serviceUnstakedEvent
}

export function createServiceForceUnstakedEvent(
  serviceId: BigInt,
  epoch: BigInt,
  reward: BigInt,
  contractAddress: Address
): ServiceForceUnstaked {
  let serviceForceUnstakedEvent = changetype<ServiceForceUnstaked>(newMockEvent())

  serviceForceUnstakedEvent.address = contractAddress
  serviceForceUnstakedEvent.parameters = new Array()

  serviceForceUnstakedEvent.parameters.push(
    new ethereum.EventParam("epoch", ethereum.Value.fromUnsignedBigInt(epoch))
  )
  serviceForceUnstakedEvent.parameters.push(
    new ethereum.EventParam("serviceId", ethereum.Value.fromUnsignedBigInt(serviceId))
  )
  serviceForceUnstakedEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(Address.fromString("0x0000000000000000000000000000000000000099")))
  )
  serviceForceUnstakedEvent.parameters.push(
    new ethereum.EventParam("multisig", ethereum.Value.fromAddress(Address.fromString("0x0000000000000000000000000000000000000098")))
  )
  serviceForceUnstakedEvent.parameters.push(
    new ethereum.EventParam("nonces", ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(1)]))
  )
  serviceForceUnstakedEvent.parameters.push(
    new ethereum.EventParam("reward", ethereum.Value.fromUnsignedBigInt(reward))
  )
  serviceForceUnstakedEvent.parameters.push(
    new ethereum.EventParam("availableRewards", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10000)))
  )

  return serviceForceUnstakedEvent
}

export function createRewardClaimedEvent(
  serviceId: BigInt,
  epoch: BigInt,
  reward: BigInt,
  contractAddress: Address
): RewardClaimed {
  let rewardClaimedEvent = changetype<RewardClaimed>(newMockEvent())

  rewardClaimedEvent.address = contractAddress
  rewardClaimedEvent.parameters = new Array()

  rewardClaimedEvent.parameters.push(
    new ethereum.EventParam("epoch", ethereum.Value.fromUnsignedBigInt(epoch))
  )
  rewardClaimedEvent.parameters.push(
    new ethereum.EventParam("serviceId", ethereum.Value.fromUnsignedBigInt(serviceId))
  )
  rewardClaimedEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(Address.fromString("0x0000000000000000000000000000000000000099")))
  )
  rewardClaimedEvent.parameters.push(
    new ethereum.EventParam("multisig", ethereum.Value.fromAddress(Address.fromString("0x0000000000000000000000000000000000000098")))
  )
  rewardClaimedEvent.parameters.push(
    new ethereum.EventParam("nonces", ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(1)]))
  )
  rewardClaimedEvent.parameters.push(
    new ethereum.EventParam("reward", ethereum.Value.fromUnsignedBigInt(reward))
  )

  return rewardClaimedEvent
}

export function createServicesEvictedEvent(
  epoch: BigInt,
  serviceIds: BigInt[],
  contractAddress: Address
): ServicesEvicted {
  let servicesEvictedEvent = changetype<ServicesEvicted>(newMockEvent())

  servicesEvictedEvent.address = contractAddress
  servicesEvictedEvent.parameters = new Array()

  // Mock addresses for arrays
  let mockOwner = Address.fromString("0x0000000000000000000000000000000000000099")
  let mockMultisig = Address.fromString("0x0000000000000000000000000000000000000098")
  
  let owners = new Array<Address>()
  let multisigs = new Array<Address>()
  let inactivity = new Array<BigInt>()
  
  for (let i = 0; i < serviceIds.length; i++) {
    owners.push(mockOwner)
    multisigs.push(mockMultisig)
    inactivity.push(BigInt.fromI32(1))
  }

  servicesEvictedEvent.parameters.push(
    new ethereum.EventParam("epoch", ethereum.Value.fromUnsignedBigInt(epoch))
  )
  servicesEvictedEvent.parameters.push(
    new ethereum.EventParam("serviceIds", ethereum.Value.fromUnsignedBigIntArray(serviceIds))
  )
  servicesEvictedEvent.parameters.push(
    new ethereum.EventParam("owners", ethereum.Value.fromAddressArray(owners))
  )
  servicesEvictedEvent.parameters.push(
    new ethereum.EventParam("multisigs", ethereum.Value.fromAddressArray(multisigs))
  )
  servicesEvictedEvent.parameters.push(
    new ethereum.EventParam("serviceInactivity", ethereum.Value.fromUnsignedBigIntArray(inactivity))
  )

  return servicesEvictedEvent
}