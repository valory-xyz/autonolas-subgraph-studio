import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll
} from "matchstick-as/assembly/index"
import { Address, BigInt } from "@graphprotocol/graph-ts"
import { AgentRegistryUpdated } from "../generated/schema"
import { AgentRegistryUpdated as AgentRegistryUpdatedEvent } from "../generated/Tokenomics/Tokenomics"
import { handleAgentRegistryUpdated } from "../src/tokenomics"
import { createAgentRegistryUpdatedEvent } from "./tokenomics-utils"

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/developer/matchstick/#tests-structure-0-5-0

describe("Describe entity assertions", () => {
  beforeAll(() => {
    let agentRegistry = Address.fromString(
      "0x0000000000000000000000000000000000000001"
    )
    let newAgentRegistryUpdatedEvent =
      createAgentRegistryUpdatedEvent(agentRegistry)
    handleAgentRegistryUpdated(newAgentRegistryUpdatedEvent)
  })

  afterAll(() => {
    clearStore()
  })

  // For more test scenarios, see:
  // https://thegraph.com/docs/en/developer/matchstick/#write-a-unit-test

  test("AgentRegistryUpdated created and stored", () => {
    assert.entityCount("AgentRegistryUpdated", 1)
  })
})
