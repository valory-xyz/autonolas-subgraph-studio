import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  afterEach,
  createMockedFunction,
} from "matchstick-as/assembly/index"
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { Service, ServiceRewardsHistory, ActiveServiceEpoch } from "../generated/schema"
import {
  handleServiceStaked,
  handleCheckpoint,
  handleServiceUnstaked,
  handleServiceForceUnstaked,
  handleRewardClaimed,
} from "../src/staking-proxy"
import {
  createServiceStakedEvent,
  createCheckpointEvent,
  createServiceUnstakedEvent,
  createServiceForceUnstakedEvent,
  createRewardClaimedEvent,
} from "./staking-proxy-utils"
import { TestAddresses, TestConstants, createHistoryId, createActiveEpochId } from "./test-helpers"

// Helper to mock contract calls for getOlasForStaking
function mockStakingContractCalls(contractAddress: Address): void {
  createMockedFunction(
    contractAddress,
    "numAgentInstances",
    "numAgentInstances():(uint256)"
  )
    .withArgs([])
    .returns([ethereum.Value.fromUnsignedBigInt(TestConstants.NUM_AGENT_INSTANCES)])

  createMockedFunction(
    contractAddress,
    "minStakingDeposit",
    "minStakingDeposit():(uint256)"
  )
    .withArgs([])
    .returns([ethereum.Value.fromUnsignedBigInt(TestConstants.MIN_STAKING_DEPOSIT)])
}

