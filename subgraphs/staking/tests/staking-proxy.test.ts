import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  afterEach,
} from "matchstick-as/assembly/index"
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import { ActiveServiceEpoch, CumulativeDailyStakingGlobal, StakingContract, ServiceRewardsHistory } from "../generated/schema"
import {
  handleServiceStaked,
  handleCheckpoint,
  handleServiceUnstaked,
  handleServiceForceUnstaked,
  handleRewardClaimed,
  handleServicesEvicted,
} from "../src/staking-proxy"
import {
  createServiceStakedEvent,
  createCheckpointEvent,
  createServiceUnstakedEvent,
  createServiceForceUnstakedEvent,
  createRewardClaimedEvent,
  createServicesEvictedEvent,
} from "./staking-proxy-utils"
import { TestAddresses, TestConstants, createHistoryId, createActiveEpochId } from "./test-helpers"
import { mockServiceDeposit, mockServiceDepositMulti } from "./staking-factory-utils"
import { getDayTimestamp } from "../src/utils"

// Helper to create a StakingContract entity for getOlasForStaking
function createStakingContractEntity(contractAddress: Address): void {
  let stakingContract = new StakingContract(contractAddress);
  stakingContract.sender = Address.zero();
  stakingContract.instance = contractAddress;
  stakingContract.implementation = Address.zero();
  stakingContract.metadataHash = Bytes.empty();
  stakingContract.maxNumServices = BigInt.fromI32(10);
  stakingContract.rewardsPerSecond = BigInt.fromI32(100);
  stakingContract.minStakingDeposit = TestConstants.MIN_STAKING_DEPOSIT;
  stakingContract.minStakingDuration = BigInt.fromI32(1000);
  stakingContract.maxNumInactivityPeriods = BigInt.fromI32(5);
  stakingContract.livenessPeriod = BigInt.fromI32(86400);
  stakingContract.timeForEmissions = BigInt.fromI32(3600);
  stakingContract.numAgentInstances = TestConstants.NUM_AGENT_INSTANCES;
  stakingContract.agentIds = [];
  stakingContract.threshold = BigInt.fromI32(2);
  stakingContract.configHash = Bytes.empty();
  stakingContract.proxyHash = Bytes.empty();
  stakingContract.serviceRegistry = Address.zero();
  stakingContract.activityChecker = Address.zero();
  stakingContract.stakingManager = null;
  stakingContract.version = "0.2.0";
  stakingContract.eventsIndexed = true;
  stakingContract.configComplete = true;
  stakingContract.stakingToken = null;
  stakingContract.isOlasStaking = true;
  stakingContract.serviceRegistryTokenUtility = null;
  stakingContract.save();
}

const TOKEN_UTILITY = Address.fromString("0x0000000000000000000000000000000000000079")
const SERVICE_REGISTRY = Address.fromString("0x0000000000000000000000000000000000000077")

// Same as above but reachable by readLockedOlas, so the on-chain deposit is used
function createStakingContractWithUtility(contractAddress: Address, isOlas: boolean): void {
  createStakingContractEntity(contractAddress);
  let stakingContract = StakingContract.load(contractAddress)!;
  stakingContract.serviceRegistry = SERVICE_REGISTRY;
  stakingContract.serviceRegistryTokenUtility = TOKEN_UTILITY;
  stakingContract.isOlasStaking = isOlas;
  stakingContract.save();
}

