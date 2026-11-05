import { BigInt, BigDecimal, Bytes, ethereum, Address, log } from "@graphprotocol/graph-ts"
import {
  Safe,
  SafeReceived as SafeReceivedEvent,
  ExecutionSuccess as ExecutionSuccessEvent,
  ExecutionFromModuleSuccess as ExecutionFromModuleSuccessEvent
} from "../generated/templates/Safe/Safe"
import { isUserSide, isWithdrawalRecipient, getAddressType, AddressTypeReader, uintAt, addressAt, ABI_WORD } from "./common"
import { getServiceByAgent } from "./config"
import { updateFundingBalance, updateWithdrawalBalance, updateETHBalance, transferUsdValue } from "./tokenBalances"
import { calculatePortfolioMetrics } from "./helpers"
import { WETH } from "./constants"

// ETH funding and withdrawals; the rules are in CLAUDE.md (Funding and withdrawals).

const EXEC_TRANSACTION_SELECTOR = "0x6a761202" // execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)
const MULTI_SEND_SELECTOR = "0x8d80ff0a"       // multiSend(bytes)
const OPERATION_CALL = 0
const OPERATION_DELEGATECALL = 1
const SELECTOR_LENGTH = 4
// MultiSend packs each call as operation (1 byte) | to (20) | value (32) | data length (32) | data
const PACKED_TO = 1
const PACKED_VALUE = 21
const PACKED_DATA_LENGTH = 53
const PACKED_CALL_HEADER = 85

// The ETH sends a Safe's calldata shows, or null with the reason it could not be read
// Built only through readSends / unreadable, so sends is null exactly when reason says why
class DecodedSends {
  sends: EthSend[] | null = null
  reason: string = ""
}

function readSends(sends: EthSend[]): DecodedSends {
  let decoded = new DecodedSends()
  decoded.sends = sends
  return decoded
}

function unreadable(reason: string): DecodedSends {
  let decoded = new DecodedSends()
  decoded.reason = reason
  return decoded
}

export function handleSafeReceived(event: SafeReceivedEvent): void {
  processSafeReceived(event, getAddressType)
}

export function processSafeReceived(event: SafeReceivedEvent, readAddressType: AddressTypeReader): void {
  // ETH into a service Safe (funding when from the user side), or from one into another indexed Safe
  let from = event.params.sender
  let to = event.address // The safe that received ETH (emitted the event)
  let value = event.params.value
  let txHash = event.transaction.hash.toHexString()
  
  // ENTRY POINT LOGGING - Always log when this handler is triggered
  let ethAmount = value.toBigDecimal().div(BigDecimal.fromString("1e18"))
  log.info("🔍 SAFE RECEIVED: Handler triggered", [
    "txHash", txHash,
    "from", from.toHexString(),
    "to", to.toHexString(),
    "amount", ethAmount.toString(),
    "block", event.block.number.toString(),
    "timestamp", event.block.timestamp.toString()
  ])
  
  let toService = getServiceByAgent(to)
  if (toService !== null) {
    if (isUserSide(from, to, event, readAddressType)) {
      updateFundingBalance(to, transferUsdValue(value, WETH, to, event), event.block.timestamp, txHash)
    }
    updateETHBalance(to, value, true, event.block)
    calculatePortfolioMetrics(to, event.block)
    return
  }

  // An outflow from a service Safe to this Safe; processSafeEthTransfer already counts a send it
  // reads from the service Safe's own calldata
  let fromService = getServiceByAgent(from)
  if (fromService === null || decodedSendOf(from, event.transaction, to, value)) {
    return
  }
  // Only Safes we index emit SafeReceived; the operator Safe and any other Safe are the user side
  if (isUserSide(to, from, event, readAddressType)) {
    updateWithdrawalBalance(from, transferUsdValue(value, WETH, from, event), event.block.timestamp)
  }
  updateETHBalance(from, value, false, event.block)
  calculatePortfolioMetrics(from, event.block)
}

// ETH the Safe sends to one address in one call of an execTransaction
class EthSend {
  to: Address
  value: BigInt

  constructor(to: Address, value: BigInt) {
    this.to = to
    this.value = value
  }
}

// A word read as a byte offset or length, or -1 when it cannot be one inside `bytes`
function sizeAt(bytes: Uint8Array, offset: i32): i32 {
  if (offset < 0 || offset + ABI_WORD > bytes.length) {
    return -1
  }
  let size = uintAt(bytes, offset)
  return size.gt(BigInt.fromI32(bytes.length)) ? -1 : size.toI32()
}

function hasSelector(bytes: Uint8Array, selector: string): boolean {
  return bytes.length >= SELECTOR_LENGTH && Bytes.fromUint8Array(bytes.subarray(0, SELECTOR_LENGTH)).toHexString() == selector
}

// The `bytes` argument whose offset is in the head word at `head`, or null when it runs past `args`
function bytesArgAt(args: Uint8Array, head: i32): Uint8Array | null {
  let offset = sizeAt(args, head)
  let length = sizeAt(args, offset)
  if (length < 0 || offset + ABI_WORD + length > args.length) {
    return null
  }
  return args.subarray(offset + ABI_WORD, offset + ABI_WORD + length)
}

