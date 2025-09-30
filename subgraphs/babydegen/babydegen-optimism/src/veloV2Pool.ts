import { 
  Mint,
  Burn,
  Transfer
} from "../../../../generated/templates/VeloV2Pool/VelodromeV2Pool"

import { 
  refreshVeloV2PositionWithEventAmounts,
  refreshVeloV2PositionWithBurnAmounts,
  refreshVeloV2Position,
  ensureVeloV2PoolTemplate
} from "./veloV2Shared"

import { BigInt, Bytes, store } from "@graphprotocol/graph-ts"
import { getServiceByAgent } from "./config"
import { PendingMintPosition, ProtocolPosition } from "../../../../generated/schema"
import { getTokenPriceUSD } from "./priceDiscovery"
import { getTokenDecimals } from "./tokenUtils"
import { Address, BigDecimal } from "@graphprotocol/graph-ts"

// Helper function to convert token amount to human readable format
function toHumanAmount(amount: BigInt, decimals: i32): BigDecimal {
  if (amount.equals(BigInt.zero())) {
    return BigDecimal.zero()
  }
  
  let divisor = BigInt.fromI32(10).pow(decimals as u8)
  return amount.toBigDecimal().div(divisor.toBigDecimal())
}

// Store pending position that needs mint data
function storePendingPosition(txHash: Bytes, poolAddress: Bytes, positionId: Bytes, recipient: Bytes): void {
  const id = txHash.toHexString() + "-" + poolAddress.toHexString()
  let pending = new PendingMintPosition(id)
  pending.txHash = txHash
  pending.poolAddress = poolAddress
  pending.positionId = positionId
  pending.recipient = recipient
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
      
      // Create the position with placeholder amounts (will be updated by Mint event)
      refreshVeloV2Position(to, event.address, event.block, event.transaction.hash)
      
      // Store this position as pending mint data
      const positionId = to.toHex() + "-velodromev2-" + event.address.toHex()
      storePendingPosition(
        event.transaction.hash,
        event.address,
        Bytes.fromUTF8(positionId),
        to
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
      // Get token decimals for conversion
      const token0Decimals = getTokenDecimals(Address.fromBytes(position.token0!))
      const token1Decimals = getTokenDecimals(Address.fromBytes(position.token1!))
      
      // Convert to human amounts
      const amount0Human = toHumanAmount(event.params.amount0, token0Decimals)
      const amount1Human = toHumanAmount(event.params.amount1, token1Decimals)
      
      // Get USD values
      const token0Price = getTokenPriceUSD(Address.fromBytes(position.token0!), event.block.timestamp, false)
      const token1Price = getTokenPriceUSD(Address.fromBytes(position.token1!), event.block.timestamp, false)
      
      const amount0USD = token0Price.times(amount0Human)
      const amount1USD = token1Price.times(amount1Human)
      const totalUSD = amount0USD.plus(amount1USD)
      
      // Update entry amounts
      position.entryAmount0 = amount0Human
      position.entryAmount0USD = amount0USD
      position.entryAmount1 = amount1Human
      position.entryAmount1USD = amount1USD
      position.entryAmountUSD = totalUSD
      
      
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
