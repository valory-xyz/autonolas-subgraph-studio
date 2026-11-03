import { assert, describe, test, clearStore, afterEach, beforeEach } from "matchstick-as/assembly/index"
import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts"
import { newMockEvent } from "matchstick-as/assembly/index"
import { processERC20Transfer } from "../src/tokenBalances"
import { processSafeReceived, processSafeEthTransfer } from "../src/safe"
import { SafeReceived, ExecutionFromModuleSuccess } from "../generated/templates/Safe/Safe"
import { handleRegisterInstance } from "../src/serviceRegistry"
import { USDC_NATIVE, USDC_BRIDGED, WETH } from "../src/constants"
import { createRegisterInstanceEvent } from "./mapping-utils"
import { newLog, newReceipt, newTransfer, mockEthUsd, seedService, seedAddressType, seedTokenPrice, seededAddressType } from "./fixtures"
import { OPERATOR_SAFE, AGENT_INSTANCE, SERVICE_ID, OPTIMUS_AGENT_ID, BLOCK_NUMBER, BLOCK_TIMESTAMP } from "./test-helpers"

const USER_EOA = Address.fromString("0x00000000000000000000000000000000000000e0")
const OTHER_SAFE = Address.fromString("0x00000000000000000000000000000000000000e1")
const SOME_CONTRACT = Address.fromString("0x00000000000000000000000000000000000000e2")

// Optimism tx 0xf2a832e7…: Safe 0xf3bb39 sends 231.883683 USDC to an EIP-7702 wallet (has code, not a Safe)
const SAFE_7702 = Address.fromString("0xf3bb3983b68b8b4979adb6e1ddd2aadbaa48ad93")
const WALLET_7702 = Address.fromString("0x8ce734aabe677aed77b69f1d391cdb610a21d675")
// Optimism tx 0x6d10752f…: Safe 0xd32613 enters Velodrome CL pool 0x1737…; only the position NFTs come back
const SAFE_CL = Address.fromString("0xd32613ed605be41d9c7fbc85f2ccb4fba59778ac")
const CL_POOL = Address.fromString("0x1737275d53a5ca5dac582a493aa32c85ba2cfad3")

function fundingField(safe: Address, field: string, value: string): void {
  assert.fieldEquals("FundingBalance", safe.toHexString(), field, value)
}

describe("funding: every tracked token counts", () => {
  beforeEach(() => {
    mockEthUsd()
    seedTokenPrice(USDC_NATIVE, "USDC", 6, "1")
    seedTokenPrice(USDC_BRIDGED, "USDC.e", 6, "1")
  })
  afterEach(() => {
    clearStore()
  })

  test("USDC.e from the user's EOA is funding", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(USER_EOA, false, false)
    processERC20Transfer(newTransfer(USDC_BRIDGED, USER_EOA, SAFE_CL, BigInt.fromI64(700000000), 1, newReceipt([])), seededAddressType)
    fundingField(SAFE_CL, "totalInUsd", "700")
  })

  test("USDC.e back to the user's EOA is a withdrawal", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(USER_EOA, false, false)
    processERC20Transfer(newTransfer(USDC_BRIDGED, SAFE_CL, USER_EOA, BigInt.fromI64(250000000), 1, newReceipt([])), seededAddressType)
    fundingField(SAFE_CL, "totalWithdrawnUsd", "250")
  })

  test("a deposit from another Safe is funding", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(OTHER_SAFE, true, true)
    processERC20Transfer(newTransfer(USDC_NATIVE, OTHER_SAFE, SAFE_CL, BigInt.fromI64(5000000), 1, newReceipt([])), seededAddressType)
    fundingField(SAFE_CL, "totalInUsd", "5")
  })

  test("the agent EOA is never the user side, in or out", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(AGENT_INSTANCE, false, false)
    processERC20Transfer(newTransfer(USDC_NATIVE, AGENT_INSTANCE, SAFE_CL, BigInt.fromI64(5000000), 1, newReceipt([])), seededAddressType)
    processERC20Transfer(newTransfer(USDC_NATIVE, SAFE_CL, AGENT_INSTANCE, BigInt.fromI64(5000000), 2, newReceipt([])), seededAddressType)
    assert.notInStore("FundingBalance", SAFE_CL.toHexString())
  })

  test("a mint (from the zero address) is not funding", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    processERC20Transfer(newTransfer(USDC_NATIVE, Address.zero(), SAFE_CL, BigInt.fromI64(5000000), 1, newReceipt([])), seededAddressType)
    assert.notInStore("FundingBalance", SAFE_CL.toHexString())
  })

  test("a deposit sent by the tx's own sender (e.g. an EIP-7702 wallet) is funding", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(SOME_CONTRACT, true, false)
    let event = newTransfer(USDC_NATIVE, SOME_CONTRACT, SAFE_CL, BigInt.fromI64(5000000), 1, newReceipt([]))
    event.transaction.from = SOME_CONTRACT
    processERC20Transfer(event, seededAddressType)
    fundingField(SAFE_CL, "totalInUsd", "5")
  })

  test("a deposit from a non-Safe contract is not funding", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(SOME_CONTRACT, true, false)
    processERC20Transfer(newTransfer(USDC_NATIVE, SOME_CONTRACT, SAFE_CL, BigInt.fromI64(5000000), 1, newReceipt([])), seededAddressType)
    assert.notInStore("FundingBalance", SAFE_CL.toHexString())
  })
})

