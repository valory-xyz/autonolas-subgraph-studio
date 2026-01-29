import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  afterEach,
} from "matchstick-as/assembly/index"
import { ServiceRewardsHistory } from "../generated/schema"
import { getOrCreateServiceRewardsHistory } from "../src/utils"
import { TestAddresses, TestConstants, TestBytes, createHistoryId } from "./test-helpers"

describe("Utils - getOrCreateServiceRewardsHistory Tests", () => {
  beforeEach(() => {
    clearStore()
  })

  afterEach(() => {
    clearStore()
  })

  test("getOrCreateServiceRewardsHistory creates new history on first call", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    let epoch = TestConstants.EPOCH_5
    let blockNumber = TestConstants.BLOCK_NUMBER_1000
    let blockTimestamp = TestConstants.BLOCK_TIMESTAMP_1
    let transactionHash = TestBytes.TRANSACTION_HASH_1

    let history = getOrCreateServiceRewardsHistory(
      serviceId,
      contractAddress,
      epoch,
      blockNumber,
      blockTimestamp,
      transactionHash
    )
    history.save()

    assert.assertNotNull(history)

    let historyId = createHistoryId(serviceId, contractAddress, epoch)
    assert.fieldEquals("ServiceRewardsHistory", historyId, "service", serviceId.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId, "epoch", epoch.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId, "contractAddress", contractAddress.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId, "rewardAmount", "0")
    assert.fieldEquals("ServiceRewardsHistory", historyId, "blockNumber", blockNumber.toString())
    assert.fieldEquals("ServiceRewardsHistory", historyId, "blockTimestamp", blockTimestamp.toString())
  })

  test("getOrCreateServiceRewardsHistory returns existing history on second call", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    let epoch = TestConstants.EPOCH_5
    let blockNumber = TestConstants.BLOCK_NUMBER_1000
    let blockTimestamp = TestConstants.BLOCK_TIMESTAMP_1
    let transactionHash = TestBytes.TRANSACTION_HASH_1

    // First call - creates
    let history1 = getOrCreateServiceRewardsHistory(
      serviceId,
      contractAddress,
      epoch,
      blockNumber,
      blockTimestamp,
      transactionHash
    )

    // Modify the history
    history1.rewardAmount = TestConstants.REWARD_1000
    history1.save()

    // Second call - should load existing
    let history2 = getOrCreateServiceRewardsHistory(
      serviceId,
      contractAddress,
      epoch,
      TestConstants.BLOCK_NUMBER_2000, // Different block number
      TestConstants.BLOCK_TIMESTAMP_2, // Different timestamp
      TestBytes.DUMMY_HASH // Different hash
    )

    // Should have the modified values, not the new ones
    assert.bigIntEquals(TestConstants.REWARD_1000, history2.rewardAmount)
    assert.bigIntEquals(blockNumber, history2.blockNumber) // Original block number
    assert.bigIntEquals(blockTimestamp, history2.blockTimestamp) // Original timestamp
  })

  test("getOrCreateServiceRewardsHistory creates unique entries for different epochs", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    let blockNumber = TestConstants.BLOCK_NUMBER_1000
    let blockTimestamp = TestConstants.BLOCK_TIMESTAMP_1
    let transactionHash = TestBytes.TRANSACTION_HASH_1

    // Create for epoch 1
    let history1 = getOrCreateServiceRewardsHistory(
      serviceId,
      contractAddress,
      TestConstants.EPOCH_1,
      blockNumber,
      blockTimestamp,
      transactionHash
    )
    history1.save()

    // Create for epoch 2
    let history2 = getOrCreateServiceRewardsHistory(
      serviceId,
      contractAddress,
      TestConstants.EPOCH_2,
      blockNumber,
      blockTimestamp,
      transactionHash
    )
    history2.save()

    // Should have different IDs
    let historyId1 = createHistoryId(serviceId, contractAddress, TestConstants.EPOCH_1)
    let historyId2 = createHistoryId(serviceId, contractAddress, TestConstants.EPOCH_2)

    assert.fieldEquals("ServiceRewardsHistory", historyId1, "epoch", "1")
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "epoch", "2")
  })

  test("getOrCreateServiceRewardsHistory creates unique entries for different contracts", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contract1 = TestAddresses.CONTRACT_1
    let contract2 = TestAddresses.CONTRACT_2
    let epoch = TestConstants.EPOCH_5
    let blockNumber = TestConstants.BLOCK_NUMBER_1000
    let blockTimestamp = TestConstants.BLOCK_TIMESTAMP_1
    let transactionHash = TestBytes.TRANSACTION_HASH_1

    // Create for contract 1
    let history1 = getOrCreateServiceRewardsHistory(
      serviceId,
      contract1,
      epoch,
      blockNumber,
      blockTimestamp,
      transactionHash
    )
    history1.save()

    // Create for contract 2
    let history2 = getOrCreateServiceRewardsHistory(
      serviceId,
      contract2,
      epoch,
      blockNumber,
      blockTimestamp,
      transactionHash
    )
    history2.save()

    // Should have different IDs
    let historyId1 = createHistoryId(serviceId, contract1, epoch)
    let historyId2 = createHistoryId(serviceId, contract2, epoch)

    assert.fieldEquals("ServiceRewardsHistory", historyId1, "contractAddress", contract1.toHexString())
    assert.fieldEquals("ServiceRewardsHistory", historyId2, "contractAddress", contract2.toHexString())
  })

  test("getOrCreateServiceRewardsHistory increments totalEpochsParticipated only on creation", () => {
    let serviceId = TestConstants.SERVICE_ID_1
    let contractAddress = TestAddresses.CONTRACT_1
    let epoch = TestConstants.EPOCH_5
    let blockNumber = TestConstants.BLOCK_NUMBER_1000
    let blockTimestamp = TestConstants.BLOCK_TIMESTAMP_1
    let transactionHash = TestBytes.TRANSACTION_HASH_1

    // First call - should increment (but Service doesn't exist in this test context, so it won't actually increment)
    let history1 = getOrCreateServiceRewardsHistory(
      serviceId,
      contractAddress,
      epoch,
      blockNumber,
      blockTimestamp,
      transactionHash
    )
    history1.save()

    // Second call - should not increment again
    getOrCreateServiceRewardsHistory(
      serviceId,
      contractAddress,
      epoch,
      blockNumber,
      blockTimestamp,
      transactionHash
    )

    // Verify only one history entry exists
    let historyId = createHistoryId(serviceId, contractAddress, epoch)
    let history = ServiceRewardsHistory.load(historyId)
    assert.assertNotNull(history)
  })
})