// The calls with value packed in multiSend(bytes transactions) calldata
function multiSendEthSends(data: Uint8Array): DecodedSends {
  let sends: EthSend[] = []
  let packed = bytesArgAt(data.subarray(SELECTOR_LENGTH), 0)
  if (packed === null) {
    return unreadable("multiSend bytes argument runs past the calldata")
  }
  let i = 0
  while (i < packed.length) {
    if (i + PACKED_CALL_HEADER > packed.length) {
      return unreadable("multiSend packed call truncated")
    }
    let operation = packed[i] as i32
    let to = Address.fromBytes(Bytes.fromUint8Array(packed.subarray(i + PACKED_TO, i + PACKED_VALUE)))
    let value = uintAt(packed, i + PACKED_VALUE)
    let dataLength = sizeAt(packed, i + PACKED_DATA_LENGTH)
    if (dataLength < 0) {
      return unreadable("multiSend packed call data length runs past the calldata")
    }
    // A packed DELEGATECALL runs code in the Safe; its `value` field moves no ETH
    if (operation == OPERATION_CALL && value.gt(BigInt.zero())) {
      sends.push(new EthSend(to, value))
    }
    i += PACKED_CALL_HEADER + dataLength
  }
  return readSends(sends)
}

// ETH the Safe itself sends in the tx's execTransaction: the Call's value, or each Call of a
// MultiSend it delegatecalls
function ethSentBySafe(safe: Address, tx: ethereum.Transaction): DecodedSends {
  let txTo = tx.to
  if (txTo === null || !txTo.equals(safe)) {
    return unreadable("the tx is not sent to the Safe (relayed or module execution)")
  }
  if (!hasSelector(tx.input, EXEC_TRANSACTION_SELECTOR)) {
    return unreadable("the tx is not an execTransaction")
  }
  let args = tx.input.subarray(SELECTOR_LENGTH)
  if (args.length < 4 * ABI_WORD) {
    return unreadable("execTransaction calldata too short")
  }
  let to = addressAt(args, 0)
  let value = uintAt(args, ABI_WORD)
  let operation = uintAt(args, 3 * ABI_WORD)
  if (operation.equals(BigInt.fromI32(OPERATION_CALL))) {
    return readSends(value.gt(BigInt.zero()) ? [new EthSend(to, value)] : [])
  }
  if (!operation.equals(BigInt.fromI32(OPERATION_DELEGATECALL))) {
    return unreadable("unsupported operation " + operation.toString())
  }
  let data = bytesArgAt(args, 2 * ABI_WORD)
  if (data === null) {
    return unreadable("execTransaction data argument runs past the calldata")
  }
  if (!hasSelector(data, MULTI_SEND_SELECTOR)) {
    return unreadable("delegatecall to " + to.toHexString() + " is not a multiSend")
  }
  return multiSendEthSends(data)
}

// True when `safe`'s own calldata in this tx shows it sending `value` ETH to `to`
function decodedSendOf(safe: Address, tx: ethereum.Transaction, to: Address, value: BigInt): boolean {
  let sends = ethSentBySafe(safe, tx).sends
  if (sends === null) {
    return false
  }
  for (let i = 0; i < sends.length; i++) {
    if (sends[i].to.equals(to) && sends[i].value.equals(value)) {
      return true
    }
  }
  return false
}

// ETH the service Safe sends out in an execTransaction; reads the receipt (needs `receipt: true`)
export function processSafeEthTransfer(
  serviceSafe: Address,
  event: ethereum.Event,
  readAddressType: AddressTypeReader
): void {
  if (getServiceByAgent(serviceSafe) === null) {
    return
  }
  let block = event.block
  let decoded = ethSentBySafe(serviceSafe, event.transaction)
  let sends = decoded.sends
  if (sends === null) {
    log.warning("SAFE_ETH: tx {} — ETH safe {} sends is not read ({}); any ETH it sent is not counted", [
      event.transaction.hash.toHexString(),
      serviceSafe.toHexString(),
      decoded.reason
    ])
    return
  }
  for (let i = 0; i < sends.length; i++) {
    let send = sends[i]
    updateETHBalance(serviceSafe, send.value, false, block)
    if (isWithdrawalRecipient(send.to, serviceSafe, event, readAddressType)) {
      updateWithdrawalBalance(serviceSafe, transferUsdValue(send.value, WETH, serviceSafe, event), block.timestamp)
    }
  }
  if (sends.length > 0) {
    calculatePortfolioMetrics(serviceSafe, block)
  }
}

export function handleExecutionSuccess(event: ExecutionSuccessEvent): void {
  processSafeEthTransfer(event.address, event, getAddressType)
}

// A module's ETH sends are in the module's calldata, not the Safe's; the tx calldata belongs to
// whatever called the module, and an execTransaction in it is counted by its own ExecutionSuccess
export function handleExecutionFromModuleSuccess(event: ExecutionFromModuleSuccessEvent): void {
  if (getServiceByAgent(event.address) === null) {
    return
  }
  log.warning("SAFE_ETH: tx {} — ETH safe {} sends through module {} is not read; any ETH it sent is not counted", [
    event.transaction.hash.toHexString(),
    event.address.toHexString(),
    event.params.module.toHexString()
  ])
}
