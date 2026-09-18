import { newMockEvent, createMockedFunction } from "matchstick-as/assembly/index"
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import { InstanceCreated } from "../generated/StakingFactory/StakingFactory"

export function createInstanceCreatedEvent(
  sender: Address,
  instance: Address,
  implementation: Address
): InstanceCreated {
  let instanceCreatedEvent = changetype<InstanceCreated>(newMockEvent())

  instanceCreatedEvent.parameters = new Array()

  instanceCreatedEvent.parameters.push(
    new ethereum.EventParam("sender", ethereum.Value.fromAddress(sender))
  )
  instanceCreatedEvent.parameters.push(
    new ethereum.EventParam("instance", ethereum.Value.fromAddress(instance))
  )
  instanceCreatedEvent.parameters.push(
    new ethereum.EventParam("implementation", ethereum.Value.fromAddress(implementation))
  )

  return instanceCreatedEvent
}

/**
 * Mock every getter `handleInstanceCreated` reads. Anything named in `reverting`
 * is mocked as a revert instead, so a partial implementation can be simulated.
 */
export function mockStakingProxyConfig(
  instance: Address,
  reverting: string[],
  stakingManager: Address | null,
  version: string = "0.2.0"
): void {
  let versionCall = createMockedFunction(instance, "VERSION", "VERSION():(string)")
  if (reverting.includes("VERSION")) {
    versionCall.reverts()
  } else {
    versionCall.returns([ethereum.Value.fromString(version)])
  }

  mockUint(instance, "maxNumServices", BigInt.fromI32(40), reverting)
  mockUint(instance, "rewardsPerSecond", BigInt.fromI32(100), reverting)
  mockUint(instance, "minStakingDeposit", BigInt.fromString("5000000000000000000000"), reverting)
  mockUint(instance, "minStakingDuration", BigInt.fromI32(1000), reverting)
  mockUint(instance, "maxNumInactivityPeriods", BigInt.fromI32(5), reverting)
  mockUint(instance, "livenessPeriod", BigInt.fromI32(86400), reverting)
  mockUint(instance, "timeForEmissions", BigInt.fromI32(2592000), reverting)
  mockUint(instance, "numAgentInstances", BigInt.fromI32(1), reverting)
  mockUint(instance, "threshold", BigInt.fromI32(2), reverting)

  mockBytes32(instance, "metadataHash", reverting)
  mockBytes32(instance, "configHash", reverting)
  mockBytes32(instance, "proxyHash", reverting)

  mockAddress(instance, "serviceRegistry", Address.fromString("0x0000000000000000000000000000000000000077"), reverting)
  mockAddress(instance, "activityChecker", Address.fromString("0x0000000000000000000000000000000000000078"), reverting)
  mockAddress(instance, "serviceRegistryTokenUtility", Address.fromString("0x0000000000000000000000000000000000000079"), reverting)
  // gnosis OLAS, matching the manifest network used by `yarn test`
  mockAddress(instance, "stakingToken", Address.fromString("0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f"), reverting)

  // getAgentIds returns uint256[]
  let agentIds = createMockedFunction(instance, "getAgentIds", "getAgentIds():(uint256[])")
  if (reverting.includes("getAgentIds")) {
    agentIds.reverts()
  } else {
    agentIds.returns([ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(25)])])
  }

  // Not exposed by every implementation
  let manager = createMockedFunction(instance, "stakingManager", "stakingManager():(address)")
  if (stakingManager === null) {
    manager.reverts()
  } else {
    manager.returns([ethereum.Value.fromAddress(stakingManager as Address)])
  }
}

function mockUint(instance: Address, name: string, value: BigInt, reverting: string[]): void {
  let fn = createMockedFunction(instance, name, name + "():(uint256)")
  if (reverting.includes(name)) {
    fn.reverts()
  } else {
    fn.returns([ethereum.Value.fromUnsignedBigInt(value)])
  }
}

function mockBytes32(instance: Address, name: string, reverting: string[]): void {
  let fn = createMockedFunction(instance, name, name + "():(bytes32)")
  if (reverting.includes(name)) {
    fn.reverts()
  } else {
    fn.returns([ethereum.Value.fromFixedBytes(Bytes.fromHexString("0x1111111111111111111111111111111111111111111111111111111111111111"))])
  }
}

