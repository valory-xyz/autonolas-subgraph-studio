import {
  assert,
  describe,
  test,
  clearStore,
  afterEach
} from "matchstick-as/assembly/index"
import { Address, BigInt } from "@graphprotocol/graph-ts"
import { handleTransfer } from "../src/olas-l2"
import { createTransferEvent } from "./olas-l2-utils"

const ZERO_ADDRESS = Address.fromString("0x0000000000000000000000000000000000000000")
const USER_A = Address.fromString("0x0000000000000000000000000000000000000001")
const USER_B = Address.fromString("0x0000000000000000000000000000000000000002")
const AMOUNT = BigInt.fromI32(1000)

describe("handleTransfer", () => {
  afterEach(() => {
    clearStore()
  })

  test("Creates Transfer entity", () => {
    let event = createTransferEvent(USER_A, USER_B, AMOUNT)
    handleTransfer(event)

    assert.entityCount("Transfer", 1)
  })

  test("Mint increases token supply", () => {
    let event = createTransferEvent(ZERO_ADDRESS, USER_A, AMOUNT)
    handleTransfer(event)

    assert.entityCount("Token", 1)
    // Check token balance equals minted amount
    let tokenId = event.address.toHexString()
    assert.fieldEquals("Token", tokenId, "balance", AMOUNT.toString())
  })

  test("Burn decreases token supply", () => {
    // First mint
    let mintEvent = createTransferEvent(ZERO_ADDRESS, USER_A, AMOUNT)
    handleTransfer(mintEvent)

    // Then burn half
    let burnAmount = BigInt.fromI32(400)
    let burnEvent = createTransferEvent(USER_A, ZERO_ADDRESS, burnAmount)
    handleTransfer(burnEvent)

    let tokenId = burnEvent.address.toHexString()
    assert.fieldEquals("Token", tokenId, "balance", "600")
  })

  test("Mint increments holder count", () => {
    let event = createTransferEvent(ZERO_ADDRESS, USER_A, AMOUNT)
    handleTransfer(event)

    let tokenId = event.address.toHexString()
    assert.fieldEquals("Token", tokenId, "holderCount", "1")
  })

  test("Transfer between users does not change supply", () => {
    // Mint to USER_A first
    let mintEvent = createTransferEvent(ZERO_ADDRESS, USER_A, AMOUNT)
    handleTransfer(mintEvent)

    // Transfer from USER_A to USER_B
    let transferEvent = createTransferEvent(USER_A, USER_B, AMOUNT)
    handleTransfer(transferEvent)

    let tokenId = transferEvent.address.toHexString()
    assert.fieldEquals("Token", tokenId, "balance", AMOUNT.toString())
  })

  test("Holder count decrements when balance reaches zero", () => {
    // Mint to USER_A
    let mintEvent = createTransferEvent(ZERO_ADDRESS, USER_A, AMOUNT)
    handleTransfer(mintEvent)

    // Transfer all to USER_B
    let transferEvent = createTransferEvent(USER_A, USER_B, AMOUNT)
    handleTransfer(transferEvent)

    let tokenId = transferEvent.address.toHexString()
    // USER_A has 0 balance, USER_B has balance — holderCount should be 1
    assert.fieldEquals("Token", tokenId, "holderCount", "1")
  })

  test("Multiple holders tracked correctly", () => {
    // Mint to USER_A
    let event1 = createTransferEvent(ZERO_ADDRESS, USER_A, AMOUNT)
    handleTransfer(event1)

    // Mint to USER_B
    let event2 = createTransferEvent(ZERO_ADDRESS, USER_B, AMOUNT)
    handleTransfer(event2)

    let tokenId = event2.address.toHexString()
    assert.fieldEquals("Token", tokenId, "holderCount", "2")
    assert.fieldEquals("Token", tokenId, "balance", "2000")
  })

  test("TokenHolder balance updates correctly", () => {
    let event = createTransferEvent(ZERO_ADDRESS, USER_A, AMOUNT)
    handleTransfer(event)

    assert.entityCount("TokenHolder", 1)
    assert.fieldEquals("TokenHolder", USER_A.toHexString(), "balance", AMOUNT.toString())
  })
})