describe("Stake amount accounting", () => {
  beforeEach(() => { clearStore() })
  afterEach(() => { clearStore() })

  test("Stake amount comes from the on-chain deposit, not the contract minimum", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractWithUtility(contractAddress, true)

    // security 500 + 1 slot x bond 500 = 1000, while the contract minimum implies 40
    let security = BigInt.fromString("500000000000000000000")
    let bond = BigInt.fromString("500000000000000000000")
    mockServiceDeposit(TOKEN_UTILITY, SERVICE_REGISTRY, serviceId, security, BigInt.fromI32(25), BigInt.fromI32(1), bond)

    handleServiceStaked(createServiceStakedEvent(serviceId, TestConstants.EPOCH_5, contractAddress))

    assert.fieldEquals("Service", serviceId.toString(), "currentOlasStaked", "1000000000000000000000")
    assert.fieldEquals("Service", serviceId.toString(), "currentStakeAmount", "1000000000000000000000")
    assert.fieldEquals("Global", "", "currentOlasStaked", "1000000000000000000000")
  })

  test("Unstake releases the recorded amount even if the deposit changed", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractWithUtility(contractAddress, true)

    let security = BigInt.fromString("500000000000000000000")
    mockServiceDeposit(TOKEN_UTILITY, SERVICE_REGISTRY, serviceId, security, BigInt.fromI32(25), BigInt.fromI32(1), security)
    handleServiceStaked(createServiceStakedEvent(serviceId, TestConstants.EPOCH_5, contractAddress))

    // deposit doubles while the service is staked
    let bigger = BigInt.fromString("1000000000000000000000")
    mockServiceDeposit(TOKEN_UTILITY, SERVICE_REGISTRY, serviceId, bigger, BigInt.fromI32(25), BigInt.fromI32(1), bigger)
    handleServiceUnstaked(createServiceUnstakedEvent(serviceId, TestConstants.EPOCH_5, TestConstants.REWARD_500, contractAddress))

    // back to zero, not negative and not stranded
    assert.fieldEquals("Service", serviceId.toString(), "currentOlasStaked", "0")
    assert.fieldEquals("Service", serviceId.toString(), "currentStakeAmount", "0")
    assert.fieldEquals("Global", "", "currentOlasStaked", "0")
  })

  test("Contracts staking another token contribute nothing to OLAS totals", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractWithUtility(contractAddress, false)

    let security = BigInt.fromString("500000000000000000000")
    mockServiceDeposit(TOKEN_UTILITY, SERVICE_REGISTRY, serviceId, security, BigInt.fromI32(25), BigInt.fromI32(1), security)

    handleServiceStaked(createServiceStakedEvent(serviceId, TestConstants.EPOCH_5, contractAddress))

    assert.fieldEquals("Service", serviceId.toString(), "currentOlasStaked", "0")
    assert.fieldEquals("Global", "", "currentOlasStaked", "0")
  })
})

describe("Stake amount fallbacks", () => {
  beforeEach(() => { clearStore() })
  afterEach(() => { clearStore() })

  // Every read that readLockedOlas depends on, failed one at a time. The
  // contract minimum here is 10e18 * (3 + 1) = 40e18.
  test("serviceRegistry reverting alone falls back instead of crashing", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractEntity(contractAddress)
    // token utility readable, serviceRegistry empty as if its getter reverted
    let stakingContract = StakingContract.load(contractAddress)!
    stakingContract.serviceRegistry = Bytes.empty()
    stakingContract.serviceRegistryTokenUtility = TOKEN_UTILITY
    stakingContract.isOlasStaking = true
    stakingContract.save()

    handleServiceStaked(createServiceStakedEvent(serviceId, TestConstants.EPOCH_5, contractAddress))

    assert.fieldEquals("Service", serviceId.toString(), "currentOlasStaked", "40000000000000000000")
  })

  test("mapServiceIdTokenDeposit reverting falls back", () => {
    assertFallbackWhenReverting("mapServiceIdTokenDeposit")
  })

  test("getService reverting falls back", () => {
    assertFallbackWhenReverting("getService")
  })

  test("getAgentParams reverting falls back", () => {
    assertFallbackWhenReverting("getAgentParams")
  })

  test("getAgentBond reverting falls back", () => {
    assertFallbackWhenReverting("getAgentBond")
  })

  test("Bonds are summed across every canonical agent id", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractWithUtility(contractAddress, true)

    // 100 security + (2 slots x 10) + (3 slots x 20) = 180
    mockServiceDepositMulti(
      TOKEN_UTILITY, SERVICE_REGISTRY, serviceId,
      BigInt.fromI32(100),
      [BigInt.fromI32(25), BigInt.fromI32(40)],
      [BigInt.fromI32(2), BigInt.fromI32(3)],
      [BigInt.fromI32(10), BigInt.fromI32(20)]
    )

    handleServiceStaked(createServiceStakedEvent(serviceId, TestConstants.EPOCH_5, contractAddress))

    assert.fieldEquals("Service", serviceId.toString(), "currentOlasStaked", "180")
  })

  test("Unstake for a service never recorded as staked releases nothing", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractEntity(contractAddress)

    // no handleServiceStaked, as if it staked before the subgraph start block
    handleServiceUnstaked(
      createServiceUnstakedEvent(serviceId, TestConstants.EPOCH_5, TestConstants.REWARD_500, contractAddress)
    )

    assert.fieldEquals("Global", "", "currentOlasStaked", "0")
    assert.fieldEquals("Global", "", "cumulativeOlasUnstaked", "0")
  })
})

