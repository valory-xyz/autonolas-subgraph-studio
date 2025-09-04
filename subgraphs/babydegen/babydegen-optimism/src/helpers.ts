import { BigDecimal, BigInt, Address, Bytes, log, ethereum } from "@graphprotocol/graph-ts"
import { 
  FundingBalance, 
  AgentPortfolio, 
  AgentPortfolioSnapshot,
  ProtocolPosition,
  Service
} from "../generated/schema"
import { calculateUninvestedValue, updateFundingBalance } from "./tokenBalances"
import { getServiceByAgent } from "./config"

// Use the single source of truth for funding balance updates
export function updateFunding(
  serviceSafe: Address,
  usd: BigDecimal,
  deposit: boolean,
  ts: BigInt
): void {
  // Update funding balance using the shared function
  updateFundingBalance(serviceSafe, usd, deposit, ts)
  
  log.info("FUNDING: {} {} USD", [
    deposit ? "IN" : "OUT",
    usd.toString()
  ])
  
  // Update portfolio after funding change
  let block = new ethereum.Block(
    Bytes.empty(),
    Bytes.empty(),
    Bytes.empty(),
    Address.zero(),
    Bytes.empty(),
    Bytes.empty(),
    Bytes.empty(),
    BigInt.zero(),
    BigInt.zero(),
    BigInt.zero(),
    ts,
    BigInt.zero(),
    BigInt.zero(),
    BigInt.zero(),
    BigInt.zero()
  )
  calculatePortfolioMetrics(serviceSafe, block)
}

// Calculate portfolio metrics for an agent
export function calculatePortfolioMetrics(
  serviceSafe: Address, 
  block: ethereum.Block
): void {
  // Check if this is a valid service
  let service = getServiceByAgent(serviceSafe)
  if (service == null) {
    return
  }
  
  // Ensure portfolio exists (replaces the existing if/else logic)
  let portfolio = ensureAgentPortfolio(serviceSafe, block.timestamp)
  
  // 1. Get initial investment from FundingBalance
  let fundingBalance = FundingBalance.load(serviceSafe as Bytes)
  let initialValue = fundingBalance ? fundingBalance.netUsd : BigDecimal.zero()
  
  // 2. Calculate total positions value
  let positionsValue = calculatePositionsValue(serviceSafe)
  
  // 3. Calculate uninvested funds
  let uninvestedValue = calculateUninvestedValue(serviceSafe)
  
  // 4. Calculate total portfolio value (positions + uninvested)
  let finalValue = positionsValue.plus(uninvestedValue)
  
  // 5. Calculate ROI and APR
  let roi = BigDecimal.zero()
  let apr = BigDecimal.zero()
  
  if (initialValue.gt(BigDecimal.zero())) {
    // ROI = (final_value - initial_value) / initial_value * 100
    let profit = finalValue.minus(initialValue)
    roi = profit.div(initialValue).times(BigDecimal.fromString("100"))
    
    // APR calculation - use first trading timestamp or fallback to service creation
    let timestampForAPR = portfolio.firstTradingTimestamp
    
    // Fallback: If no trading activity, use service creation timestamp
    if (timestampForAPR.equals(BigInt.zero())) {
      let serviceEntity = Service.load(serviceSafe)
      if (serviceEntity != null && serviceEntity.latestRegistrationTimestamp.gt(BigInt.zero())) {
        timestampForAPR = serviceEntity.latestRegistrationTimestamp
        log.info("PORTFOLIO: Using service registration timestamp for APR calculation - agent: {}", [
          serviceSafe.toHexString()
        ])
      }
    }
    
    if (timestampForAPR.gt(BigInt.zero())) {
      let secondsSinceStart = block.timestamp.minus(timestampForAPR)
      let daysSinceStart = secondsSinceStart.toBigDecimal().div(BigDecimal.fromString("86400"))
      
      if (daysSinceStart.gt(BigDecimal.zero())) {
        // APR = roi * (365 / days_invested)
        let annualizationFactor = BigDecimal.fromString("365").div(daysSinceStart)
        apr = roi.times(annualizationFactor)
      }
    }
  }
  
  // Update portfolio
  portfolio.finalValue = finalValue
  portfolio.initialValue = initialValue  
  portfolio.positionsValue = positionsValue
  portfolio.uninvestedValue = uninvestedValue
  portfolio.roi = roi
  portfolio.apr = apr
  portfolio.lastUpdated = block.timestamp
  
  // Count positions
  let activeCount = 0
  let closedCount = 0
  
  // Get the service entity for position counting
  let serviceEntity = Service.load(serviceSafe)
  if (serviceEntity != null && serviceEntity.positionIds != null) {
    // Iterate through all position IDs
    let positionIds = serviceEntity.positionIds
    for (let i = 0; i < positionIds.length; i++) {
      let positionIdString = positionIds[i]
      let position: ProtocolPosition | null = null
      
      // Try loading position with different ID formats for robustness
      
      // Method 1: Try as direct UTF8 string (standard format)
      let directId = Bytes.fromUTF8(positionIdString)
      position = ProtocolPosition.load(directId)
      
      if (position == null) {
        // Method 2: Try as hex-decoded string (for any legacy hex-encoded IDs)
        // Check if the string looks like hex (starts with 0x and has even length)
        if (positionIdString.startsWith("0x") && positionIdString.length % 2 == 0) {
          // Convert hex string back to original string, then to Bytes
          let hexBytes = Bytes.fromHexString(positionIdString)
          let decodedString = hexBytes.toString()
          let decodedId = Bytes.fromUTF8(decodedString)
          position = ProtocolPosition.load(decodedId)
        }
      }
      
      if (position != null) {
        if (position.isActive) {
          activeCount++
        } else {
          closedCount++
        }
      }
    }
  }
  
  portfolio.totalPositions = activeCount
  portfolio.totalClosedPositions = closedCount
  
  portfolio.save()
  
  // Create snapshot
  createPortfolioSnapshot(portfolio, block)
  
  log.info("PORTFOLIO: {} USD (ROI: {}%, positions: {}, uninvested: {})", [
    finalValue.toString(),
    roi.toString(),
    positionsValue.toString(),
    uninvestedValue.toString()
  ])
}

