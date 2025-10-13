import { BigDecimal, BigInt, Address, Bytes, log, ethereum } from "@graphprotocol/graph-ts"
import { 
  FundingBalance, 
  AgentPortfolio, 
  AgentPortfolioSnapshot,
  ProtocolPosition,
  Service,
  AgentSwapBuffer,
  SwapTransaction
} from "../../../../generated/schema"
import { calculateUninvestedValue, updateFundingBalance } from "./tokenBalances"
import { getServiceByAgent } from "./config"
import { calculateActualROI, aggregateClosedPositionMetrics } from "./roiCalculation"
import { getEthUsd } from "./common"

// ETH-adjusted metrics calculation class
class EthAdjustedMetrics {
  ethAdjustedActualROI: BigDecimal
  ethAdjustedUnrealisedPnL: BigDecimal
  ethAdjustedActualAPR: BigDecimal
  ethAdjustedProjectedUnrealisedPnL: BigDecimal
  currentEthPrice: BigDecimal
  firstFundingEthPrice: BigDecimal
  ethDelta: BigDecimal
  
  constructor(
    ethAdjustedActualROI: BigDecimal,
    ethAdjustedUnrealisedPnL: BigDecimal,
    ethAdjustedActualAPR: BigDecimal,
    ethAdjustedProjectedUnrealisedPnL: BigDecimal,
    currentEthPrice: BigDecimal,
    firstFundingEthPrice: BigDecimal,
    ethDelta: BigDecimal
  ) {
    this.ethAdjustedActualROI = ethAdjustedActualROI
    this.ethAdjustedUnrealisedPnL = ethAdjustedUnrealisedPnL
    this.ethAdjustedActualAPR = ethAdjustedActualAPR
    this.ethAdjustedProjectedUnrealisedPnL = ethAdjustedProjectedUnrealisedPnL
    this.currentEthPrice = currentEthPrice
    this.firstFundingEthPrice = firstFundingEthPrice
    this.ethDelta = ethDelta
  }
}

// Helper function to create block from timestamp for ETH price lookup
function createBlockFromTimestamp(timestamp: BigInt): ethereum.Block {
  return new ethereum.Block(
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
    timestamp,
    BigInt.zero(),
    BigInt.zero(),
    BigInt.zero(),
    BigInt.zero()
  )
}

