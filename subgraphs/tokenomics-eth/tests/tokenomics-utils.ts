import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  AgentRegistryUpdated,
  ComponentRegistryUpdated,
  DepositoryUpdated,
  DispenserUpdated,
  DonatorBlacklistUpdated,
  EffectiveBondUpdated,
  EpochLengthUpdated,
  EpochSettled,
  IDFUpdated,
  IncentiveFractionsUpdateRequested,
  IncentiveFractionsUpdated,
  OwnerUpdated,
  ServiceRegistryUpdated,
  StakingParamsUpdateRequested,
  StakingParamsUpdated,
  StakingRefunded,
  TokenomicsImplementationUpdated,
  TokenomicsParametersUpdateRequested,
  TokenomicsParametersUpdated,
  TreasuryUpdated
} from "../generated/Tokenomics/Tokenomics"

export function createAgentRegistryUpdatedEvent(
  agentRegistry: Address
): AgentRegistryUpdated {
  let agentRegistryUpdatedEvent = changetype<AgentRegistryUpdated>(
    newMockEvent()
  )

  agentRegistryUpdatedEvent.parameters = new Array()

  agentRegistryUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "agentRegistry",
      ethereum.Value.fromAddress(agentRegistry)
    )
  )

  return agentRegistryUpdatedEvent
}

export function createComponentRegistryUpdatedEvent(
  componentRegistry: Address
): ComponentRegistryUpdated {
  let componentRegistryUpdatedEvent = changetype<ComponentRegistryUpdated>(
    newMockEvent()
  )

  componentRegistryUpdatedEvent.parameters = new Array()

  componentRegistryUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "componentRegistry",
      ethereum.Value.fromAddress(componentRegistry)
    )
  )

  return componentRegistryUpdatedEvent
}

export function createDepositoryUpdatedEvent(
  depository: Address
): DepositoryUpdated {
  let depositoryUpdatedEvent = changetype<DepositoryUpdated>(newMockEvent())

  depositoryUpdatedEvent.parameters = new Array()

  depositoryUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "depository",
      ethereum.Value.fromAddress(depository)
    )
  )

  return depositoryUpdatedEvent
}

export function createDispenserUpdatedEvent(
  dispenser: Address
): DispenserUpdated {
  let dispenserUpdatedEvent = changetype<DispenserUpdated>(newMockEvent())

  dispenserUpdatedEvent.parameters = new Array()

  dispenserUpdatedEvent.parameters.push(
    new ethereum.EventParam("dispenser", ethereum.Value.fromAddress(dispenser))
  )

  return dispenserUpdatedEvent
}

export function createDonatorBlacklistUpdatedEvent(
  blacklist: Address
): DonatorBlacklistUpdated {
  let donatorBlacklistUpdatedEvent = changetype<DonatorBlacklistUpdated>(
    newMockEvent()
  )

  donatorBlacklistUpdatedEvent.parameters = new Array()

  donatorBlacklistUpdatedEvent.parameters.push(
    new ethereum.EventParam("blacklist", ethereum.Value.fromAddress(blacklist))
  )

  return donatorBlacklistUpdatedEvent
}

export function createEffectiveBondUpdatedEvent(
  epochNumber: BigInt,
  effectiveBond: BigInt
): EffectiveBondUpdated {
  let effectiveBondUpdatedEvent = changetype<EffectiveBondUpdated>(
    newMockEvent()
  )

  effectiveBondUpdatedEvent.parameters = new Array()

  effectiveBondUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "epochNumber",
      ethereum.Value.fromUnsignedBigInt(epochNumber)
    )
  )
  effectiveBondUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "effectiveBond",
      ethereum.Value.fromUnsignedBigInt(effectiveBond)
    )
  )

  return effectiveBondUpdatedEvent
}

export function createEpochLengthUpdatedEvent(
  epochLen: BigInt
): EpochLengthUpdated {
  let epochLengthUpdatedEvent = changetype<EpochLengthUpdated>(newMockEvent())

  epochLengthUpdatedEvent.parameters = new Array()

  epochLengthUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "epochLen",
      ethereum.Value.fromUnsignedBigInt(epochLen)
    )
  )

  return epochLengthUpdatedEvent
}

