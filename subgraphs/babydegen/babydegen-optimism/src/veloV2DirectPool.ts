import { 
  Mint,
  Burn,
  Transfer
} from "../generated/VeloV2Pool_USDC_LUSD/VelodromeV2Pool"

import { 
  refreshVeloV2Position,
  refreshVeloV2PositionWithBurnAmounts
} from "./veloV2Shared"

import { log } from "@graphprotocol/graph-ts"
import { isSafe } from "./common"

// Handle direct VelodromeV2 Pool Mint events
export function handleVeloV2DirectMint(event: Mint): void {
  log.warning("===== VELODROME V2 DIRECT MINT EVENT START =====", [])
  log.warning("VELODROME V2 DIRECT: Block: {}, TxHash: {}", [
    event.block.number.toString(),
    event.transaction.hash.toHexString()
  ])
  log.warning("VELODROME V2 DIRECT: Pool: {}, Sender: {}", [
    event.address.toHexString(),
    event.params.sender.toHexString()
  ])
  log.warning("VELODROME V2 DIRECT: Amounts - amount0: {}, amount1: {}", [
    event.params.amount0.toString(),
    event.params.amount1.toString()
  ])
  log.warning("VELODROME V2 DIRECT: Transaction from: {}", [
    event.transaction.from.toHexString()
  ])
  
  // For direct pool tracking, we don't need to wait for Transfer
  // The Mint event tells us liquidity was added
  // But we still need the Transfer event to know who received the LP tokens
  log.warning("VELODROME V2 DIRECT: Mint detected, waiting for Transfer event to identify LP recipient", [])
  log.warning("===== VELODROME V2 DIRECT MINT EVENT END =====", [])
}

// Handle direct VelodromeV2 Pool Burn events
export function handleVeloV2DirectBurn(event: Burn): void {
  log.warning("===== VELODROME V2 DIRECT BURN EVENT START =====", [])
  log.warning("VELODROME V2 DIRECT BURN: Block: {}, TxHash: {}", [
    event.block.number.toString(),
    event.transaction.hash.toHexString()
  ])
  log.warning("VELODROME V2 DIRECT BURN: Pool: {}, Sender: {}, To: {}", [
    event.address.toHexString(),
    event.params.sender.toHexString(),
    event.params.to.toHexString()
  ])
  log.warning("VELODROME V2 DIRECT BURN: Amounts - amount0: {}, amount1: {}", [
    event.params.amount0.toString(),
    event.params.amount1.toString()
  ])
  
  const userAddress = event.transaction.from
  log.warning("VELODROME V2 DIRECT BURN: Refreshing position for user: {}", [
    userAddress.toHexString()
  ])
  
  refreshVeloV2PositionWithBurnAmounts(
    userAddress,
    event.address,
    event.block,
    event.params.amount0,
    event.params.amount1,
    event.transaction.hash
  )
  
  log.warning("===== VELODROME V2 DIRECT BURN EVENT END =====", [])
}

// Handle direct VelodromeV2 Pool Transfer events
export function handleVeloV2DirectTransfer(event: Transfer): void {
  const from = event.params.from
  const to = event.params.to
  const value = event.params.value
  
  log.warning("===== VELODROME V2 DIRECT TRANSFER EVENT START =====", [])
  log.warning("VELODROME V2 DIRECT TRANSFER: Block: {}, TxHash: {}", [
    event.block.number.toString(),
    event.transaction.hash.toHexString()
  ])
  log.warning("VELODROME V2 DIRECT TRANSFER: Pool: {}, From: {}, To: {}, Value: {}", [
    event.address.toHexString(),
    from.toHexString(),
    to.toHexString(),
    value.toString()
  ])
  
  // Handle minting (from zero address)
  if (from.toHexString() == "0x0000000000000000000000000000000000000000") {
    log.warning("VELODROME V2 DIRECT: LP tokens minted to {}", [to.toHexString()])
    
    if (isSafe(to)) {
      log.warning("VELODROME V2 DIRECT: ✅ LP MINTED TO SAFE! Refreshing position", [])
      refreshVeloV2Position(to, event.address, event.block, event.transaction.hash)
    } else {
      log.warning("VELODROME V2 DIRECT: LP minted to non-Safe address, refreshing anyway", [])
      refreshVeloV2Position(to, event.address, event.block, event.transaction.hash)
    }
    
    log.warning("===== VELODROME V2 DIRECT TRANSFER EVENT END =====", [])
    return
  }
  
  // Handle burning (to zero address)
  if (to.toHexString() == "0x0000000000000000000000000000000000000000") {
    log.warning("VELODROME V2 DIRECT: LP tokens burned from {}", [from.toHexString()])
    refreshVeloV2Position(from, event.address, event.block, event.transaction.hash)
    log.warning("===== VELODROME V2 DIRECT TRANSFER EVENT END =====", [])
    return
  }
  
  // Handle regular transfers
  log.warning("VELODROME V2 DIRECT: Regular transfer, updating both positions", [])
  refreshVeloV2Position(from, event.address, event.block, event.transaction.hash)
  refreshVeloV2Position(to, event.address, event.block, event.transaction.hash)
  
  log.warning("===== VELODROME V2 DIRECT TRANSFER EVENT END =====", [])
}
