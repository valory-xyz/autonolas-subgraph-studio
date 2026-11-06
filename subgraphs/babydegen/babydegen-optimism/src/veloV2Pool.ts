import { 
  Mint,
  Burn,
  Transfer
} from "../generated/templates/VeloV2Pool/VelodromeV2Pool"
import { Mint as AeroV2Mint } from "../generated/templates/AeroV2Pool/AeroV2Pool"

import {
  refreshVeloV2PositionWithBurnAmounts,
  refreshVeloV2Position,
  getVeloV2PositionId
} from "./veloV2Shared"

import { BigInt, Bytes, store } from "@graphprotocol/graph-ts"
import { getServiceByAgent } from "./config"
import { PendingMintPosition, ProtocolPosition } from "../generated/schema"
import { getTokenPriceUSD } from "./priceDiscovery"
import { convertTokenAmount } from "./tokenUtils"
import { initializePositionIncome, initializePositionCosts } from "./roiCalculation"
import { Address, BigDecimal, ethereum } from "@graphprotocol/graph-ts"


// Store pending position that needs mint data
function storePendingPosition(txHash: Bytes, poolAddress: Bytes, positionId: Bytes, recipient: Bytes, startsEntry: boolean): void {
  const id = txHash.toHexString() + "-" + poolAddress.toHexString()
  let pending = new PendingMintPosition(id)
  pending.txHash = txHash
  pending.poolAddress = poolAddress
  pending.positionId = positionId
  pending.recipient = recipient
  pending.startsEntry = startsEntry
  pending.save()
  
}

// Retrieve and remove pending position
function getPendingPosition(txHash: Bytes, poolAddress: Bytes): PendingMintPosition | null {
  const id = txHash.toHexString() + "-" + poolAddress.toHexString()
  let pending = PendingMintPosition.load(id)
  if (pending != null) {
    // Remove the data after retrieval to keep storage clean
    store.remove("PendingMintPosition", id)
  }
  return pending
}

// Restarts a reused v2 row as a new one (CLAUDE.md: v2 position cycles)
function startNewCycle(pp: ProtocolPosition, event: ethereum.Event): void {
  initializePositionIncome(pp)
  pp.exitTxHash = null
  pp.exitTimestamp = null
  pp.exitAmount0 = null
  pp.exitAmount0USD = null
  pp.exitAmount1 = null
  pp.exitAmount1USD = null
  pp.exitAmountUSD = null
  pp.entryTxHash = event.transaction.hash
  pp.entryTimestamp = event.block.timestamp
  pp.entryAmount0 = BigDecimal.zero()
  pp.entryAmount0USD = BigDecimal.zero()
  pp.entryAmount1 = BigDecimal.zero()
  pp.entryAmount1USD = BigDecimal.zero()
  pp.entryAmountUSD = BigDecimal.zero()
  initializePositionCosts(pp)
}

// Handle VelodromeV2 Pool Transfer events (LP token transfers) - THIS COMES FIRST
export function handleVeloV2Transfer(event: Transfer): void {
  const from = event.params.from
  const to = event.params.to
  const value = event.params.value
  
  
  // Handle minting (from zero address) - THIS IS WHERE WE CREATE THE POSITION
  if (from.toHexString() == "0x0000000000000000000000000000000000000000") {
    
    // Check if the recipient is a service
    const service = getServiceByAgent(to)
    
    if (service != null) {
      // Read before the refresh below marks the row active again (CLAUDE.md: v2 position cycles)
      const closed = ProtocolPosition.load(getVeloV2PositionId(to, event.address))
      const startsEntry = closed == null || !closed.isActive
      if (closed != null && !closed.isActive) {
        startNewCycle(closed, event)
      }

      // Create the position with placeholder amounts (will be updated by Mint event)
      refreshVeloV2Position(to, event.address, event.block, event.transaction.hash)
      
      // Store this position as pending mint data
      storePendingPosition(
        event.transaction.hash,
        event.address,
        getVeloV2PositionId(to, event.address),
        to,
        startsEntry
      )
    }
    return
  }
  
  // Handle burning (to zero address)
  if (to.toHexString() == "0x0000000000000000000000000000000000000000") {
    refreshVeloV2Position(from, event.address, event.block, event.transaction.hash)
    return
  }
  
  // Handle regular transfers between addresses
  refreshVeloV2Position(from, event.address, event.block, event.transaction.hash)
  refreshVeloV2Position(to, event.address, event.block, event.transaction.hash)
}