function assertFallbackWhenReverting(reverting: string): void {
  let serviceId = TestConstants.SERVICE_ID_1
  let contractAddress = TestAddresses.CONTRACT_1
  createStakingContractWithUtility(contractAddress, true)
  mockServiceDeposit(
    TOKEN_UTILITY, SERVICE_REGISTRY, serviceId,
    BigInt.fromString("500000000000000000000"),
    BigInt.fromI32(25), BigInt.fromI32(1),
    BigInt.fromString("500000000000000000000"),
    [reverting]
  )

  handleServiceStaked(createServiceStakedEvent(serviceId, TestConstants.EPOCH_5, contractAddress))

  // contract minimum, not the 1000e18 the reads would have produced
  assert.fieldEquals("Service", serviceId.toString(), "currentOlasStaked", "40000000000000000000")
}

describe("Rewards from contracts paying another token", () => {
  beforeEach(() => { clearStore() })
  afterEach(() => { clearStore() })

  test("Checkpoint rewards stay out of the OLAS totals", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractWithUtility(contractAddress, false)

    handleServiceStaked(createServiceStakedEvent(serviceId, TestConstants.EPOCH_5, contractAddress))
    handleCheckpoint(
      createCheckpointEvent(TestConstants.EPOCH_5, [serviceId], [TestConstants.REWARD_1000], contractAddress)
    )

    assert.fieldEquals("Global", "", "totalRewards", "0")
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsEarned", "0")
    assert.entityCount("RewardUpdate", 0)
    // the raw event is still recorded
    assert.entityCount("Checkpoint", 1)
  })

  test("Non-OLAS services do not skew numServices or the median", () => {
    let olasContract = TestAddresses.CONTRACT_1
    let otherContract = TestAddresses.CONTRACT_2
    createStakingContractWithUtility(olasContract, true)
    createStakingContractWithUtility(otherContract, false)

    // one service earning OLAS, two that only ever stake elsewhere
    handleServiceStaked(createServiceStakedEvent(TestConstants.SERVICE_ID_1, TestConstants.EPOCH_5, olasContract))
    handleServiceStaked(createServiceStakedEvent(TestConstants.SERVICE_ID_2, TestConstants.EPOCH_5, otherContract))
    handleServiceStaked(createServiceStakedEvent(TestConstants.SERVICE_ID_3, TestConstants.EPOCH_5, otherContract))

    assert.fieldEquals("Service", TestConstants.SERVICE_ID_1.toString(), "hasOlasStake", "true")
    assert.fieldEquals("Service", TestConstants.SERVICE_ID_2.toString(), "hasOlasStake", "false")

    handleCheckpoint(
      createCheckpointEvent(TestConstants.EPOCH_5, [TestConstants.SERVICE_ID_1], [TestConstants.REWARD_1000], olasContract)
    )

    let day = Bytes.fromUTF8(getDayTimestamp(BigInt.fromI32(1)).toString())
    let snapshot = CumulativeDailyStakingGlobal.load(day)
    assert.assertNotNull(snapshot)
    // one OLAS service, not three, and its reward rather than a zero-dragged median
    assert.i32Equals(1, snapshot!.numServices)
    assert.stringEquals(TestConstants.REWARD_1000.toString(), snapshot!.medianCumulativeRewards.toString())
  })

  test("Claimed rewards stay out of the OLAS totals", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractWithUtility(contractAddress, false)

    handleServiceStaked(createServiceStakedEvent(serviceId, TestConstants.EPOCH_5, contractAddress))
    handleRewardClaimed(
      createRewardClaimedEvent(serviceId, TestConstants.EPOCH_5, TestConstants.REWARD_1000, contractAddress)
    )

    assert.fieldEquals("Global", "", "totalRewardsClaimed", "0")
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "0")
    assert.entityCount("RewardClaimed", 1)
  })

  test("Unstake rewards stay out of the OLAS totals", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractWithUtility(contractAddress, false)

    handleServiceStaked(createServiceStakedEvent(serviceId, TestConstants.EPOCH_5, contractAddress))
    handleServiceUnstaked(
      createServiceUnstakedEvent(serviceId, TestConstants.EPOCH_5, TestConstants.REWARD_1000, contractAddress)
    )

    assert.fieldEquals("Global", "", "totalRewardsClaimed", "0")
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "0")
    assert.entityCount("RewardUpdate", 0)
    // the raw event is still recorded
    assert.entityCount("ServiceUnstaked", 1)
  })
})

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
    createStakingContractEntity(contractAddress)

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
    createStakingContractEntity(contractAddress)

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
    createStakingContractEntity(contractAddress)

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
    createStakingContractEntity(contractAddress)

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
    createStakingContractEntity(contractAddress)

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
    createStakingContractEntity(contractAddress)

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

    // Check service is NOT removed from ActiveServiceEpoch (to enable continuous tracking)
    let activeKey = createActiveEpochId(contractAddress, epoch)
    let activeServiceEpoch = ActiveServiceEpoch.load(activeKey)
    assert.assertNotNull(activeServiceEpoch)
    assert.i32Equals(1, activeServiceEpoch!.activeServiceIds.length)
  })

  test("ServiceForceUnstaked clears latestStakingContract without crediting a claim", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    let reward = TestConstants.REWARD_500
    createStakingContractEntity(contractAddress)

    // Stake service
    let stakeEvent = createServiceStakedEvent(serviceId, epoch, contractAddress)
    handleServiceStaked(stakeEvent)

    // Force unstake with reward
    let forceUnstakeEvent = createServiceForceUnstakedEvent(serviceId, epoch, reward, contractAddress)
    handleServiceForceUnstaked(forceUnstakeEvent)

    // The reward returns to availableRewards, so nothing was claimed
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "0")

    // Check latestStakingContract was cleared
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", "null")
  })

  test("totalEpochsParticipated increments correctly", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractEntity(contractAddress)

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
    createStakingContractEntity(contractAddress)

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
    createStakingContractEntity(contractAddress)

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
    createStakingContractEntity(contract1)
    createStakingContractEntity(contract2)

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
    createStakingContractEntity(contract1)
    createStakingContractEntity(contract2)

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

    // === STEP 3: After 2 days (epoch 2 and 3), user is evicted ===
    let checkpointEvent2 = createCheckpointEvent(BigInt.fromI32(2), [], [], contract1)
    handleCheckpoint(checkpointEvent2)
    let epoch3 = BigInt.fromI32(3)
    let evictEvent = createServicesEvictedEvent(epoch3, [serviceId], contract1)
    handleServicesEvicted(evictEvent)
    let checkpointEvent3 = createCheckpointEvent(epoch3, [], [], contract1)
    handleCheckpoint(checkpointEvent3)


    // Verify: latestStakingContract NOT cleared (continuous tracking), no rewards claimed
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contract1.toHexString())
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "0")
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "3")

    // === STEP 4: After 2 more days (epoch 4 and 5), user restakes ===
    let checkpointEvent4 = createCheckpointEvent(BigInt.fromI32(4), [], [], contract1)
    handleCheckpoint(checkpointEvent4)
    let epoch5 = BigInt.fromI32(5)
    let unstakeEvent = createServiceUnstakedEvent(serviceId, epoch5, BigInt.fromI32(0), contract1)
    handleServiceUnstaked(unstakeEvent)
    let stakeEvent2 = createServiceStakedEvent(serviceId, epoch5, contract1)
    handleServiceStaked(stakeEvent2)

    // Verify: latestStakingContract set again, totalEpochsParticipated increased
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contract1.toHexString())
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "5")
    let historyId2 = createHistoryId(serviceId, contract1, epoch5)
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "rewardAmount", "0")

    // === STEP 5: Checkpoint at epoch 5 - user earns rewards ===
    let reward1 = TestConstants.REWARD_1000
    let checkpointEvent5 = createCheckpointEvent(
      epoch5,
      [serviceId],
      [reward1],
      contract1
    )
    handleCheckpoint(checkpointEvent5)

    // Verify: History shows rewards earned
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "rewardAmount", reward1.toString())
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsEarned", reward1.toString())
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "5")

    // === STEP 6: User moves to another contract but there current epoch is 3 ===
    let stakeEvent3 = createServiceStakedEvent(serviceId, epoch3, contract2)
    handleServiceStaked(stakeEvent3)

    // Verify: latestStakingContract updated to new contract, totalEpochsParticipated increased
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contract2.toHexString())
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "6")
    let historyId3 = createHistoryId(serviceId, contract2, epoch3)
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "contractAddress", contract2.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "rewardAmount", "0")

    // === STEP 7: Checkpoint at epoch 6 on new contract - user earns more rewards ===
    let reward2 = TestConstants.REWARD_500
    let checkpointEvent6 = createCheckpointEvent(
      epoch3,
      [serviceId],
      [reward2],
      contract2
    )
    handleCheckpoint(checkpointEvent6)

    // Verify: New history entry shows rewards, total rewards accumulated
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "rewardAmount", reward2.toString())
    let totalRewards = reward1.plus(reward2).toString()
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsEarned", totalRewards)

    // === FINAL VERIFICATION: Check all history entries exist ===
    // History entry 1: Original stake at epoch 1 (no rewards)
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "epoch", epoch1.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "contractAddress", contract1.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId1, "rewardAmount", "0")

    // History entry 2: Epoch 2 checkpoint (no rewards during eviction period)
    let historyId2Checkpoint = createHistoryId(serviceId, contract1, BigInt.fromI32(2))
    assert.fieldEquals("ServiceRewardsHistory", historyId2Checkpoint, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId2Checkpoint, "epoch", "2")
    assert.fieldEquals("ServiceRewardsHistory", historyId2Checkpoint, "contractAddress", contract1.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId2Checkpoint, "rewardAmount", "0")

    // History entry 3: Epoch 3 checkpoint and eviction (no rewards)
    let historyId3Checkpoint = createHistoryId(serviceId, contract1, epoch3)
    assert.fieldEquals("ServiceRewardsHistory", historyId3Checkpoint, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3Checkpoint, "epoch", epoch3.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3Checkpoint, "contractAddress", contract1.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3Checkpoint, "rewardAmount", "0")

    // History entry 4: Epoch 4 checkpoint (no rewards during gap period)
    let historyId4Checkpoint = createHistoryId(serviceId, contract1, BigInt.fromI32(4))
    assert.fieldEquals("ServiceRewardsHistory", historyId4Checkpoint, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId4Checkpoint, "epoch", "4")
    assert.fieldEquals("ServiceRewardsHistory", historyId4Checkpoint, "contractAddress", contract1.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId4Checkpoint, "rewardAmount", "0")

    // History entry 5: Restake at epoch 5 with rewards
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "epoch", epoch5.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "contractAddress", contract1.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "rewardAmount", reward1.toString())

    // History entry 6: New contract with rewards at epoch 3
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "epoch", epoch3.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "contractAddress", contract2.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId3, "rewardAmount", reward2.toString())

    // Final service state
    assert.fieldEquals("Service", serviceId.toString(), "totalEpochsParticipated", "6")
    assert.fieldEquals("Service", serviceId.toString(), "latestStakingContract", contract2.toHexString())
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsEarned", totalRewards)
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "0")
  })

  // Edge cases
  test("Checkpoint deduplicates and does not clobber next epoch tracker", () => {
    let serviceId1 = TestConstants.SERVICE_ID_1 // Staked in current epoch
    let serviceId2 = TestConstants.SERVICE_ID_2 // Stakes for NEXT epoch early
    let epoch = TestConstants.EPOCH_5
    let nextEpoch = epoch.plus(BigInt.fromI32(1))
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractEntity(contractAddress)

    // 1. Service 1 stakes in Epoch 5
    let stakeEvent1 = createServiceStakedEvent(serviceId1, epoch, contractAddress)
    handleServiceStaked(stakeEvent1)

    // 2. Service 2 stakes in Epoch 6 (Race condition: before Epoch 5 checkpoint)
    let stakeEvent2 = createServiceStakedEvent(serviceId2, nextEpoch, contractAddress)
    handleServiceStaked(stakeEvent2)

    // 3. Process Checkpoint for Epoch 5
    let checkpointEvent = createCheckpointEvent(epoch, [serviceId1], [TestConstants.REWARD_1000], contractAddress)
    handleCheckpoint(checkpointEvent)

    // VERIFY: Epoch 6 tracker should contain BOTH services (Deduplicated merge)
    let nextKey = createActiveEpochId(contractAddress, nextEpoch)
    let nextTracker = ActiveServiceEpoch.load(nextKey)
    assert.assertNotNull(nextTracker)
    
    // If logic were broken, serviceId2 would be missing because nextTracker was overwritten
    let ids = nextTracker!.activeServiceIds
    assert.i32Equals(2, ids.length)
    assert.assertTrue(ids.includes(serviceId1))
    assert.assertTrue(ids.includes(serviceId2))
  })

  
})

