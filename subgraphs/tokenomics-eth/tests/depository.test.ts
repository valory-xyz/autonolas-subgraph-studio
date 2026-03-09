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
import { BondCalculatorUpdated as BondCalculatorUpdatedEvent } from "../generated/Depository/Depository"
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

    // 0xa16081f360e3847006db660bae1c6d1b2e17ec2a is the default address used in newMockEvent() function
    assert.fieldEquals(
      "BondCalculatorUpdated",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "bondCalculator",
      "0x0000000000000000000000000000000000000001"
    )

    // More assert options:
    // https://thegraph.com/docs/en/developer/matchstick/#asserts
  })
})
