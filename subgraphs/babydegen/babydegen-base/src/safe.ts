import { BigInt, BigDecimal, Bytes, ethereum, Address, log } from "@graphprotocol/graph-ts"
import {
  Safe,
  SafeReceived as SafeReceivedEvent,
  ExecutionSuccess as ExecutionSuccessEvent,
  ExecutionFromModuleSuccess as ExecutionFromModuleSuccessEvent
} from "../generated/templates/Safe/Safe"
import { isUserSide, isWithdrawalRecipient, getAddressType, AddressTypeReader, getEthUsd, uintAt, addressAt, ABI_WORD } from "./common"
import { getServiceByAgent } from "./config"
import { updateFundingBalance, updateWithdrawalBalance } from "./tokenBalances"
import { updateETHBalance } from "./tokenBalances"

// ETH funding and withdrawals use the same user-side rule as ERC-20 ones (isUserSide, common.ts).
// ETH in comes from SafeReceived; ETH out from the execTransaction calldata, and from the
// SafeReceived of another Safe we index when that calldata could not be read.

const EXEC_TRANSACTION_SELECTOR = "0x6a761202" // execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)
const MULTI_SEND_SELECTOR = "0x8d80ff0a"       // multiSend(bytes)
const OPERATION_CALL = 0
const OPERATION_DELEGATECALL = 1
// MultiSend packs each call as operation (1 byte) | to (20) | value (32) | data length (32) | data
const PACKED_CALL_HEADER = 85

export function handleSafeReceived(event: SafeReceivedEvent): void {
  processSafeReceived(event, getAddressType)
}

export function processSafeReceived(event: SafeReceivedEvent, readAddressType: AddressTypeReader): void {
  // Handle funding balance update for ETH received
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
      updateFundingBalance(to, ethUsdValue(value, event.block), event.block.timestamp, txHash)
    }
    updateETHBalance(to, value, true, event.block)
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
    updateWithdrawalBalance(from, ethUsdValue(value, event.block), event.block.timestamp)
  }
  updateETHBalance(from, value, false, event.block)
}

function ethUsdValue(wei: BigInt, block: ethereum.Block): BigDecimal {
  return wei.toBigDecimal().times(getEthUsd(block)).div(BigDecimal.fromString("1e18"))
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

// What the Safe's calldata shows it sent; `readable` is false when the calldata could not be read,
// as opposed to read and found to send nothing
class EthSends {
  sends: EthSend[]
  readable: boolean

  constructor(sends: EthSend[], readable: boolean) {
    this.sends = sends
    this.readable = readable
  }
}

function unreadable(): EthSends {
  return new EthSends([], false)
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
  return bytes.length >= 4 && Bytes.fromUint8Array(bytes.subarray(0, 4)).toHexString() == selector
}

// The `bytes` argument whose offset is in the head word at `head`, or null when it runs past `args`
function bytesArgAt(args: Uint8Array, head: i32): Uint8Array | null {
  let offset = sizeAt(args, head)
  let length = offset < 0 ? -1 : sizeAt(args, offset)
  if (length < 0 || offset + ABI_WORD + length > args.length) {
    return null
  }
  return args.subarray(offset + ABI_WORD, offset + ABI_WORD + length)
}

// The calls with value packed in multiSend(bytes transactions) calldata
function multiSendEthSends(data: Uint8Array): EthSends {
  let sends: EthSend[] = []
  let packed = bytesArgAt(data.subarray(4), 0)
  if (packed === null) {
    return unreadable()
  }
  let i = 0
  while (i < packed.length) {
    if (i + PACKED_CALL_HEADER > packed.length) {
      return unreadable()
    }
    let operation = packed[i] as i32
    let to = Address.fromBytes(Bytes.fromUint8Array(packed.subarray(i + 1, i + 21)))
    let value = uintAt(packed, i + 21)
    let dataLength = sizeAt(packed, i + 53)
    if (dataLength < 0) {
      return unreadable()
    }
    // A packed DELEGATECALL runs code in the Safe; its `value` field moves no ETH
    if (operation == OPERATION_CALL && value.gt(BigInt.zero())) {
      sends.push(new EthSend(to, value))
    }
    i += PACKED_CALL_HEADER + dataLength
  }
  return new EthSends(sends, true)
}

// ETH the Safe itself sends when the tx calls its execTransaction: the Call's value, or each Call
// of a MultiSend it delegatecalls. The outer tx's own value is the executor's, not the Safe's. An
// execTransaction relayed through another contract is not readable here.
function ethSentBySafe(safe: Address, tx: ethereum.Transaction): EthSends {
  let txTo = tx.to
  if (txTo === null || !txTo.equals(safe) || !hasSelector(tx.input, EXEC_TRANSACTION_SELECTOR)) {
    return unreadable()
  }
  let args = tx.input.subarray(4)
  if (args.length < 4 * ABI_WORD) {
    return unreadable()
  }
  let to = addressAt(args, 0)
  let value = uintAt(args, ABI_WORD)
  let operation = uintAt(args, 3 * ABI_WORD)
  if (operation.equals(BigInt.fromI32(OPERATION_CALL))) {
    return new EthSends(value.gt(BigInt.zero()) ? [new EthSend(to, value)] : [], true)
  }
  if (!operation.equals(BigInt.fromI32(OPERATION_DELEGATECALL))) {
    return unreadable()
  }
  let data = bytesArgAt(args, 2 * ABI_WORD)
  if (data === null) {
    return unreadable()
  }
  return hasSelector(data, MULTI_SEND_SELECTOR) ? multiSendEthSends(data) : unreadable()
}

// True when `safe`'s own calldata in this tx shows it sending `value` ETH to `to`
function decodedSendOf(safe: Address, tx: ethereum.Transaction, to: Address, value: BigInt): boolean {
  let sends = ethSentBySafe(safe, tx).sends
  for (let i = 0; i < sends.length; i++) {
    if (sends[i].to.equals(to) && sends[i].value.equals(value)) {
      return true
    }
  }
  return false
}

/**
 * ETH the service Safe sends out in an execTransaction (its ExecutionSuccess)
 * @param serviceSafe The safe address that executed the transaction
 * @param event The Safe event, whose transaction and receipt are read
 * @param readAddressType Address-type reader, getAddressType outside tests
 */
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
  if (!decoded.readable) {
    log.warning("SAFE_ETH: tx {} — ETH safe {} sends is not readable from the tx calldata (relayed or malformed execTransaction); any ETH it sent is not counted", [
      event.transaction.hash.toHexString(),
      serviceSafe.toHexString()
    ])
    return
  }
  let sends = decoded.sends
  for (let i = 0; i < sends.length; i++) {
    let send = sends[i]
    updateETHBalance(serviceSafe, send.value, false, block)
    if (isWithdrawalRecipient(send.to, serviceSafe, event, readAddressType)) {
      updateWithdrawalBalance(serviceSafe, ethUsdValue(send.value, block), block.timestamp)
    }
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