// Calculate ETH-adjusted metrics using the core formula
function calculateEthAdjustedMetrics(
  portfolio: AgentPortfolio,
  actualROI: BigDecimal,
  unrealisedPnL: BigDecimal,
  actualAPR: BigDecimal,
  projectedUnrealisedPnL: BigDecimal,
  block: ethereum.Block
): EthAdjustedMetrics {
  // Get current ETH price
  let currentEthPrice = getEthUsd(block)
  
  // Get first funding ETH price (should be set when first funding occurs)
  let firstFundingEthPrice = portfolio.firstFundingEthPrice
  
  // Calculate ETH delta: ((ETH_f/ETH_i)-1)*100
  let ethDelta = BigDecimal.zero()
  if (firstFundingEthPrice.gt(BigDecimal.zero())) {
    ethDelta = currentEthPrice.div(firstFundingEthPrice)
      .minus(BigDecimal.fromString("1"))
      .times(BigDecimal.fromString("100"))
  }
  
  // Calculate ETH-adjusted ROI: ROI - ETHdelta
  let ethAdjustedActualROI = actualROI.minus(ethDelta)
  let ethAdjustedUnrealisedPnL = unrealisedPnL.minus(ethDelta)
  
  // CORRECTED: Calculate ETH-adjusted APR from ETH-adjusted ROI (not directly from ETH delta)
  // Get the time period for APR calculation
  let timestampForAPR = portfolio.firstTradingTimestamp
  let ethAdjustedActualAPR = BigDecimal.zero()
  let ethAdjustedProjectedUnrealisedPnL = BigDecimal.zero()
  
  if (timestampForAPR.gt(BigInt.zero())) {
    let secondsSinceStart = block.timestamp.minus(timestampForAPR)
    let daysSinceStart = secondsSinceStart.toBigDecimal().div(BigDecimal.fromString("86400"))
    
    if (daysSinceStart.gt(BigDecimal.zero())) {
      // APR = ETH-adjusted ROI * (365 / days_invested)
      let annualizationFactor = BigDecimal.fromString("365").div(daysSinceStart)
      ethAdjustedActualAPR = ethAdjustedActualROI.times(annualizationFactor)
      ethAdjustedProjectedUnrealisedPnL = ethAdjustedUnrealisedPnL.times(annualizationFactor)
    }
  }
  
  return new EthAdjustedMetrics(
    ethAdjustedActualROI,
    ethAdjustedUnrealisedPnL,
    ethAdjustedActualAPR,
    ethAdjustedProjectedUnrealisedPnL,
    currentEthPrice,
    firstFundingEthPrice,
    ethDelta
  )
}

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
  
  // 1. Get initial investment from FundingBalance (use totalInUsd to preserve baseline)
  let fundingBalance = FundingBalance.load(serviceSafe as Bytes)
  let initialValue = fundingBalance ? fundingBalance.totalInUsd : BigDecimal.zero()
  
  // 2. Calculate total positions value
  let positionsValue = calculatePositionsValue(serviceSafe)
  
  // 3. Calculate uninvested funds
  let uninvestedValue = calculateUninvestedValue(serviceSafe)
  
  // 4. Get total withdrawn amount
  let totalWithdrawn = fundingBalance ? fundingBalance.totalWithdrawnUsd : BigDecimal.zero()
  
  // 5. Calculate total portfolio value (positions + uninvested + withdrawn)
  let finalValue = positionsValue.plus(uninvestedValue).plus(totalWithdrawn)
  
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
  
  // Calculate new position-based ROI from closed positions
  let actualROI = calculateActualROI(serviceSafe)
  let aggregates = aggregateClosedPositionMetrics(serviceSafe)
  
  // Calculate APR from actual ROI (position-based)
  let actualAPR = BigDecimal.zero()
  if (actualROI.gt(BigDecimal.zero())) {
    let timestampForAPR = portfolio.firstTradingTimestamp
    
    // Fallback: If no trading activity, use service creation timestamp
    if (timestampForAPR.equals(BigInt.zero())) {
      let serviceEntity = Service.load(serviceSafe)
      if (serviceEntity != null && serviceEntity.latestRegistrationTimestamp.gt(BigInt.zero())) {
        timestampForAPR = serviceEntity.latestRegistrationTimestamp
      }
    }
    
    if (timestampForAPR.gt(BigInt.zero())) {
      let secondsSinceStart = block.timestamp.minus(timestampForAPR)
      let daysSinceStart = secondsSinceStart.toBigDecimal().div(BigDecimal.fromString("86400"))
      
      if (daysSinceStart.gt(BigDecimal.zero())) {
        // APR = actual_roi * (365 / days_invested)
        let annualizationFactor = BigDecimal.fromString("365").div(daysSinceStart)
        actualAPR = actualROI.times(annualizationFactor)
      }
    }
  }
  
  //  Ensure firstTradingTimestamp fallback to registration if no funding
  if (portfolio.firstTradingTimestamp.equals(BigInt.zero())) {
    let serviceEntity = Service.load(serviceSafe)
    if (serviceEntity != null && serviceEntity.latestRegistrationTimestamp.gt(BigInt.zero())) {
      portfolio.firstTradingTimestamp = serviceEntity.latestRegistrationTimestamp
      
      // Capture ETH price at registration time as fallback
      let registrationBlock = createBlockFromTimestamp(serviceEntity.latestRegistrationTimestamp)
      portfolio.firstFundingEthPrice = getEthUsd(registrationBlock)
    }
  }
  
  //  Calculate ETH-adjusted metrics
  let ethAdjustedMetrics = calculateEthAdjustedMetrics(
    portfolio,
    actualROI,
    roi,  // unrealisedPnL (portfolio-based)
    actualAPR,
    apr,  // projectedUnrealisedPnL (portfolio-based)
    block
  )
  
  // Update portfolio with standard values
  portfolio.finalValue = finalValue
  portfolio.initialValue = initialValue  
  portfolio.positionsValue = positionsValue
  portfolio.uninvestedValue = uninvestedValue
  portfolio.totalWithdrawnUsd = totalWithdrawn  // Total amount withdrawn to EOAs
  portfolio.unrealisedPnL = roi  // Current portfolio-based calculation (unrealized PnL)
  portfolio.roi = actualROI  //Position-based ROI from closed positions
  portfolio.apr = actualAPR  // APR calculated from actual ROI
  portfolio.projectedUnrealisedPnL = apr  // APR calculated from unrealised PnL
  portfolio.lastUpdated = block.timestamp
  
  // Update portfolio with ETH-adjusted values
  portfolio.ethAdjustedRoi = ethAdjustedMetrics.ethAdjustedActualROI
  portfolio.ethAdjustedApr = ethAdjustedMetrics.ethAdjustedActualAPR
  portfolio.ethAdjustedUnrealisedPnL = ethAdjustedMetrics.ethAdjustedUnrealisedPnL
  portfolio.ethAdjustedProjectedUnrealisedPnL = ethAdjustedMetrics.ethAdjustedProjectedUnrealisedPnL
  portfolio.currentEthPrice = ethAdjustedMetrics.currentEthPrice
  
  // firstFundingEthPrice is set in updateFundingBalance or registration fallback
  if (portfolio.firstFundingEthPrice.equals(BigDecimal.zero())) {
    portfolio.firstFundingEthPrice = ethAdjustedMetrics.currentEthPrice
  }
  
  // Update aggregation fields
  portfolio.totalInvestments = aggregates.totalInvestments
  portfolio.totalGrossGains = aggregates.totalGrossGains
  portfolio.totalCosts = aggregates.totalCosts
  
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
  snapshot.totalWithdrawnUsd = portfolio.totalWithdrawnUsd
  
  // Copy performance metrics
  snapshot.roi = portfolio.roi  // Use position-based ROI for snapshots
  snapshot.apr = portfolio.apr
  snapshot.unrealisedPnL = portfolio.unrealisedPnL
  snapshot.projectedUnrealisedPnL = portfolio.projectedUnrealisedPnL
  
  //  Copy ETH-adjusted metrics
  snapshot.ethAdjustedRoi = portfolio.ethAdjustedRoi
  snapshot.ethAdjustedApr = portfolio.ethAdjustedApr
  snapshot.ethAdjustedUnrealisedPnL = portfolio.ethAdjustedUnrealisedPnL
  snapshot.ethAdjustedProjectedUnrealisedPnL = portfolio.ethAdjustedProjectedUnrealisedPnL
  
  // Metadata
  snapshot.timestamp = block.timestamp
  snapshot.block = block.number
  snapshot.totalPositions = portfolio.totalPositions
  snapshot.totalClosedPositions = portfolio.totalClosedPositions
  
  // Initialize positionIds as empty array to avoid null issues
  snapshot.positionIds = []
  
  snapshot.save()
  
  // Update portfolio snapshot tracking
  portfolio.lastSnapshotTimestamp = block.timestamp
  portfolio.lastSnapshotBlock = block.number
  portfolio.save()
  
  let totalPositions = portfolio.totalPositions + portfolio.totalClosedPositions
  log.info("SNAPSHOT: Created snapshot for agent {} with {} total positions", [
    portfolio.service.toHexString(),
    totalPositions.toString()
  ])
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
    portfolio.totalWithdrawnUsd = BigDecimal.zero()  // Initialize withdrawn amount
    portfolio.unrealisedPnL = BigDecimal.zero()
    portfolio.roi = BigDecimal.zero()  // Position-based ROI
    portfolio.totalInvestments = BigDecimal.zero()
    portfolio.totalGrossGains = BigDecimal.zero()
    portfolio.totalCosts = BigDecimal.zero()
    portfolio.apr = BigDecimal.zero()
    portfolio.projectedUnrealisedPnL = BigDecimal.zero()  //  Initialize projected unrealised PnL
    
    // Initialize ETH-adjusted performance metrics
    portfolio.ethAdjustedRoi = BigDecimal.zero()
    portfolio.ethAdjustedApr = BigDecimal.zero()
    portfolio.ethAdjustedUnrealisedPnL = BigDecimal.zero()
    portfolio.ethAdjustedProjectedUnrealisedPnL = BigDecimal.zero()
    
    // Initialize ETH price tracking
    portfolio.firstFundingEthPrice = BigDecimal.zero()
    portfolio.currentEthPrice = BigDecimal.zero()
    
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