// Calculate total value of all active positions
function calculatePositionsValue(serviceSafe: Address): BigDecimal {
  let totalValue = BigDecimal.zero()
  
  // Get the service entity
  let service = Service.load(serviceSafe)
  if (service == null || service.positionIds == null) {
    return totalValue
  }
  
  // Iterate through all position IDs
  let positionIds = service.positionIds
  
  for (let i = 0; i < positionIds.length; i++) {
    let positionIdString = positionIds[i]
    let position: ProtocolPosition | null = null
    
    // Try loading position with different ID formats for robustness
    
    // Method 1: Try as direct UTF8 string (standard format)
    let directId = Bytes.fromUTF8(positionIdString)
    position = ProtocolPosition.load(directId)
    
    if (position == null) {
      // Method 2: Try as hex-decoded string (for any legacy hex-encoded IDs)
      // Check if the string looks like hex (starts with 0x and has even length)
      if (positionIdString.startsWith("0x") && positionIdString.length % 2 == 0) {
        // Convert hex string back to original string, then to Bytes
        let hexBytes = Bytes.fromHexString(positionIdString)
        let decodedString = hexBytes.toString()
        let decodedId = Bytes.fromUTF8(decodedString)
        position = ProtocolPosition.load(decodedId)
      }
    }
    
    // If position found and active, add to total value
    if (position != null && position.isActive) {
      totalValue = totalValue.plus(position.usdCurrent)
    }
  }
  
  return totalValue
}


// Create a portfolio snapshot
function createPortfolioSnapshot(portfolio: AgentPortfolio, block: ethereum.Block): void {
  let snapshotId = portfolio.id.toHexString() + "-" + block.timestamp.toString()
  let snapshot = new AgentPortfolioSnapshot(Bytes.fromUTF8(snapshotId))
  
  snapshot.service = portfolio.service
  snapshot.portfolio = portfolio.id
  
  // Copy values
  snapshot.finalValue = portfolio.finalValue
  snapshot.initialValue = portfolio.initialValue
  snapshot.positionsValue = portfolio.positionsValue
  snapshot.uninvestedValue = portfolio.uninvestedValue
  
  // Copy performance metrics
  snapshot.roi = portfolio.roi
  snapshot.apr = portfolio.apr
  
  // Metadata
  snapshot.timestamp = block.timestamp
  snapshot.block = block.number
  snapshot.totalPositions = portfolio.totalPositions
  snapshot.totalClosedPositions = portfolio.totalClosedPositions
  
  // Note: Position IDs can be retrieved through the Service entity's positionIds field
  // We don't duplicate them in the snapshot to avoid compilation issues
  
  snapshot.save()
}

// Ensure AgentPortfolio exists, create if it doesn't
export function ensureAgentPortfolio(serviceSafe: Address, timestamp: BigInt): AgentPortfolio {
  let portfolioId = serviceSafe as Bytes
  let portfolio = AgentPortfolio.load(portfolioId)
  
  if (portfolio == null) {
    portfolio = new AgentPortfolio(portfolioId)
    portfolio.service = serviceSafe
    portfolio.firstTradingTimestamp = BigInt.zero() // Will be set by updateFirstTradingTimestamp
    portfolio.lastSnapshotTimestamp = BigInt.zero()
    portfolio.lastSnapshotBlock = BigInt.zero()
    portfolio.totalPositions = 0
    portfolio.totalClosedPositions = 0
    // Initialize with default values
    portfolio.finalValue = BigDecimal.zero()
    portfolio.initialValue = BigDecimal.zero()
    portfolio.positionsValue = BigDecimal.zero()
    portfolio.uninvestedValue = BigDecimal.zero()
    portfolio.roi = BigDecimal.zero()
    portfolio.apr = BigDecimal.zero()
    portfolio.lastUpdated = timestamp
    portfolio.save()
  }
  
  return portfolio
}

// Update first trading timestamp when a position is created
export function updateFirstTradingTimestamp(serviceSafe: Address, timestamp: BigInt): void {
  let portfolio = ensureAgentPortfolio(serviceSafe, timestamp)
  
  if (portfolio.firstTradingTimestamp.equals(BigInt.zero())) {
    portfolio.firstTradingTimestamp = timestamp
    portfolio.save()
  }
}