export function createEpochSettledEvent(
  epochCounter: BigInt,
  treasuryRewards: BigInt,
  accountRewards: BigInt,
  accountTopUps: BigInt,
  effectiveBond: BigInt,
  returnedStakingIncentive: BigInt,
  totalStakingIncentive: BigInt
): EpochSettled {
  let epochSettledEvent = changetype<EpochSettled>(newMockEvent())

  epochSettledEvent.parameters = new Array()

  epochSettledEvent.parameters.push(
    new ethereum.EventParam(
      "epochCounter",
      ethereum.Value.fromUnsignedBigInt(epochCounter)
    )
  )
  epochSettledEvent.parameters.push(
    new ethereum.EventParam(
      "treasuryRewards",
      ethereum.Value.fromUnsignedBigInt(treasuryRewards)
    )
  )
  epochSettledEvent.parameters.push(
    new ethereum.EventParam(
      "accountRewards",
      ethereum.Value.fromUnsignedBigInt(accountRewards)
    )
  )
  epochSettledEvent.parameters.push(
    new ethereum.EventParam(
      "accountTopUps",
      ethereum.Value.fromUnsignedBigInt(accountTopUps)
    )
  )
  epochSettledEvent.parameters.push(
    new ethereum.EventParam(
      "effectiveBond",
      ethereum.Value.fromUnsignedBigInt(effectiveBond)
    )
  )
  epochSettledEvent.parameters.push(
    new ethereum.EventParam(
      "returnedStakingIncentive",
      ethereum.Value.fromUnsignedBigInt(returnedStakingIncentive)
    )
  )
  epochSettledEvent.parameters.push(
    new ethereum.EventParam(
      "totalStakingIncentive",
      ethereum.Value.fromUnsignedBigInt(totalStakingIncentive)
    )
  )

  return epochSettledEvent
}

export function createIDFUpdatedEvent(idf: BigInt): IDFUpdated {
  let idfUpdatedEvent = changetype<IDFUpdated>(newMockEvent())

  idfUpdatedEvent.parameters = new Array()

  idfUpdatedEvent.parameters.push(
    new ethereum.EventParam("idf", ethereum.Value.fromUnsignedBigInt(idf))
  )

  return idfUpdatedEvent
}

export function createIncentiveFractionsUpdateRequestedEvent(
  epochNumber: BigInt,
  rewardComponentFraction: BigInt,
  rewardAgentFraction: BigInt,
  maxBondFraction: BigInt,
  topUpComponentFraction: BigInt,
  topUpAgentFraction: BigInt,
  stakingFraction: BigInt
): IncentiveFractionsUpdateRequested {
  let incentiveFractionsUpdateRequestedEvent =
    changetype<IncentiveFractionsUpdateRequested>(newMockEvent())

  incentiveFractionsUpdateRequestedEvent.parameters = new Array()

  incentiveFractionsUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "epochNumber",
      ethereum.Value.fromUnsignedBigInt(epochNumber)
    )
  )
  incentiveFractionsUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "rewardComponentFraction",
      ethereum.Value.fromUnsignedBigInt(rewardComponentFraction)
    )
  )
  incentiveFractionsUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "rewardAgentFraction",
      ethereum.Value.fromUnsignedBigInt(rewardAgentFraction)
    )
  )
  incentiveFractionsUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "maxBondFraction",
      ethereum.Value.fromUnsignedBigInt(maxBondFraction)
    )
  )
  incentiveFractionsUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "topUpComponentFraction",
      ethereum.Value.fromUnsignedBigInt(topUpComponentFraction)
    )
  )
  incentiveFractionsUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "topUpAgentFraction",
      ethereum.Value.fromUnsignedBigInt(topUpAgentFraction)
    )
  )
  incentiveFractionsUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "stakingFraction",
      ethereum.Value.fromUnsignedBigInt(stakingFraction)
    )
  )

  return incentiveFractionsUpdateRequestedEvent
}

export function createIncentiveFractionsUpdatedEvent(
  epochNumber: BigInt
): IncentiveFractionsUpdated {
  let incentiveFractionsUpdatedEvent = changetype<IncentiveFractionsUpdated>(
    newMockEvent()
  )

  incentiveFractionsUpdatedEvent.parameters = new Array()

  incentiveFractionsUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "epochNumber",
      ethereum.Value.fromUnsignedBigInt(epochNumber)
    )
  )

  return incentiveFractionsUpdatedEvent
}

export function createOwnerUpdatedEvent(owner: Address): OwnerUpdated {
  let ownerUpdatedEvent = changetype<OwnerUpdated>(newMockEvent())

  ownerUpdatedEvent.parameters = new Array()

  ownerUpdatedEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  )

  return ownerUpdatedEvent
}

export function createServiceRegistryUpdatedEvent(
  serviceRegistry: Address
): ServiceRegistryUpdated {
  let serviceRegistryUpdatedEvent = changetype<ServiceRegistryUpdated>(
    newMockEvent()
  )

  serviceRegistryUpdatedEvent.parameters = new Array()

  serviceRegistryUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "serviceRegistry",
      ethereum.Value.fromAddress(serviceRegistry)
    )
  )

  return serviceRegistryUpdatedEvent
}

