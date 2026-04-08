import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll
} from "matchstick-as/assembly/index"
import { Address, BigInt } from "@graphprotocol/graph-ts"
import { IncentivesClaimed } from "../generated/schema"
import { IncentivesClaimed as IncentivesClaimedEvent } from "../generated/DispenserV1/DispenserV1"
import { handleIncentivesClaimed } from "../src/dispenser"
import { createIncentivesClaimedEvent } from "./dispenser-utils"

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/developer/matchstick/#tests-structure-0-5-0

describe("Describe entity assertions", () => {
  beforeAll(() => {
    let owner = Address.fromString("0x0000000000000000000000000000000000000001")
    let reward = BigInt.fromI32(234)
    let topUp = BigInt.fromI32(234)
    let newIncentivesClaimedEvent = createIncentivesClaimedEvent(
      owner,
      reward,
      topUp
    )
    handleIncentivesClaimed(newIncentivesClaimedEvent)
  })

  afterAll(() => {
    clearStore()
  })

  // For more test scenarios, see:
  // https://thegraph.com/docs/en/developer/matchstick/#write-a-unit-test

  test("IncentivesClaimed created and stored", () => {
    assert.entityCount("IncentivesClaimed", 1)
  })
})
