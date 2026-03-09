import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  BondCalculatorUpdated,
  CloseProduct,
  CreateBond,
  CreateProduct,
  OwnerUpdated,
  RedeemBond,
  TokenomicsUpdated,
  TreasuryUpdated
} from "../generated/Depository/Depository"

export function createBondCalculatorUpdatedEvent(
  bondCalculator: Address
): BondCalculatorUpdated {
  let bondCalculatorUpdatedEvent = changetype<BondCalculatorUpdated>(
    newMockEvent()
  )

  bondCalculatorUpdatedEvent.parameters = new Array()

  bondCalculatorUpdatedEvent.parameters.push(
    new ethereum.EventParam(
      "bondCalculator",
      ethereum.Value.fromAddress(bondCalculator)
    )
  )

  return bondCalculatorUpdatedEvent
}

export function createCloseProductEvent(
  token: Address,
  productId: BigInt,
  supply: BigInt
): CloseProduct {
  let closeProductEvent = changetype<CloseProduct>(newMockEvent())

  closeProductEvent.parameters = new Array()

  closeProductEvent.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  )
  closeProductEvent.parameters.push(
    new ethereum.EventParam(
      "productId",
      ethereum.Value.fromUnsignedBigInt(productId)
    )
  )
  closeProductEvent.parameters.push(
    new ethereum.EventParam("supply", ethereum.Value.fromUnsignedBigInt(supply))
  )

  return closeProductEvent
}

export function createCreateBondEvent(
  token: Address,
  productId: BigInt,
  owner: Address,
  bondId: BigInt,
  amountOLAS: BigInt,
  tokenAmount: BigInt,
  maturity: BigInt
): CreateBond {
  let createBondEvent = changetype<CreateBond>(newMockEvent())

  createBondEvent.parameters = new Array()

  createBondEvent.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  )
  createBondEvent.parameters.push(
    new ethereum.EventParam(
      "productId",
      ethereum.Value.fromUnsignedBigInt(productId)
    )
  )
  createBondEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  )
  createBondEvent.parameters.push(
    new ethereum.EventParam("bondId", ethereum.Value.fromUnsignedBigInt(bondId))
  )
  createBondEvent.parameters.push(
    new ethereum.EventParam(
      "amountOLAS",
      ethereum.Value.fromUnsignedBigInt(amountOLAS)
    )
  )
  createBondEvent.parameters.push(
    new ethereum.EventParam(
      "tokenAmount",
      ethereum.Value.fromUnsignedBigInt(tokenAmount)
    )
  )
  createBondEvent.parameters.push(
    new ethereum.EventParam(
      "maturity",
      ethereum.Value.fromUnsignedBigInt(maturity)
    )
  )

  return createBondEvent
}

export function createCreateProductEvent(
  token: Address,
  productId: BigInt,
  supply: BigInt,
  priceLP: BigInt,
  vesting: BigInt
): CreateProduct {
  let createProductEvent = changetype<CreateProduct>(newMockEvent())

  createProductEvent.parameters = new Array()

  createProductEvent.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  )
  createProductEvent.parameters.push(
    new ethereum.EventParam(
      "productId",
      ethereum.Value.fromUnsignedBigInt(productId)
    )
  )
  createProductEvent.parameters.push(
    new ethereum.EventParam("supply", ethereum.Value.fromUnsignedBigInt(supply))
  )
  createProductEvent.parameters.push(
    new ethereum.EventParam(
      "priceLP",
      ethereum.Value.fromUnsignedBigInt(priceLP)
    )
  )
  createProductEvent.parameters.push(
    new ethereum.EventParam(
      "vesting",
      ethereum.Value.fromUnsignedBigInt(vesting)
    )
  )

  return createProductEvent
}

export function createOwnerUpdatedEvent(owner: Address): OwnerUpdated {
  let ownerUpdatedEvent = changetype<OwnerUpdated>(newMockEvent())

  ownerUpdatedEvent.parameters = new Array()

  ownerUpdatedEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  )

  return ownerUpdatedEvent
}

export function createRedeemBondEvent(
  productId: BigInt,
  owner: Address,
  bondId: BigInt
): RedeemBond {
  let redeemBondEvent = changetype<RedeemBond>(newMockEvent())

  redeemBondEvent.parameters = new Array()

  redeemBondEvent.parameters.push(
    new ethereum.EventParam(
      "productId",
      ethereum.Value.fromUnsignedBigInt(productId)
    )
  )
  redeemBondEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner))
  )
  redeemBondEvent.parameters.push(
    new ethereum.EventParam("bondId", ethereum.Value.fromUnsignedBigInt(bondId))
  )

  return redeemBondEvent
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