// Handle VelodromeV2 Pool Mint events (liquidity additions) - THIS COMES SECOND
export function handleVeloV2Mint(event: Mint): void {
  recordMintEntryAmounts(event, event.params.amount0, event.params.amount1)
}

// Aero v2 pools emit Mint(indexed sender, indexed to, amount0, amount1); the entry
// amounts are recorded the same way.
export function handleAeroV2Mint(event: AeroV2Mint): void {
  recordMintEntryAmounts(event, event.params.amount0, event.params.amount1)
}

function recordMintEntryAmounts(event: ethereum.Event, amount0: BigInt, amount1: BigInt): void {
  
  // Note: In Velodrome V2, the Mint event sender is the router contract, not the actual user
  // We need to look for the pending position to determine if this mint is for a tracked service
  
  // Look for pending position created in the Transfer event
  const pending = getPendingPosition(event.transaction.hash, event.address)
  
  if (pending != null) {
    // Validate that the pending position is for a tracked service
    const recipientService = getServiceByAgent(Address.fromBytes(pending.recipient))
    
    if (recipientService != null) {
    
    // Load the position
    let position = ProtocolPosition.load(pending.positionId)
    
    if (position != null) {
      // Convert to human amounts
      const amount0Human = convertTokenAmount(amount0, Address.fromBytes(position.token0!))
      const amount1Human = convertTokenAmount(amount1, Address.fromBytes(position.token1!))
      
      // Get USD values
      const token0Price = getTokenPriceUSD(Address.fromBytes(position.token0!), event.block.timestamp, false)
      const token1Price = getTokenPriceUSD(Address.fromBytes(position.token1!), event.block.timestamp, false)
      
      const amount0USD = token0Price.times(amount0Human)
      const amount1USD = token1Price.times(amount1Human)
      const totalUSD = amount0USD.plus(amount1USD)
      
      // The Mint after the LP mint that found the row missing or closed starts the entry, replacing
      // anything its refresh filled in from current amounts. Every later Mint, in this tx or another, adds
      if (pending.startsEntry) {
        position.entryAmount0 = amount0Human
        position.entryAmount0USD = amount0USD
        position.entryAmount1 = amount1Human
        position.entryAmount1USD = amount1USD
        position.entryAmountUSD = totalUSD
      } else {
        position.entryAmount0 = position.entryAmount0.plus(amount0Human)
        position.entryAmount0USD = position.entryAmount0USD.plus(amount0USD)
        position.entryAmount1 = position.entryAmount1.plus(amount1Human)
        position.entryAmount1USD = position.entryAmount1USD.plus(amount1USD)
        position.entryAmountUSD = position.entryAmountUSD.plus(totalUSD)
      }
      // What calculatePositionROI divides by: the cycle's entry plus its costs
      position.investmentUSD = position.entryAmountUSD.plus(position.totalCostsUSD)
      
      position.save()
      
      // Also refresh the current state
      refreshVeloV2Position(
        Address.fromBytes(pending.recipient),
        event.address,
        event.block,
        event.transaction.hash
      )
    }
    }
  }
}

// Handle VelodromeV2 Pool Burn events (liquidity removals)
export function handleVeloV2Burn(event: Burn): void {
  
  // The 'to' address is where the tokens are being sent (the actual user/recipient)
  // In VelodromeV2, the burn event's 'to' parameter indicates who receives the tokens
  const userAddress = event.params.to
  
  // Check if the recipient is a tracked service
  const userService = getServiceByAgent(userAddress)
  
  if (userService != null) {
    
    refreshVeloV2PositionWithBurnAmounts(
      userAddress,
      event.address, // pool address
      event.block,
      event.params.amount0,
      event.params.amount1,
      event.transaction.hash
    )
    
    return
  }
  
  // If 'to' is not a service, check if 'sender' is a service (fallback)
  // This handles cases where the service might be the sender instead of recipient
  const senderService = getServiceByAgent(event.params.sender)
  if (senderService != null) {
    
    refreshVeloV2PositionWithBurnAmounts(
      event.params.sender,
      event.address,
      event.block,
      event.params.amount0,
      event.params.amount1,
      event.transaction.hash
    )
    
    return
  }
  
}

// Swap and Sync events are completely removed - not needed for portfolio tracking