describe("ServiceRewardsHistory Tests", () => {
  beforeEach(() => {
    clearStore()
  })

  afterEach(() => {
    clearStore()
  })

  test("ServiceStaked creates ServiceRewardsHistory and updates Service fields", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    mockStakingContractCalls(contractAddress)

    let event = createServiceStakedEvent(serviceId, epoch, contractAddress)
    handleServiceStaked(event)

    // Check Service entity
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "1")
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contractAddress.toHexString())
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "0")

    // Check ServiceRewardsHistory entity
    let historyId = createHistoryId(serviceId, contractAddress, epoch)
    assert.fieldEquals("ServiceRewardsHistory", historyId, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId, "epoch", epoch.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId, "contractAddress", contractAddress.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId, "rewardAmount", "0")

    // Check ActiveServiceEpoch entity
    let activeKey = createActiveEpochId(contractAddress, epoch)
    assert.fieldEquals("ActiveServiceEpoch", activeKey, "epoch", epoch.toString())
    assert.fieldEquals("ActiveServiceEpoch", activeKey, "contractAddress", contractAddress.toHexString())
  })

  test("Multiple services staking in same epoch tracked in ActiveServiceEpoch", () => {
    let serviceId1 = TestConstants.SERVICE_ID_1
    let serviceId2 = TestConstants.SERVICE_ID_2
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    mockStakingContractCalls(contractAddress)

    let event1 = createServiceStakedEvent(serviceId1, epoch, contractAddress)
    let event2 = createServiceStakedEvent(serviceId2, epoch, contractAddress)

    handleServiceStaked(event1)
    handleServiceStaked(event2)

    // Check ActiveServiceEpoch contains both services
    let activeKey = createActiveEpochId(contractAddress, epoch)
    let activeServiceEpoch = ActiveServiceEpoch.load(activeKey)
    assert.assertNotNull(activeServiceEpoch)
    assert.i32Equals(2, activeServiceEpoch!.activeServiceIds.length)
  })

  test("Checkpoint updates ServiceRewardsHistory for services that met KPI", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    let reward = TestConstants.REWARD_1000
    mockStakingContractCalls(contractAddress)

    // First stake the service
    let stakeEvent = createServiceStakedEvent(serviceId, epoch, contractAddress)
    handleServiceStaked(stakeEvent)

    // Then checkpoint with reward
    let checkpointEvent = createCheckpointEvent(
      epoch,
      [serviceId],
      [reward],
      contractAddress
    )
    handleCheckpoint(checkpointEvent)

    // Check ServiceRewardsHistory was updated
    let historyId = createHistoryId(serviceId, contractAddress, epoch)
    assert.fieldEquals("ServiceRewardsHistory", historyId, "rewardAmount", reward.toString())

    // Check Service olasRewardsEarned was updated
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsEarned", reward.toString())
  })

  test("Checkpoint creates zero-reward entries for services that didn't meet KPI", () => {
    let serviceId1 = TestConstants.SERVICE_ID_1
    let serviceId2 = TestConstants.SERVICE_ID_2
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    let reward = TestConstants.REWARD_1000
    mockStakingContractCalls(contractAddress)

    // Stake both services
    let stakeEvent1 = createServiceStakedEvent(serviceId1, epoch, contractAddress)
    let stakeEvent2 = createServiceStakedEvent(serviceId2, epoch, contractAddress)
    handleServiceStaked(stakeEvent1)
    handleServiceStaked(stakeEvent2)

    // Checkpoint only includes service 1 with reward
    let checkpointEvent = createCheckpointEvent(
      epoch,
      [serviceId1],
      [reward],
      contractAddress
    )
    handleCheckpoint(checkpointEvent)

    // Service 1 should have reward
    let historyId1 = createHistoryId(serviceId1, contractAddress, epoch)
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "rewardAmount", reward.toString())

    // Service 2 should have zero reward
    let historyId2 = createHistoryId(serviceId2, contractAddress, epoch)
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "rewardAmount", "0")
  })

  test("RewardClaimed updates Service olasRewardsClaimed", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let reward = TestConstants.REWARD_1000
    let contractAddress = TestAddresses.CONTRACT_1
    mockStakingContractCalls(contractAddress)

    // First stake the service to create the Service entity
    let stakeEvent = createServiceStakedEvent(serviceId, epoch, contractAddress)
    handleServiceStaked(stakeEvent)

    // Claim reward
    let claimEvent = createRewardClaimedEvent(serviceId, epoch, reward, contractAddress)
    handleRewardClaimed(claimEvent)

    // Check olasRewardsClaimed was updated
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", reward.toString())
  })

  test("ServiceUnstaked updates olasRewardsClaimed and clears latestStakingContract", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    let reward = TestConstants.REWARD_1000
    mockStakingContractCalls(contractAddress)

    // Stake service
    let stakeEvent = createServiceStakedEvent(serviceId, epoch, contractAddress)
    handleServiceStaked(stakeEvent)

    // Verify latestStakingContract is set
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contractAddress.toHexString())

    // Unstake with reward
    let unstakeEvent = createServiceUnstakedEvent(serviceId, epoch, reward, contractAddress)
    handleServiceUnstaked(unstakeEvent)

    // Check olasRewardsClaimed was updated
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", reward.toString())

    // Check latestStakingContract was cleared
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", "null")

    // Check service removed from ActiveServiceEpoch
    let activeKey = createActiveEpochId(contractAddress, epoch)
    let activeServiceEpoch = ActiveServiceEpoch.load(activeKey)
    if (activeServiceEpoch !== null) {
      assert.i32Equals(0, activeServiceEpoch.activeServiceIds.length)
    }
  })

  test("ServiceForceUnstaked updates olasRewardsClaimed and clears latestStakingContract", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    let reward = TestConstants.REWARD_500
    mockStakingContractCalls(contractAddress)

    // Stake service
    let stakeEvent = createServiceStakedEvent(serviceId, epoch, contractAddress)
    handleServiceStaked(stakeEvent)

    // Force unstake with reward
    let forceUnstakeEvent = createServiceForceUnstakedEvent(serviceId, epoch, reward, contractAddress)
    handleServiceForceUnstaked(forceUnstakeEvent)

    // Check olasRewardsClaimed was updated
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", reward.toString())

    // Check latestStakingContract was cleared
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", "null")
  })

  test("totalEpochsParticipated increments correctly", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    mockStakingContractCalls(contractAddress)

    // Stake in epoch 1
    let stakeEvent1 = createServiceStakedEvent(serviceId, TestConstants.EPOCH_1, contractAddress)
    handleServiceStaked(stakeEvent1)
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "1")

    // Stake in epoch 2
    let stakeEvent2 = createServiceStakedEvent(serviceId, TestConstants.EPOCH_2, contractAddress)
    handleServiceStaked(stakeEvent2)
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "2")

    // Stake in epoch 3
    let stakeEvent3 = createServiceStakedEvent(serviceId, TestConstants.EPOCH_3, contractAddress)
    handleServiceStaked(stakeEvent3)
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "3")
  })

  test("Multiple rewards claimed accumulate correctly", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    mockStakingContractCalls(contractAddress)

    // Stake service
    let stakeEvent = createServiceStakedEvent(serviceId, epoch, contractAddress)
    handleServiceStaked(stakeEvent)

    // Claim reward 1
    let claimEvent1 = createRewardClaimedEvent(serviceId, epoch, TestConstants.REWARD_1000, contractAddress)
    handleRewardClaimed(claimEvent1)
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "1000")

    // Claim reward 2
    let claimEvent2 = createRewardClaimedEvent(serviceId, epoch, TestConstants.REWARD_500, contractAddress)
    handleRewardClaimed(claimEvent2)
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "1500")

    // Claim reward 3
    let claimEvent3 = createRewardClaimedEvent(serviceId, epoch, TestConstants.REWARD_250, contractAddress)
    handleRewardClaimed(claimEvent3)
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "1750")
  })

  test("Checkpoint carries forward active services to next epoch", () => {
    let serviceId1 = TestConstants.SERVICE_ID_1
    let serviceId2 = TestConstants.SERVICE_ID_2
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    mockStakingContractCalls(contractAddress)

    // Stake both services
    let stakeEvent1 = createServiceStakedEvent(serviceId1, epoch, contractAddress)
    let stakeEvent2 = createServiceStakedEvent(serviceId2, epoch, contractAddress)
    handleServiceStaked(stakeEvent1)
    handleServiceStaked(stakeEvent2)

    // Checkpoint
    let checkpointEvent = createCheckpointEvent(
      epoch,
      [serviceId1],
      [TestConstants.REWARD_1000],
      contractAddress
    )
    handleCheckpoint(checkpointEvent)

    // Check next epoch has both services
    let nextEpoch = epoch.plus(BigInt.fromI32(1))
    let nextKey = createActiveEpochId(contractAddress, nextEpoch)
    let nextActiveServiceEpoch = ActiveServiceEpoch.load(nextKey)
    assert.assertNotNull(nextActiveServiceEpoch)
    assert.i32Equals(2, nextActiveServiceEpoch!.activeServiceIds.length)
  })

  test("Service staking on different contracts tracked separately", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contract1 = TestAddresses.CONTRACT_1
    let contract2 = TestAddresses.CONTRACT_2
    mockStakingContractCalls(contract1)
    mockStakingContractCalls(contract2)

    // Stake on contract 1
    let stakeEvent1 = createServiceStakedEvent(serviceId, epoch, contract1)
    handleServiceStaked(stakeEvent1)

    // Stake on contract 2
    let stakeEvent2 = createServiceStakedEvent(serviceId, epoch, contract2)
    handleServiceStaked(stakeEvent2)

    // Check both history entries exist
    let historyId1 = createHistoryId(serviceId, contract1, epoch)
    let historyId2 = createHistoryId(serviceId, contract2, epoch)

    assert.fieldEquals("ServiceRewardsHistory", historyId1, "contractAddress", contract1.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "contractAddress", contract2.toHexString())

    // Check totalEpochsParticipated counts both
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "2")

    // Check latestStakingContract is the second one
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contract2.toHexString())
  })

  test("Complex test: stake without rewards, eviction, restake with rewards, migrate to new contract", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contract1 = TestAddresses.CONTRACT_1
    let contract2 = TestAddresses.CONTRACT_2
    mockStakingContractCalls(contract1)
    mockStakingContractCalls(contract2)

    // === STEP 1: User stakes at epoch 1 ===
    let epoch1 = BigInt.fromI32(1)
    let stakeEvent1 = createServiceStakedEvent(serviceId, epoch1, contract1)
    handleServiceStaked(stakeEvent1)

    // Verify: Service entity created, latestStakingContract set, history entry exists
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "1")
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contract1.toHexString())
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsEarned", "0")
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "0")
    let historyId1 = createHistoryId(serviceId, contract1, epoch1)
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "rewardAmount", "0")

    // === STEP 2: Checkpoint at epoch 1 - user doesn't earn rewards (didn't meet KPI) ===
    let checkpointEvent1 = createCheckpointEvent(
      epoch1,
      [], // Empty array means no services met KPI
      [],
      contract1
    )
    handleCheckpoint(checkpointEvent1)

    // Verify: History shows zero rewards
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "rewardAmount", "0")
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsEarned", "0")

    // === STEP 3: After 2 days (epoch 3), user is evicted ===
    let epoch3 = BigInt.fromI32(3)
    let forceUnstakeEvent = createServiceForceUnstakedEvent(serviceId, epoch3, BigInt.fromI32(0), contract1)
    handleServiceForceUnstaked(forceUnstakeEvent)

    // Verify: latestStakingContract cleared, no rewards claimed
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", "null")
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "0")
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "1")

    // === STEP 4: After 2 more days (epoch 5), user restakes ===
    let epoch5 = BigInt.fromI32(5)
    let stakeEvent2 = createServiceStakedEvent(serviceId, epoch5, contract1)
    handleServiceStaked(stakeEvent2)

    // Verify: latestStakingContract set again, totalEpochsParticipated increased
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contract1.toHexString())
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "2")
    let historyId2 = createHistoryId(serviceId, contract1, epoch5)
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "rewardAmount", "0")

    // === STEP 5: Checkpoint at epoch 5 - user earns rewards ===
    let reward1 = TestConstants.REWARD_1000
    let checkpointEvent2 = createCheckpointEvent(
      epoch5,
      [serviceId],
      [reward1],
      contract1
    )
    handleCheckpoint(checkpointEvent2)

    // Verify: History shows rewards earned
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "rewardAmount", reward1.toString())
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsEarned", reward1.toString())

    // === STEP 6: User moves to another contract at epoch 6 ===
    let epoch6 = BigInt.fromI32(6)
    let stakeEvent3 = createServiceStakedEvent(serviceId, epoch6, contract2)
    handleServiceStaked(stakeEvent3)

    // Verify: latestStakingContract updated to new contract, totalEpochsParticipated increased
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contract2.toHexString())
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "3")
    let historyId3 = createHistoryId(serviceId, contract2, epoch6)
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "contractAddress", contract2.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "rewardAmount", "0")

    // === STEP 7: Checkpoint at epoch 6 on new contract - user earns more rewards ===
    let reward2 = TestConstants.REWARD_500
    let checkpointEvent3 = createCheckpointEvent(
      epoch6,
      [serviceId],
      [reward2],
      contract2
    )
    handleCheckpoint(checkpointEvent3)

    // Verify: New history entry shows rewards, total rewards accumulated
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "rewardAmount", reward2.toString())
    let totalRewards = reward1.plus(reward2).toString()
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsEarned", totalRewards)

    // === FINAL VERIFICATION: Check all history entries exist ===
    // Original stake (no rewards)
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "epoch", epoch1.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "contractAddress", contract1.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "rewardAmount", "0")

    // Restake with rewards
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "epoch", epoch5.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "contractAddress", contract1.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "rewardAmount", reward1.toString())

    // New contract with rewards
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "epoch", epoch6.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "contractAddress", contract2.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "rewardAmount", reward2.toString())

    // Final service state
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "3")
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contract2.toHexString())
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsEarned", totalRewards)
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "0")
  })
})