// Helper function to parse total slippage from bucket string (Mode format)
export function parseTotalSlippageFromBucket(bucketSwaps: string): BigDecimal {
  if (bucketSwaps == "[]" || bucketSwaps == "") {
    return BigDecimal.zero()
  }
  
  let totalSlippage = BigDecimal.zero()
  
  // Mode format parsing: split by pipe, then by comma
  let swapEntries = bucketSwaps.split("|")
  for (let i = 0; i < swapEntries.length; i++) {
    let entry = swapEntries[i]
    if (entry == "") continue
    
    let parts = entry.split(",")
    if (parts.length >= 3) {
      // parts[2] is the slippage value in format: timestamp,swapId,slippage,expiresAt
      let slippage = BigDecimal.fromString(parts[2])
      totalSlippage = totalSlippage.plus(slippage)
    }
  }
  
  return totalSlippage
}

export function associateSwapsWithPosition(
  userAddress: Address, 
  block: ethereum.Block
): BigDecimal {
  const bufferId = userAddress
  let buffer = AgentSwapBuffer.load(bufferId)
  if (buffer == null) {
    return BigDecimal.zero()
  }
  
  let totalSlippageUSD = BigDecimal.zero()
  let currentTime = block.timestamp
  let associationWindow = BigInt.fromI32(1200)
  
  let bucketsToCheck = [buffer.bucket0Swaps, buffer.bucket1Swaps, buffer.bucket2Swaps, buffer.bucket3Swaps]
  let updatedBuckets: string[] = ["", "", "", ""]
  
  for (let bucketIdx = 0; bucketIdx < bucketsToCheck.length; bucketIdx++) {
    let bucketData = bucketsToCheck[bucketIdx]
    if (bucketData == "") {
      updatedBuckets[bucketIdx] = ""
      continue
    }
    
    let remainingSwaps: string[] = []
    let associatedSwaps: string[] = []
    let swapEntries = bucketData.split("|")
    
    for (let i = 0; i < swapEntries.length; i++) {
      let entry = swapEntries[i]
      if (entry == "") continue
      
      let parts = entry.split(",")
      if (parts.length >= 4) {
        let swapTimestamp = BigInt.fromString(parts[0])
        let expiresAtStr = parts[3]
        let expiresAt = BigInt.fromString(expiresAtStr)
        
        if (currentTime.minus(swapTimestamp).le(associationWindow) && currentTime.le(expiresAt)) {
          associatedSwaps.push(entry)
        } else {
          remainingSwaps.push(entry)
        }
      }
    }
    
    if (associatedSwaps.length > 0) {
      let associatedBucketData = associatedSwaps.join("|")
      let bucketSlippage = parseTotalSlippageFromBucket(associatedBucketData)
      totalSlippageUSD = totalSlippageUSD.plus(bucketSlippage)
      
      for (let j = 0; j < associatedSwaps.length; j++) {
        let swapEntry = associatedSwaps[j]
        let swapParts = swapEntry.split(",")
        if (swapParts.length >= 5) {
          let swapId = swapParts[4]
          let swapTransaction = SwapTransaction.load(Bytes.fromHexString(swapId))
          if (swapTransaction != null) {
            swapTransaction.isAssociated = true
            swapTransaction.save()
            log.info("SWAP ASSOCIATION: Marked swap {} as associated for agent {}", [
              swapId,
              userAddress.toHexString()
            ])
          }
        }
      }
    }
    
    updatedBuckets[bucketIdx] = remainingSwaps.join("|")
  }
  
  buffer.bucket0Swaps = updatedBuckets[0]
  buffer.bucket1Swaps = updatedBuckets[1]
  buffer.bucket2Swaps = updatedBuckets[2]
  buffer.bucket3Swaps = updatedBuckets[3]
  buffer.save()
  
  if (totalSlippageUSD.lt(BigDecimal.zero())) {
    totalSlippageUSD = BigDecimal.zero()
  }
  
  return totalSlippageUSD
}
