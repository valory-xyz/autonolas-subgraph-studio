import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll
} from "matchstick-as/assembly/index"
import { Address, BigInt } from "@graphprotocol/graph-ts"
import { BondCalculatorUpdated } from "../generated/schema"
import { BondCalculatorUpdated as BondCalculatorUpdatedEvent } from "../generated/DepositoryV2/DepositoryV2"
import { handleBondCalculatorUpdated } from "../src/depository"
import { createBondCalculatorUpdatedEvent } from "./depository-utils"

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/developer/matchstick/#tests-structure-0-5-0

describe("Describe entity assertions", () => {
  beforeAll(() => {
    let bondCalculator = Address.fromString(
      "0x0000000000000000000000000000000000000001"
    )
    let newBondCalculatorUpdatedEvent =
      createBondCalculatorUpdatedEvent(bondCalculator)
    handleBondCalculatorUpdated(newBondCalculatorUpdatedEvent)
  })

  afterAll(() => {
    clearStore()
  })

  // For more test scenarios, see:
  // https://thegraph.com/docs/en/developer/matchstick/#write-a-unit-test

  test("BondCalculatorUpdated created and stored", () => {
    assert.entityCount("BondCalculatorUpdated", 1)
  })
})
