import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  afterEach,
} from "matchstick-as/assembly/index"
import { Address } from "@graphprotocol/graph-ts"
import { handleInstanceCreated } from "../src/staking-factory"
import { createInstanceCreatedEvent, mockStakingProxyConfig } from "./staking-factory-utils"

const SENDER = Address.fromString("0x0000000000000000000000000000000000000011")
const IMPLEMENTATION = Address.fromString("0x0000000000000000000000000000000000000012")
const MANAGER = Address.fromString("0x0000000000000000000000000000000000000013")

describe("StakingFactory instance indexing", () => {
  beforeEach(() => {
    clearStore()
  })

  afterEach(() => {
    clearStore()
  })

  test("Fully featured instance is indexed with complete config and no manager", () => {
    let instance = Address.fromString("0x0000000000000000000000000000000000000021")
    mockStakingProxyConfig(instance, [], null)

    handleInstanceCreated(createInstanceCreatedEvent(SENDER, instance, IMPLEMENTATION))

    assert.entityCount("StakingContract", 1)
    assert.fieldEquals("StakingContract", instance.toHexString(), "configComplete", "true")
    assert.fieldEquals("StakingContract", instance.toHexString(), "stakingManager", "null")
    assert.fieldEquals("StakingContract", instance.toHexString(), "numAgentInstances", "1")
    assert.fieldEquals("StakingContract", instance.toHexString(), "agentIds", "[25]")
  })

  test("Externally managed instance missing getAgentIds is still indexed", () => {
    let instance = Address.fromString("0x0000000000000000000000000000000000000022")
    mockStakingProxyConfig(instance, ["getAgentIds"], MANAGER)

    handleInstanceCreated(createInstanceCreatedEvent(SENDER, instance, IMPLEMENTATION))

    assert.entityCount("StakingContract", 1)
    assert.fieldEquals("StakingContract", instance.toHexString(), "configComplete", "false")
    assert.fieldEquals("StakingContract", instance.toHexString(), "stakingManager", MANAGER.toHexString())
    assert.fieldEquals("StakingContract", instance.toHexString(), "agentIds", "[]")
    // the getters it does expose are still recorded
    assert.fieldEquals("StakingContract", instance.toHexString(), "numAgentInstances", "1")
    assert.fieldEquals("StakingContract", instance.toHexString(), "maxNumServices", "40")
  })

  test("Sparse implementation missing most getters does not halt indexing", () => {
    let instance = Address.fromString("0x0000000000000000000000000000000000000023")
    mockStakingProxyConfig(
      instance,
      [
        "metadataHash",
        "minStakingDuration",
        "maxNumInactivityPeriods",
        "numAgentInstances",
        "getAgentIds",
        "threshold",
        "configHash",
        "proxyHash",
      ],
      MANAGER
    )

    handleInstanceCreated(createInstanceCreatedEvent(SENDER, instance, IMPLEMENTATION))

    assert.entityCount("StakingContract", 1)
    assert.fieldEquals("StakingContract", instance.toHexString(), "configComplete", "false")
    assert.fieldEquals("StakingContract", instance.toHexString(), "numAgentInstances", "0")
    // reads that succeed are kept, so the contract is still usable
    assert.fieldEquals("StakingContract", instance.toHexString(), "maxNumServices", "40")
    assert.fieldEquals(
      "StakingContract",
      instance.toHexString(),
      "minStakingDeposit",
      "5000000000000000000000"
    )
  })

  test("InstanceCreated is recorded for every instance", () => {
    let instance = Address.fromString("0x0000000000000000000000000000000000000024")
    mockStakingProxyConfig(instance, [], null)

    handleInstanceCreated(createInstanceCreatedEvent(SENDER, instance, IMPLEMENTATION))

    assert.entityCount("InstanceCreated", 1)
  })
})