describe("Global reward accumulators", () => {
  beforeEach(() => {
    clearStore()
  })

  afterEach(() => {
    clearStore()
  })

  test("Checkpoint accumulates Global.totalRewards and leaves claimed at zero", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractEntity(contractAddress)

    handleServiceStaked(createServiceStakedEvent(serviceId, epoch, contractAddress))
    handleCheckpoint(
      createCheckpointEvent(epoch, [serviceId], [TestConstants.REWARD_1000], contractAddress)
    )

    assert.fieldEquals("Global", "", "totalRewards", TestConstants.REWARD_1000.toString())
    assert.fieldEquals("Global", "", "totalRewardsClaimed", "0")
  })

  test("RewardClaimed accumulates Global.totalRewardsClaimed", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractEntity(contractAddress)

    handleServiceStaked(createServiceStakedEvent(serviceId, epoch, contractAddress))
    handleRewardClaimed(
      createRewardClaimedEvent(serviceId, epoch, TestConstants.REWARD_1000, contractAddress)
    )
    handleRewardClaimed(
      createRewardClaimedEvent(serviceId, epoch, TestConstants.REWARD_250, contractAddress)
    )

    let expected = TestConstants.REWARD_1000.plus(TestConstants.REWARD_250)
    assert.fieldEquals("Global", "", "totalRewardsClaimed", expected.toString())
  })

  test("ServiceUnstaked payout counts as claimed", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractEntity(contractAddress)

    handleServiceStaked(createServiceStakedEvent(serviceId, epoch, contractAddress))
    handleServiceUnstaked(
      createServiceUnstakedEvent(serviceId, epoch, TestConstants.REWARD_500, contractAddress)
    )

    assert.fieldEquals("Global", "", "totalRewardsClaimed", TestConstants.REWARD_500.toString())
  })

  test("ServiceForceUnstaked is not a claim: no accumulator, no RewardUpdate", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractEntity(contractAddress)

    handleServiceStaked(createServiceStakedEvent(serviceId, epoch, contractAddress))
    handleServiceForceUnstaked(
      createServiceForceUnstakedEvent(serviceId, epoch, TestConstants.REWARD_500, contractAddress)
    )

    // _unstake(enforced=true) returns the reward to availableRewards
    assert.fieldEquals("Global", "", "totalRewardsClaimed", "0")
    assert.fieldEquals("Service", serviceId.toString(), "olasRewardsClaimed", "0")
    assert.entityCount("RewardUpdate", 0)
  })

  test("A day opened by a claim carries totalRewards forward", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractEntity(contractAddress)

    let stakeEvent = createServiceStakedEvent(serviceId, epoch, contractAddress)
    handleServiceStaked(stakeEvent)
    handleCheckpoint(
      createCheckpointEvent(epoch, [serviceId], [TestConstants.REWARD_1000], contractAddress)
    )

    // a later day whose only activity is a claim, so the snapshot is created there
    let dayTwo = getDayTimestamp(stakeEvent.block.timestamp).plus(BigInt.fromI32(86400))
    let claimEvent = createRewardClaimedEvent(serviceId, epoch, TestConstants.REWARD_250, contractAddress)
    claimEvent.block.timestamp = dayTwo
    handleRewardClaimed(claimEvent)

    let dayTwoSnapshot = CumulativeDailyStakingGlobal.load(Bytes.fromUTF8(dayTwo.toString()))
    assert.assertNotNull(dayTwoSnapshot)
    // carried forward from Global rather than restarting at zero
    assert.stringEquals(TestConstants.REWARD_1000.toString(), dayTwoSnapshot!.totalRewards.toString())
    assert.stringEquals(TestConstants.REWARD_250.toString(), dayTwoSnapshot!.totalRewardsClaimed.toString())
  })

  test("Daily snapshot carries both cumulative totals", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let epoch = TestConstants.EPOCH_5
    let contractAddress = TestAddresses.CONTRACT_1
    createStakingContractEntity(contractAddress)

    let stakeEvent = createServiceStakedEvent(serviceId, epoch, contractAddress)
    handleServiceStaked(stakeEvent)
    handleCheckpoint(
      createCheckpointEvent(epoch, [serviceId], [TestConstants.REWARD_1000], contractAddress)
    )
    handleRewardClaimed(
      createRewardClaimedEvent(serviceId, epoch, TestConstants.REWARD_250, contractAddress)
    )

    let dayId = Bytes.fromUTF8(getDayTimestamp(stakeEvent.block.timestamp).toString())
    let snapshot = CumulativeDailyStakingGlobal.load(dayId)
    assert.assertNotNull(snapshot)
    assert.stringEquals(TestConstants.REWARD_1000.toString(), snapshot!.totalRewards.toString())
    assert.stringEquals(TestConstants.REWARD_250.toString(), snapshot!.totalRewardsClaimed.toString())
  })
})
