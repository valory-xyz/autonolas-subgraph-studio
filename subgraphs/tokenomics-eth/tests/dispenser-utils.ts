import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  IncentivesClaimed,
  OwnerUpdated,
  TokenomicsUpdated,
  TreasuryUpdated
} from "../generated/Dispenser/Dispenser"

export function createIncentivesClaimedEvent(
  owner: Address,
  reward: BigInt,
  topUp: BigInt
): IncentivesClaimed {
  let incentivesClaimedEvent = changetype<IncentivesClaimed>(newMockEvent())

  incentivesClaimedEvent.parameters = new Array()

  incentivesClaimedEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  )
  incentivesClaimedEvent.parameters.push(
    new ethereum.EventParam("reward", ethereum.Value.fromUnsignedBigInt(reward))
  )
  incentivesClaimedEvent.parameters.push(
    new ethereum.EventParam("topUp", ethereum.Value.fromUnsignedBigInt(topUp))
  )

  return incentivesClaimedEvent
}

export function createOwnerUpdatedEvent(owner: Address): OwnerUpdated {
  let ownerUpdatedEvent = changetype<OwnerUpdated>(newMockEvent())

  ownerUpdatedEvent.parameters = new Array()

  ownerUpdatedEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  )

  return ownerUpdatedEvent
}

export function createTokenomicsUpdatedEvent(
  tokenomics: Address
): TokenomicsUpdated {
  let tokenomicsUpdatedEvent = changetype<TokenomicsUpdated>(newMockEvent())

  tokenomicsUpdatedEvent.parameters = new Array()

  tokenomicsUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "tokenomics",
      ethereum.Value.fromAddress(tokenomics)
    )
  )

  return tokenomicsUpdatedEvent
}

export function createTreasuryUpdatedEvent(treasury: Address): TreasuryUpdated {
  let treasuryUpdatedEvent = changetype<TreasuryUpdated>(newMockEvent())

  treasuryUpdatedEvent.parameters = new Array()

  treasuryUpdatedEvent.parameters.push(
    new ethereum.EventParam("treasury", ethereum.Value.fromAddress(treasury))
  )

  return treasuryUpdatedEvent
}
