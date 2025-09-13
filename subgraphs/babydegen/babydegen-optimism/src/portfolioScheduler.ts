import { ethereum, BigInt, Bytes, Address, log } from "@graphprotocol/graph-ts"
import { Service, ServiceRegistry, AgentPortfolio } from "../../../../generated/schema"
import { calculatePortfolioMetrics } from "./helpers"
import { calculateGlobalMetrics } from "./globalMetrics"

/**
 * Portfolio Scheduler
 * 
 * This module handles the scheduling of portfolio snapshots at UTC midnight.
 * Instead of taking snapshots at fixed time intervals (e.g., hourly),
 * it now takes one snapshot per day at UTC midnight.
 * 
 * The implementation uses the same approach as the DailyServiceActivity
 * in the service registry, which also takes snapshots at UTC midnight.
 */

// Constants
const CHECK_INTERVAL = BigInt.fromI32(100) // Check every 100 blocks
const ONE_DAY = BigInt.fromI32(86400) // 86400 seconds in a day

/**
 * Gets the timestamp for the start of the day (UTC midnight) for a given timestamp
 * This is used to determine if we've crossed into a new UTC day
 * 
 * The calculation works by:
 * 1. Dividing the timestamp by the day period (86400 seconds normally)
 * 2. Truncating to an integer (floor division)
 * 3. Multiplying back by the day period to get the start of the day
 * 
 * For example, with timestamp 1628097654 (Wed Aug 04 2021 15:40:54 UTC):
 * 1628097654 / 86400 = 18843.72... (truncated to 18843)
 * 18843 * 86400 = 1628035200 (Wed Aug 04 2021 00:00:00 UTC)
 * 
 * @param timestamp The timestamp to get the day timestamp for
 * @returns The timestamp for the start of the day (UTC midnight)
 */
function getDayTimestamp(timestamp: BigInt): BigInt {
  return timestamp.div(ONE_DAY).times(ONE_DAY)
}

/**
 * Handles each new block to check if portfolio snapshots are due
 * 
 * This function is called for each new block and:
 * 1. Checks if the block number is a multiple of CHECK_INTERVAL to reduce overhead
 * 2. If so, checks all registered services to see if they need a snapshot
 * 
 * @param block The new block
 */
export function handleBlock(block: ethereum.Block): void {
  // Only check every N blocks to reduce overhead
  if (block.number.mod(CHECK_INTERVAL).notEqual(BigInt.zero())) {
    return
  }
  
  // Check all services for snapshot requirements
  checkServicesForSnapshot(block)
}

/**
 * Checks all registered services to see if they need a snapshot
 * 
 * This function:
 * 1. Gets all registered services from the ServiceRegistry
 * 2. For each service, checks if a snapshot is due
 * 3. If a snapshot is due, triggers the portfolio calculation and updates tracking
 * 
 * @param block The current block
 */
function checkServicesForSnapshot(block: ethereum.Block): void {
  // Get the service registry
  let registryId = Bytes.fromUTF8("registry")
  let registry = ServiceRegistry.load(registryId)
  
  if (registry == null || registry.serviceAddresses == null) {
    return
  }
  
  let serviceAddresses = registry.serviceAddresses
  let snapshotsCreated = false
  
  for (let i = 0; i < serviceAddresses.length; i++) {
    let serviceAddress = serviceAddresses[i]
    
    // Check if snapshot is due for this service
    if (isSnapshotDue(serviceAddress, block)) {
      
      // Trigger portfolio calculation which will create snapshot
      // Convert Bytes to Address for calculatePortfolioMetrics
      calculatePortfolioMetrics(Address.fromBytes(serviceAddress), block)
      
      // Update snapshot tracking in portfolio
      updateSnapshotTracking(serviceAddress, block)
      
      snapshotsCreated = true
    }
  }
  
  // After all agent snapshots are created, calculate global metrics
  if (snapshotsCreated) {
    calculateGlobalMetrics(block)
  }
}

/**
 * Determines if a snapshot is due for a service based on UTC midnight crossing
 * 
 * A snapshot is due if:
 * 1. This is the first snapshot for the portfolio (lastSnapshotTimestamp is zero)
 * 2. The current block timestamp is in a new UTC day compared to the last snapshot
 * 
 * @param serviceAddress The address of the service to check
 * @param block The current block
 * @returns True if a snapshot is due, false otherwise
 */
function isSnapshotDue(serviceAddress: Bytes, block: ethereum.Block): boolean {
  // Load the portfolio to check last snapshot time
  let portfolio = AgentPortfolio.load(serviceAddress)
  
  if (portfolio == null) {
    // No portfolio yet, create snapshot when portfolio is created
    return false
  }
  
  // Check if this is the first snapshot
  if (portfolio.lastSnapshotTimestamp.equals(BigInt.zero())) {
    return true
  }
  
  // Get day timestamps for current block and last snapshot
  let currentDayTimestamp = getDayTimestamp(block.timestamp)
  let lastSnapshotDayTimestamp = getDayTimestamp(portfolio.lastSnapshotTimestamp)
  
  // Only take a snapshot if we've crossed into a new UTC day
  let isDue = currentDayTimestamp.gt(lastSnapshotDayTimestamp)
  
  return isDue
}

/**
 * Updates the snapshot tracking information for a service
 * 
 * This function is called after a snapshot has been taken to update:
 * - lastSnapshotTimestamp: The timestamp of the last snapshot
 * - lastSnapshotBlock: The block number of the last snapshot
 * 
 * It also logs the UTC day change for debugging purposes
 * 
 * @param serviceAddress The address of the service to update
 * @param block The current block
 */
function updateSnapshotTracking(serviceAddress: Bytes, block: ethereum.Block): void {
  let portfolio = AgentPortfolio.load(serviceAddress)
  
  if (portfolio != null) {
    // Get the old and new day timestamps for logging
    let oldDayTimestamp = getDayTimestamp(portfolio.lastSnapshotTimestamp)
    let newDayTimestamp = getDayTimestamp(block.timestamp)
    
    portfolio.lastSnapshotTimestamp = block.timestamp
    portfolio.lastSnapshotBlock = block.number
    portfolio.save()
    
  }
}

/**
 * Registers a service for portfolio snapshots
 * 
 * This function adds a service to the ServiceRegistry, which is used by
 * the portfolio scheduler to determine which services to check for snapshots.
 * 
 * @param serviceAddress The address of the service to register
 */
export function registerServiceForSnapshots(serviceAddress: Bytes): void {
  let registryId = Bytes.fromUTF8("registry")
  let registry = ServiceRegistry.load(registryId)
  
  if (registry == null) {
    registry = new ServiceRegistry(registryId)
    registry.serviceAddresses = []
  }
  
  // Check if service is already registered
  let addresses = registry.serviceAddresses
  let isRegistered = false
  
  for (let i = 0; i < addresses.length; i++) {
    if (addresses[i].equals(serviceAddress)) {
      isRegistered = true
      break
    }
  }
  
  // Add if not already registered
  if (!isRegistered) {
    addresses.push(serviceAddress)
    registry.serviceAddresses = addresses
    registry.save()
    
  }
}