function mockAddress(instance: Address, name: string, value: Address, reverting: string[]): void {
  let fn = createMockedFunction(instance, name, name + "():(address)")
  if (reverting.includes(name)) {
    fn.reverts()
  } else {
    fn.returns([ethereum.Value.fromAddress(value)])
  }
}

/**
 * Mock the on-chain deposit reads behind `readLockedOlas`: the service's security
 * deposit on the token utility, its agent ids on the registry, and a bond per agent.
 */
export function mockServiceDeposit(
  tokenUtility: Address,
  registry: Address,
  serviceId: BigInt,
  securityDeposit: BigInt,
  agentId: BigInt,
  slots: BigInt,
  bond: BigInt,
  reverting: string[] = []
): void {
  mockServiceDepositMulti(
    tokenUtility,
    registry,
    serviceId,
    securityDeposit,
    [agentId],
    [slots],
    [bond],
    reverting
  )
}

/** Same, for a service with more than one canonical agent id. */
export function mockServiceDepositMulti(
  tokenUtility: Address,
  registry: Address,
  serviceId: BigInt,
  securityDeposit: BigInt,
  agentIds: BigInt[],
  slots: BigInt[],
  bonds: BigInt[],
  reverting: string[] = []
): void {
  let depositCall = createMockedFunction(
    tokenUtility,
    "mapServiceIdTokenDeposit",
    "mapServiceIdTokenDeposit(uint256):(address,uint96)"
  ).withArgs([ethereum.Value.fromUnsignedBigInt(serviceId)])
  if (reverting.includes("mapServiceIdTokenDeposit")) {
    depositCall.reverts()
  } else {
    depositCall.returns([
      ethereum.Value.fromAddress(Address.fromString("0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f")),
      ethereum.Value.fromUnsignedBigInt(securityDeposit),
    ])
  }

  for (let i = 0; i < agentIds.length; i++) {
    let bondCall = createMockedFunction(
      tokenUtility,
      "getAgentBond",
      "getAgentBond(uint256,uint256):(uint256)"
    ).withArgs([
      ethereum.Value.fromUnsignedBigInt(serviceId),
      ethereum.Value.fromUnsignedBigInt(agentIds[i]),
    ])
    if (reverting.includes("getAgentBond")) {
      bondCall.reverts()
    } else {
      bondCall.returns([ethereum.Value.fromUnsignedBigInt(bonds[i])])
    }
  }

  let service = new ethereum.Tuple()
  service.push(ethereum.Value.fromUnsignedBigInt(securityDeposit))
  service.push(ethereum.Value.fromAddress(Address.fromString("0x0000000000000000000000000000000000000081")))
  service.push(ethereum.Value.fromFixedBytes(Bytes.fromHexString("0x2222222222222222222222222222222222222222222222222222222222222222")))
  service.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  service.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  service.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  service.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(4)))
  service.push(ethereum.Value.fromUnsignedBigIntArray(agentIds))
  let getServiceCall = createMockedFunction(
    registry,
    "getService",
    "getService(uint256):((uint96,address,bytes32,uint32,uint32,uint32,uint8,uint32[]))"
  ).withArgs([ethereum.Value.fromUnsignedBigInt(serviceId)])
  if (reverting.includes("getService")) {
    getServiceCall.reverts()
  } else {
    getServiceCall.returns([ethereum.Value.fromTuple(service)])
  }

  let tuples = new Array<ethereum.Tuple>()
  for (let i = 0; i < slots.length; i++) {
    let agentParams = new ethereum.Tuple()
    agentParams.push(ethereum.Value.fromUnsignedBigInt(slots[i]))
    agentParams.push(ethereum.Value.fromUnsignedBigInt(bonds[i]))
    tuples.push(agentParams)
  }
  let paramsCall = createMockedFunction(
    registry,
    "getAgentParams",
    "getAgentParams(uint256):(uint256,(uint32,uint96)[])"
  ).withArgs([ethereum.Value.fromUnsignedBigInt(serviceId)])
  if (reverting.includes("getAgentParams")) {
    paramsCall.reverts()
  } else {
    paramsCall.returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(agentIds.length)),
      ethereum.Value.fromTupleArray(tuples),
    ])
  }
}
