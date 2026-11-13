import * as ProxyEvents from "../generated/DispenserProxy/DispenserProxy";
import { Epoch } from "../generated/schema";
import { getNomineeHash } from "../src/utils";
import { createMockedFunction, newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  IncentivesClaimed,
  OwnerUpdated,
  TokenomicsUpdated,
  TreasuryUpdated
} from "../generated/DispenserV1/DispenserV1"

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

// Shared Dispenser fixtures for proxy and source-attribution tests.
export const PROXY = Address.fromString("0x78Bd94F48CAe623CC74828eCbFEBE3bDF428D83D");
export const OLD_DISPENSER = Address.fromString("0x5650300fCBab43A0D7D02F8Cb5d0f039402593f0");
export const ACCOUNT = Address.fromString("0x0000000000000000000000000000000000000001");
export const TARGET = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001");
export const CHAIN = BigInt.fromString("5000000000");

export function param(name: string, value: ethereum.Value): ethereum.EventParam {
  return new ethereum.EventParam(name, value);
}

export function uint(value: i32): ethereum.Value {
  return ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(value));
}

export function dispenserEvent<T>(source: Address, index: i32, params: ethereum.EventParam[]): T {
  const event = newMockEvent();
  event.address = source;
  event.logIndex = BigInt.fromI32(index);
  event.parameters = params;
  return changetype<T>(event);
}

export function singleClaim(source: Address, index: i32, incentive: i32, transfer: i32, returned: i32, chain: BigInt = CHAIN): ProxyEvents.StakingIncentivesClaimed {
  return dispenserEvent<ProxyEvents.StakingIncentivesClaimed>(source, index, [
    param("account", ethereum.Value.fromAddress(ACCOUNT)),
    param("chainId", ethereum.Value.fromUnsignedBigInt(chain)),
    param("stakingTarget", ethereum.Value.fromFixedBytes(TARGET)),
    param("stakingIncentive", uint(incentive)),
    param("transferAmount", uint(transfer)),
    param("returnAmount", uint(returned)),
  ]);
}

export function batchClaim(source: Address, index: i32, chain: BigInt = CHAIN): ProxyEvents.StakingIncentivesBatchClaimed {
  return dispenserEvent<ProxyEvents.StakingIncentivesBatchClaimed>(source, index, [
    param("account", ethereum.Value.fromAddress(ACCOUNT)),
    param("chainIds", ethereum.Value.fromUnsignedBigIntArray([chain])),
    param("stakingTargets", ethereum.Value.fromArray([ethereum.Value.fromFixedBytesArray([TARGET])])),
    param("stakingIncentives", ethereum.Value.fromArray([ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(100)])])),
    param("totalStakingIncentive", uint(100)),
    param("totalTransferAmount", uint(0)),
    param("totalReturnAmount", uint(100)),
  ]);
}

export function seedDispenserEpoch(): void {
  const epoch = new Epoch("1");
  epoch.counter = 1;
  epoch.startBlock = BigInt.zero();
  epoch.accountTopUps = BigInt.zero();
  epoch.availableDevIncentives = BigInt.fromI32(100);
  epoch.devIncentivesTotalTopUp = BigInt.fromI32(10);
  epoch.availableStakingIncentives = BigInt.fromI32(1000);
  epoch.totalStakingIncentives = BigInt.fromI32(25);
  epoch.save();
}

export function mockClaimEpoch(source: Address = OLD_DISPENSER, chain: BigInt = CHAIN): void {
  createMockedFunction(source, "mapLastClaimedStakingEpochs", "mapLastClaimedStakingEpochs(bytes32):(uint256)")
    .withArgs([ethereum.Value.fromFixedBytes(getNomineeHash(TARGET, chain))])
    .returns([uint(2)]);
}