export function createStakingParamsUpdateRequestedEvent(
  epochNumber: BigInt,
  maxStakingIncentive: BigInt,
  minStakingWeight: BigInt
): StakingParamsUpdateRequested {
  let stakingParamsUpdateRequestedEvent =
    changetype<StakingParamsUpdateRequested>(newMockEvent())

  stakingParamsUpdateRequestedEvent.parameters = new Array()

  stakingParamsUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "epochNumber",
      ethereum.Value.fromUnsignedBigInt(epochNumber)
    )
  )
  stakingParamsUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "maxStakingIncentive",
      ethereum.Value.fromUnsignedBigInt(maxStakingIncentive)
    )
  )
  stakingParamsUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "minStakingWeight",
      ethereum.Value.fromUnsignedBigInt(minStakingWeight)
    )
  )

  return stakingParamsUpdateRequestedEvent
}

export function createStakingParamsUpdatedEvent(
  epochNumber: BigInt
): StakingParamsUpdated {
  let stakingParamsUpdatedEvent = changetype<StakingParamsUpdated>(
    newMockEvent()
  )

  stakingParamsUpdatedEvent.parameters = new Array()

  stakingParamsUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "epochNumber",
      ethereum.Value.fromUnsignedBigInt(epochNumber)
    )
  )

  return stakingParamsUpdatedEvent
}

export function createStakingRefundedEvent(
  epochNumber: BigInt,
  amount: BigInt
): StakingRefunded {
  let stakingRefundedEvent = changetype<StakingRefunded>(newMockEvent())

  stakingRefundedEvent.parameters = new Array()

  stakingRefundedEvent.parameters.push(
    new ethereum.EventParam(
      "epochNumber",
      ethereum.Value.fromUnsignedBigInt(epochNumber)
    )
  )
  stakingRefundedEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return stakingRefundedEvent
}

export function createTokenomicsImplementationUpdatedEvent(
  implementation: Address
): TokenomicsImplementationUpdated {
  let tokenomicsImplementationUpdatedEvent =
    changetype<TokenomicsImplementationUpdated>(newMockEvent())

  tokenomicsImplementationUpdatedEvent.parameters = new Array()

  tokenomicsImplementationUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "implementation",
      ethereum.Value.fromAddress(implementation)
    )
  )

  return tokenomicsImplementationUpdatedEvent
}

export function createTokenomicsParametersUpdateRequestedEvent(
  epochNumber: BigInt,
  devsPerCapital: BigInt,
  codePerDev: BigInt,
  epsilonRate: BigInt,
  epochLen: BigInt,
  veOLASThreshold: BigInt
): TokenomicsParametersUpdateRequested {
  let tokenomicsParametersUpdateRequestedEvent =
    changetype<TokenomicsParametersUpdateRequested>(newMockEvent())

  tokenomicsParametersUpdateRequestedEvent.parameters = new Array()

  tokenomicsParametersUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "epochNumber",
      ethereum.Value.fromUnsignedBigInt(epochNumber)
    )
  )
  tokenomicsParametersUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "devsPerCapital",
      ethereum.Value.fromUnsignedBigInt(devsPerCapital)
    )
  )
  tokenomicsParametersUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "codePerDev",
      ethereum.Value.fromUnsignedBigInt(codePerDev)
    )
  )
  tokenomicsParametersUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "epsilonRate",
      ethereum.Value.fromUnsignedBigInt(epsilonRate)
    )
  )
  tokenomicsParametersUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "epochLen",
      ethereum.Value.fromUnsignedBigInt(epochLen)
    )
  )
  tokenomicsParametersUpdateRequestedEvent.parameters.push(
    new ethereum.EventParam(
      "veOLASThreshold",
      ethereum.Value.fromUnsignedBigInt(veOLASThreshold)
    )
  )

  return tokenomicsParametersUpdateRequestedEvent
}

export function createTokenomicsParametersUpdatedEvent(
  epochNumber: BigInt
): TokenomicsParametersUpdated {
  let tokenomicsParametersUpdatedEvent =
    changetype<TokenomicsParametersUpdated>(newMockEvent())

  tokenomicsParametersUpdatedEvent.parameters = new Array()

  tokenomicsParametersUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "epochNumber",
      ethereum.Value.fromUnsignedBigInt(epochNumber)
    )
  )

  return tokenomicsParametersUpdatedEvent
}

export function createTreasuryUpdatedEvent(treasury: Address): TreasuryUpdated {
  let treasuryUpdatedEvent = changetype<TreasuryUpdated>(newMockEvent())

  treasuryUpdatedEvent.parameters = new Array()

  treasuryUpdatedEvent.parameters.push(
    new ethereum.EventParam("treasury", ethereum.Value.fromAddress(treasury))
  )

  return treasuryUpdatedEvent
}
