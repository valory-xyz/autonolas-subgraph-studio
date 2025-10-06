import { BigInt, BigDecimal, ethereum, Address, log } from "@graphprotocol/graph-ts"
import {
  Safe,
  SafeReceived as SafeReceivedEvent,
  ExecutionSuccess as ExecutionSuccessEvent,
  ExecutionFromModuleSuccess as ExecutionFromModuleSuccessEvent
} from "../../../../generated/templates/Safe/Safe"
import { isFundingSource, getEthUsd } from "./common"
import { getServiceByAgent } from "./config"
import { updateFundingBalance } from "./tokenBalances"
import { updateETHBalance } from "./tokenBalances"

// NOTE: This subgraph is configured to ONLY track USDC and ETH transfers for funding balance calculations.
// ETH transfers out (through ExecutionSuccess and ExecutionFromModuleSuccess events) are now tracked for funding metrics.
// ETH transfers in are tracked via SafeReceived events.

export function handleSafeReceived(event: SafeReceivedEvent): void {
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
  
  // Check if the receiving safe is a service safe
  let toService = getServiceByAgent(to)
  
  if (toService !== null) {
    // This is an inflow TO a service safe
    // Check if sender is valid funding source for this service
    let isValidFundingSource = isFundingSource(from, to, event.block, txHash)
    
    if (isValidFundingSource) {
      // Convert ETH to USD
      let ethPrice = getEthUsd(event.block)
      let usd = value.toBigDecimal()
        .times(ethPrice)
        .div(BigDecimal.fromString("1e18")) // ETH has 18 decimals
      
      // Update funding balance
      updateFundingBalance(to, usd, true, event.block.timestamp)
      
      // Also update ETH balance in TokenBalance
      updateETHBalance(to, value, true, event.block)
    } else {
      // Still update ETH balance even if not from a funding source
      updateETHBalance(to, value, true, event.block)
    }
  } else {
    // Receiver is NOT a service safe
    // Check if the sender is a service safe (this would be an ETH outflow from service safe to external address)
    let fromService = getServiceByAgent(from)
    
    if (fromService !== null) {
      // This is an ETH outflow from service safe to external address
      
      // Convert ETH to USD
      let ethPrice = getEthUsd(event.block)
      let usd = value.toBigDecimal()
        .times(ethPrice)
        .div(BigDecimal.fromString("1e18")) // ETH has 18 decimals
      
      let ethAmount = value.toBigDecimal().div(BigDecimal.fromString("1e18"))
      
      // NEW LOGIC: Check if receiver is this service's operator safe
      if (to.equals(Address.fromBytes(fromService.operatorSafe))) {
        // This is Service Safe → Operator Safe transfer
        
        // Update funding balance for the SERVICE safe (outflow)
        updateFundingBalance(from, usd, false, event.block.timestamp)
        
        // Update ETH balance for the service safe (outflow)
        updateETHBalance(from, value, false, event.block)
        
        return // Exit early since we handled this case
      }
      
      
      // Always update ETH balance for the service safe (outflow)
      updateETHBalance(from, value, false, event.block)
    }
  }
}

/**
 * Helper function to handle ETH transfers for both ExecutionSuccess and ExecutionFromModuleSuccess events
 * @param serviceSafe The safe address that executed the transaction
 * @param eventType String identifying the type of event ('execution' or 'module')
 * @param block The block where the transaction occurred
 * @param tx The transaction object
 * @param txHash The transaction hash as a string
 * @param moduleAddress Optional module address for module executions
 * @param extraInfo Optional additional information to log (e.g. payment)
 */
function handleSafeEthTransfer(
  serviceSafe: Address,
  eventType: string,
  block: ethereum.Block,
  tx: ethereum.Transaction,
  txHash: string,
  moduleAddress: Address | null = null,
  extraInfo: string | null = null
): void {
  let service = getServiceByAgent(serviceSafe)
  
  if (service === null) {
    return // Not a service safe
  }
  
  // For ETH transfers, we need the transaction information
  let to = tx.to
  let value = tx.value
  
  // Check if this is a direct ETH transfer (value > 0 and to is valid)
  if (value.gt(BigInt.zero()) && to !== null) {
    
    // Always update ETH balance for outflows from service safe
    updateETHBalance(serviceSafe, value, false, block)
    
    // Check if receiver is valid funding source for this service
    let isValidFundingTarget = isFundingSource(to, serviceSafe, block, txHash)
    
    if (isValidFundingTarget) {
      // Convert ETH to USD for funding balance
      let ethPrice = getEthUsd(block)
      let usd = value.toBigDecimal()
        .times(ethPrice)
        .div(BigDecimal.fromString("1e18")) // ETH has 18 decimals
      
      // Update funding balance for ETH outflow
      updateFundingBalance(serviceSafe, usd, false, block.timestamp)
    }
  }
    
  // For complex transactions (like swaps), ETH might leave through internal calls
  // These are tracked via SafeReceived events on the receiving contracts
}

export function handleExecutionSuccess(event: ExecutionSuccessEvent): void {
  let serviceSafe = event.address
  let txHash = event.params.txHash.toHexString()
  let payment = event.params.payment
  
  handleSafeEthTransfer(
    serviceSafe,
    "ExecutionSuccess",
    event.block,
    event.transaction,
    event.transaction.hash.toHexString(), // Use actual transaction hash
    null,
    "payment: " + payment.toString()
  )
}

export function handleExecutionFromModuleSuccess(event: ExecutionFromModuleSuccessEvent): void {
  
  let serviceSafe = event.address
  let moduleAddress = event.params.module
  let txHash = event.transaction.hash.toHexString()
  
  handleSafeEthTransfer(
    serviceSafe,
    "ExecutionFromModuleSuccess",
    event.block,
    event.transaction,
    txHash,
    moduleAddress
  )
}