describe("withdrawals to contracts are decided by the receipt", () => {
  beforeEach(() => {
    mockEthUsd()
    seedTokenPrice(USDC_NATIVE, "USDC", 6, "1")
  })
  afterEach(() => {
    clearStore()
  })

  test("EIP-7702 wallet, nothing back to the Safe (0xf2a832e7): withdrawal", () => {
    seedService(SAFE_7702, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(WALLET_7702, true, false)
    let receipt = newReceipt([
      newLog("0x0b2c639c533813f4aa9d7837caf62653d097ff85", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000f3bb3983b68b8b4979adb6e1ddd2aadbaa48ad93", "0x0000000000000000000000008ce734aabe677aed77b69f1d391cdb610a21d675"], "0x000000000000000000000000000000000000000000000000000000000dd243a3", 75),
      newLog("0xf3bb3983b68b8b4979adb6e1ddd2aadbaa48ad93", ["0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e"], "0x2859762c57d561ace7b6909dce7f972f60efdb4a2be6216b0ed3f818624f3b170000000000000000000000000000000000000000000000000000000000000000", 76),
    ])
    processERC20Transfer(newTransfer(USDC_NATIVE, SAFE_7702, WALLET_7702, BigInt.fromI64(231883683), 75, receipt), seededAddressType)
    fundingField(SAFE_7702, "totalWithdrawnUsd", "231.883683")
  })

  test("CL entry, position NFT back to the Safe (0x6d10752f): not a withdrawal", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(CL_POOL, true, false)
    let receipt = newReceipt([
      newLog("0x0b2c639c533813f4aa9d7837caf62653d097ff85", ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x000000000000000000000000416b433906b1b72fa758e166e239c43d68dc6f29"], "0x0000000000000000000000000000000000000000000000000000000000993e04", 305),
      newLog("0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x000000000000000000000000416b433906b1b72fa758e166e239c43d68dc6f29"], "0x0000000000000000000000000000000000000000000000000d85189d07959f37", 306),
      newLog("0x0b2c639c533813f4aa9d7837caf62653d097ff85", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x0000000000000000000000001737275d53a5ca5dac582a493aa32c85ba2cfad3"], "0x000000000000000000000000000000000000000000000000000000000006ea0f", 307),
      newLog("0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x0000000000000000000000001737275d53a5ca5dac582a493aa32c85ba2cfad3"], "0x0000000000000000000000000000000000000000000000000d39b8dc4e86df6a", 308),
      newLog("0x1737275d53a5ca5dac582a493aa32c85ba2cfad3", ["0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde", "0x000000000000000000000000416b433906b1b72fa758e166e239c43d68dc6f29", "0x0000000000000000000000000000000000000000000000000000000000043761", "0x0000000000000000000000000000000000000000000000000000000000043765"], "0x000000000000000000000000416b433906b1b72fa758e166e239c43d68dc6f290000000000000000000000000000000000000000000000000018fb0eefec76b9000000000000000000000000000000000000000000000000000000000006ea0f0000000000000000000000000000000000000000000000000d39b8dc4e86df6a", 309),
      newLog("0x416b433906b1b72fa758e166e239c43d68dc6f29", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x00000000000000000000000000000000000000000000000000000000003872ae"], "0x", 310),
      newLog("0x416b433906b1b72fa758e166e239c43d68dc6f29", ["0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f", "0x00000000000000000000000000000000000000000000000000000000003872ae"], "0x0000000000000000000000000000000000000000000000000018fb0eefec76b9000000000000000000000000000000000000000000000000000000000006ea0f0000000000000000000000000000000000000000000000000d39b8dc4e86df6a", 311),
      newLog("0x0b2c639c533813f4aa9d7837caf62653d097ff85", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x0000000000000000000000001737275d53a5ca5dac582a493aa32c85ba2cfad3"], "0x00000000000000000000000000000000000000000000000000000000000030a0", 312),
      newLog("0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x0000000000000000000000001737275d53a5ca5dac582a493aa32c85ba2cfad3"], "0x000000000000000000000000000000000000000000000000003ae196135c72e0", 313),
      newLog("0x1737275d53a5ca5dac582a493aa32c85ba2cfad3", ["0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde", "0x000000000000000000000000416b433906b1b72fa758e166e239c43d68dc6f29", "0x000000000000000000000000000000000000000000000000000000000004375e", "0x0000000000000000000000000000000000000000000000000000000000043768"], "0x000000000000000000000000416b433906b1b72fa758e166e239c43d68dc6f29000000000000000000000000000000000000000000000000000034cc71d22dff00000000000000000000000000000000000000000000000000000000000030a0000000000000000000000000000000000000000000000000003ae196135c72e0", 314),
      newLog("0x416b433906b1b72fa758e166e239c43d68dc6f29", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x00000000000000000000000000000000000000000000000000000000003872af"], "0x", 315),
      newLog("0x416b433906b1b72fa758e166e239c43d68dc6f29", ["0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f", "0x00000000000000000000000000000000000000000000000000000000003872af"], "0x000000000000000000000000000000000000000000000000000034cc71d22dff00000000000000000000000000000000000000000000000000000000000030a0000000000000000000000000000000000000000000000000003ae196135c72e0", 316),
      newLog("0x0b2c639c533813f4aa9d7837caf62653d097ff85", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x0000000000000000000000001737275d53a5ca5dac582a493aa32c85ba2cfad3"], "0x0000000000000000000000000000000000000000000000000000000000000f7b", 317),
      newLog("0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x0000000000000000000000001737275d53a5ca5dac582a493aa32c85ba2cfad3"], "0x00000000000000000000000000000000000000000000000000107e2aa5b24bc3", 318),
      newLog("0x1737275d53a5ca5dac582a493aa32c85ba2cfad3", ["0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde", "0x000000000000000000000000416b433906b1b72fa758e166e239c43d68dc6f29", "0x000000000000000000000000000000000000000000000000000000000004375a", "0x000000000000000000000000000000000000000000000000000000000004376c"], "0x000000000000000000000000416b433906b1b72fa758e166e239c43d68dc6f29000000000000000000000000000000000000000000000000000008b2c3332bb90000000000000000000000000000000000000000000000000000000000000f7b00000000000000000000000000000000000000000000000000107e2aa5b24bc3", 319),
      newLog("0x416b433906b1b72fa758e166e239c43d68dc6f29", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x00000000000000000000000000000000000000000000000000000000003872b0"], "0x", 320),
      newLog("0x416b433906b1b72fa758e166e239c43d68dc6f29", ["0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f", "0x00000000000000000000000000000000000000000000000000000000003872b0"], "0x000000000000000000000000000000000000000000000000000008b2c3332bb90000000000000000000000000000000000000000000000000000000000000f7b00000000000000000000000000000000000000000000000000107e2aa5b24bc3", 321),
      newLog("0xd32613ed605be41d9c7fbc85f2ccb4fba59778ac", ["0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e"], "0xbf23044b4d88fd36cf6f746726c98cdac4abcd1de077d71a8b880913f741bb320000000000000000000000000000000000000000000000000000000000000000", 322),
    ])
    processERC20Transfer(newTransfer(USDC_NATIVE, SAFE_CL, CL_POOL, BigInt.fromI64(453135), 307, receipt), seededAddressType)
    assert.notInStore("FundingBalance", SAFE_CL.toHexString())
  })
})

describe("RegisterInstance records the agent EOAs", () => {
  afterEach(() => {
    clearStore()
  })

  test("every agentInstance of a service is kept, once", () => {
    let second = Address.fromString("0x00000000000000000000000000000000000000a2")
    handleRegisterInstance(createRegisterInstanceEvent(OPERATOR_SAFE, SERVICE_ID, AGENT_INSTANCE, OPTIMUS_AGENT_ID))
    handleRegisterInstance(createRegisterInstanceEvent(OPERATOR_SAFE, SERVICE_ID, AGENT_INSTANCE, OPTIMUS_AGENT_ID))
    handleRegisterInstance(createRegisterInstanceEvent(OPERATOR_SAFE, SERVICE_ID, second, OPTIMUS_AGENT_ID))
    assert.fieldEquals("ServiceRegistration", "0x313030", "agentInstances",
      "[" + AGENT_INSTANCE.toHexString() + ", " + second.toHexString() + "]")
  })
})

function newSafeReceived(safe: Address, sender: Address, wei: BigInt): SafeReceived {
  let event = changetype<SafeReceived>(newMockEvent())
  event.address = safe
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam("sender", ethereum.Value.fromAddress(sender)))
  event.parameters.push(new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(wei)))
  event.block.number = BLOCK_NUMBER
  event.block.timestamp = BLOCK_TIMESTAMP
  return event
}

describe("ETH funding uses the same user-side rule", () => {
  beforeEach(() => {
    mockEthUsd()
    seedTokenPrice(WETH, "WETH", 18, "2000")
  })
  afterEach(() => {
    clearStore()
  })

  test("ETH from the user's EOA is funding", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(USER_EOA, false, false)
    processSafeReceived(newSafeReceived(SAFE_CL, USER_EOA, BigInt.fromString("500000000000000000")), seededAddressType)
    fundingField(SAFE_CL, "totalInUsd", "1000")
  })

  test("ETH a module execution sends to the user's EOA is a withdrawal", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(USER_EOA, false, false)
    let event = changetype<ExecutionFromModuleSuccess>(newMockEvent())
    event.address = SAFE_CL
    event.transaction.to = USER_EOA
    event.transaction.value = BigInt.fromString("500000000000000000")
    processSafeEthTransfer(SAFE_CL, event, seededAddressType)
    fundingField(SAFE_CL, "totalWithdrawnUsd", "1000")
  })

  test("ETH a module execution sends to the agent EOA is a cost, not a withdrawal", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    let event = changetype<ExecutionFromModuleSuccess>(newMockEvent())
    event.address = SAFE_CL
    event.transaction.to = AGENT_INSTANCE
    event.transaction.value = BigInt.fromString("500000000000000000")
    processSafeEthTransfer(SAFE_CL, event, seededAddressType)
    assert.notInStore("FundingBalance", SAFE_CL.toHexString())
  })

  test("ETH to the operator Safe is a withdrawal and leaves the initial value alone", () => {
    seedService(SAFE_CL, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(USER_EOA, false, false)
    processSafeReceived(newSafeReceived(SAFE_CL, USER_EOA, BigInt.fromString("1000000000000000000")), seededAddressType)
    processSafeReceived(newSafeReceived(OPERATOR_SAFE, SAFE_CL, BigInt.fromString("500000000000000000")), seededAddressType)
    fundingField(SAFE_CL, "totalWithdrawnUsd", "1000")
    fundingField(SAFE_CL, "netUsd", "2000")
  })
})
