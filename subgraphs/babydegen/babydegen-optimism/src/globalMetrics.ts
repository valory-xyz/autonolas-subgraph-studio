import { BigDecimal, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
import { DailyPopulationMetric, AgentPortfolioSnapshot, ServiceRegistry, AgentPortfolio, FundingBalance, Service } from "../generated/schema";

/**
 * Determines if an agent snapshot should be excluded from projected ROI calculations
 * @param snapshot The agent portfolio snapshot to evaluate
 * @returns true if the snapshot should be excluded from projected ROI calculations
 */
function shouldExcludeFromProjectedROI(snapshot: AgentPortfolioSnapshot): boolean {
  const lowInitialValue = snapshot.initialValue.lt(BigDecimal.fromString("1.0"));
  const zeroFinalValue = snapshot.finalValue.equals(BigDecimal.zero());
  
  return lowInitialValue && zeroFinalValue;
}

/**
 * Gets the timestamp for the start of the day (UTC midnight) for a given timestamp
 * @param timestamp The timestamp to get the day timestamp for
 * @returns The timestamp for the start of the day (UTC midnight)
 */
function getDayTimestamp(timestamp: BigInt): BigInt {
  const ONE_DAY = BigInt.fromI32(86400); // 86400 seconds in a day
  return timestamp.div(ONE_DAY).times(ONE_DAY);
}

/**
 * Calculate median value from an array of BigDecimal values
 * @param values Array of BigDecimal values to calculate median from
 * @returns Median value as BigDecimal
 */
export function calculateMedian(values: BigDecimal[]): BigDecimal {
  if (values.length == 0) {
    return BigDecimal.zero();
  }
  
  if (values.length == 1) {
    return values[0];
  }
  
  // Sort values in ascending order
  let sortedValues = values.sort((a, b) => {
    if (a.lt(b)) return -1;
    if (a.gt(b)) return 1;
    return 0;
  });
  
  let length = sortedValues.length;
  let isEven = length % 2 == 0;
  
  if (isEven) {
    // For even number of values, return average of two middle values
    let midIndex1 = length / 2 - 1;
    let midIndex2 = length / 2;
    let sum = sortedValues[midIndex1].plus(sortedValues[midIndex2]);
    return sum.div(BigDecimal.fromString("2"));
  } else {
    // For odd number of values, return middle value
    let midIndex = (length - 1) / 2;
    return sortedValues[midIndex];
  }
}

/**
 * Calculate 7-day simple moving average from historical values
 * @param historicalValues Array of historical daily values (up to 7 days)
 * @returns 7-day SMA as BigDecimal
 */
export function calculate7DaysSMA(historicalValues: BigDecimal[]): BigDecimal {
  if (historicalValues.length == 0) {
    return BigDecimal.zero();
  }
  
  // Add validation for 7-day limit
  if (historicalValues.length > 7) {
    log.error("Historical values array exceeds 7 days: {} days provided", [
      historicalValues.length.toString()
    ]);
    return BigDecimal.zero();
  }
  
  let sum = BigDecimal.zero();
  for (let i = 0; i < historicalValues.length; i++) {
    sum = sum.plus(historicalValues[i]);
  }
  
  let divisor = BigDecimal.fromString(historicalValues.length.toString());
  return sum.div(divisor);
}

/**
 * Get all agent portfolio snapshots for a specific day
 * @param block Current ethereum block
 * @returns Array of AgentPortfolioSnapshot entities for the day
 */
export function getAllAgentSnapshotsForDay(block: ethereum.Block): AgentPortfolioSnapshot[] {
  let snapshots: AgentPortfolioSnapshot[] = []
  let dayTimestamp = getDayTimestamp(block.timestamp)
  
  // Load all services from the registry
  let registryId = Bytes.fromUTF8("registry")
  let serviceRegistry = ServiceRegistry.load(registryId)
  if (!serviceRegistry) {
    log.warning("ServiceRegistry not found when calculating global metrics", [])
    return snapshots
  }
  
  // Track exclusions for logging
  let agentsExcludedForInsufficientPositions = 0
  let totalAgentsProcessed = 0
  
  // For each service, look for snapshots created on this day
  for (let i = 0; i < serviceRegistry.serviceAddresses.length; i++) {
    let serviceAddress = serviceRegistry.serviceAddresses[i]
    
    // Query all snapshots for this service and filter by day
    // Since we don't know the exact block timestamp, we need to find snapshots within the day
    let portfolio = AgentPortfolio.load(serviceAddress)
    if (portfolio && portfolio.lastSnapshotTimestamp.gt(BigInt.zero())) {
      let snapshotDayTimestamp = getDayTimestamp(portfolio.lastSnapshotTimestamp)
      
      // If the last snapshot was taken on this day, check position requirements
      if (snapshotDayTimestamp.equals(dayTimestamp)) {
        totalAgentsProcessed++
        
        // Check if agent has at least 2 total positions (active + closed)
        let totalPositions = portfolio.totalPositions + portfolio.totalClosedPositions
        if (totalPositions < 2) {
          agentsExcludedForInsufficientPositions++
          log.info("Excluding agent {} from population metrics - insufficient position history: {} total positions (active: {}, closed: {})", [
            serviceAddress.toHexString(),
            totalPositions.toString(),
            portfolio.totalPositions.toString(),
            portfolio.totalClosedPositions.toString()
          ])
          continue // Skip this agent
        }
        
        // Load and include snapshot
        let snapshotId = serviceAddress.toHexString() + "-" + portfolio.lastSnapshotTimestamp.toString()
        let snapshot = AgentPortfolioSnapshot.load(Bytes.fromUTF8(snapshotId))
        
        if (snapshot) {
          snapshots.push(snapshot)
        }
      }
    }
  }
  
  log.info("Found {} agent snapshots for day timestamp {} (excluded {} for insufficient positions, {} total processed)", [
    snapshots.length.toString(),
    dayTimestamp.toString(),
    agentsExcludedForInsufficientPositions.toString(),
    totalAgentsProcessed.toString()
  ])
  
  return snapshots
}

/**
 * Get previous DailyPopulationMetric entity to access historical data
 * @param currentDayTimestamp Current day timestamp (UTC midnight)
 * @returns Previous DailyPopulationMetric entity or null if not found
 */
export function getPreviousDailyPopulationMetric(currentDayTimestamp: BigInt): DailyPopulationMetric | null {
  // Calculate previous day timestamp (24 hours ago)
  let previousTimestamp = currentDayTimestamp.minus(BigInt.fromI32(86400)); // 86400 seconds = 24 hours
  let previousGlobalId = previousTimestamp.toString();
  
  return DailyPopulationMetric.load(Bytes.fromUTF8(previousGlobalId));
}

/**
 * Update historical arrays with new median values, maintaining 7-day window
 * @param historicalROI Current historical ROI array
 * @param historicalAPR Current historical APR array
 * @param newMedianROI New median ROI to add
 * @param newMedianAPR New median APR to add
 * @returns Updated historical arrays as tuple [ROI, APR]
 */
export function updateHistoricalArrays(
  historicalROI: BigDecimal[],
  historicalAPR: BigDecimal[],
  newMedianROI: BigDecimal,
  newMedianAPR: BigDecimal
): BigDecimal[][] {
  // Add new values to the end
  historicalROI.push(newMedianROI);
  historicalAPR.push(newMedianAPR);
  
  // Keep only last 7 days (remove oldest if we have more than 7)
  if (historicalROI.length > 7) {
    historicalROI.shift(); // Remove first element
  }
  if (historicalAPR.length > 7) {
    historicalAPR.shift(); // Remove first element
  }
  
  return [historicalROI, historicalAPR];
}

/**
 * Update projected unrealised PnL historical array with new median value, maintaining 7-day window
 * @param historicalProjectedAPR Current historical projected unrealised PnL array
 * @param newMedianProjectedAPR New median projected unrealised PnL to add
 * @returns Updated historical projected unrealised PnL array
 */
export function updateProjectedAPRHistoricalArray(
  historicalProjectedAPR: BigDecimal[],
  newMedianProjectedAPR: BigDecimal
): BigDecimal[] {
  // Add new value to the end
  historicalProjectedAPR.push(newMedianProjectedAPR);
  
  // Keep only last 7 days (remove oldest if we have more than 7)
  if (historicalProjectedAPR.length > 7) {
    historicalProjectedAPR.shift(); // Remove first element
  }
  
  return historicalProjectedAPR;
}

/**
 * Update ETH-adjusted historical arrays with new median values, maintaining 7-day window
 * @param historicalEthAdjustedROI Current historical ETH-adjusted ROI array
 * @param historicalEthAdjustedAPR Current historical ETH-adjusted APR array
 * @param historicalEthAdjustedProjectedROI Current historical ETH-adjusted projected ROI array
 * @param historicalEthAdjustedProjectedAPR Current historical ETH-adjusted projected APR array
 * @param newMedianEthAdjustedROI New median ETH-adjusted ROI to add
 * @param newMedianEthAdjustedAPR New median ETH-adjusted APR to add
 * @param newMedianEthAdjustedProjectedROI New median ETH-adjusted projected ROI to add
 * @param newMedianEthAdjustedProjectedAPR New median ETH-adjusted projected APR to add
 * @returns Updated historical arrays as tuple [ROI, APR, ProjectedROI, ProjectedAPR]
 */
export function updateHistoricalArraysEthAdjusted(
  historicalEthAdjustedROI: BigDecimal[],
  historicalEthAdjustedAPR: BigDecimal[],
  historicalEthAdjustedProjectedROI: BigDecimal[],
  historicalEthAdjustedProjectedAPR: BigDecimal[],
  newMedianEthAdjustedROI: BigDecimal,
  newMedianEthAdjustedAPR: BigDecimal,
  newMedianEthAdjustedProjectedROI: BigDecimal,
  newMedianEthAdjustedProjectedAPR: BigDecimal
): BigDecimal[][] {
  // Add new values to the end
  historicalEthAdjustedROI.push(newMedianEthAdjustedROI);
  historicalEthAdjustedAPR.push(newMedianEthAdjustedAPR);
  historicalEthAdjustedProjectedROI.push(newMedianEthAdjustedProjectedROI);
  historicalEthAdjustedProjectedAPR.push(newMedianEthAdjustedProjectedAPR);
  
  // Keep only last 7 days
  if (historicalEthAdjustedROI.length > 7) {
    historicalEthAdjustedROI.shift();
  }
  if (historicalEthAdjustedAPR.length > 7) {
    historicalEthAdjustedAPR.shift();
  }
  if (historicalEthAdjustedProjectedROI.length > 7) {
    historicalEthAdjustedProjectedROI.shift();
  }
  if (historicalEthAdjustedProjectedAPR.length > 7) {
    historicalEthAdjustedProjectedAPR.shift();
  }
  
  return [
    historicalEthAdjustedROI,
    historicalEthAdjustedAPR,
    historicalEthAdjustedProjectedROI,
    historicalEthAdjustedProjectedAPR
  ];
}

/**
 * Create or update DailyPopulationMetric entity with calculated metrics
 * @param medianROI Calculated median ROI
 * @param medianAPR Calculated median APR
 * @param medianProjectedAPR Calculated median projected APR
 * @param sma7dROI Calculated 7-day SMA ROI
 * @param sma7dAPR Calculated 7-day SMA APR
 * @param sma7dProjectedAPR Calculated 7-day SMA projected APR
 * @param historicalROI Updated historical ROI array
 * @param historicalAPR Updated historical APR array
 * @param historicalProjectedAPR Updated historical projected APR array
 * @param totalAgents Number of agents included in calculation
 * @param block Current block
 */
export function updateDailyPopulationMetricEntity(
  medianROI: BigDecimal,
  medianAPR: BigDecimal,
  medianProjectedUnrealisedPnL: BigDecimal,
  sma7dROI: BigDecimal,
  sma7dAPR: BigDecimal,
  sma7dProjectedAPR: BigDecimal,
  historicalROI: BigDecimal[],
  historicalAPR: BigDecimal[],
  historicalProjectedAPR: BigDecimal[],
  totalAgents: number,
  block: ethereum.Block
): void {
  // Use day timestamp (UTC midnight) for entity ID to ensure one entity per day
  let dayTimestamp = getDayTimestamp(block.timestamp);
  let globalId = dayTimestamp.toString();
  
  // Check if entity already exists for this day to prevent duplicates
  let existingEntity = DailyPopulationMetric.load(Bytes.fromUTF8(globalId));
  if (existingEntity != null) {
    log.info("DailyPopulationMetric already exists for day {}, skipping creation", [dayTimestamp.toString()]);
    return;
  }
  
  let dailyPopulationMetric = new DailyPopulationMetric(Bytes.fromUTF8(globalId));
  
  // Set population metrics
  dailyPopulationMetric.medianPopulationROI = medianROI;
  dailyPopulationMetric.medianPopulationAPR = medianAPR;
  dailyPopulationMetric.medianUnrealisedPnL = medianProjectedUnrealisedPnL;
  dailyPopulationMetric.medianProjectedUnrealisedPnL = medianProjectedUnrealisedPnL;
  
  // Set 7-day simple moving averages
  dailyPopulationMetric.sma7dROI = sma7dROI;
  dailyPopulationMetric.sma7dAPR = sma7dAPR;
  dailyPopulationMetric.sma7dUnrealisedPnL = sma7dProjectedAPR;
  dailyPopulationMetric.sma7dProjectedUnrealisedPnL = sma7dProjectedAPR;
  
  // Set metadata
  dailyPopulationMetric.timestamp = dayTimestamp; // Use day timestamp for consistency
  dailyPopulationMetric.block = block.number;
  dailyPopulationMetric.totalAgents = totalAgents as i32;
  
  // Set historical data
  dailyPopulationMetric.historicalMedianROI = historicalROI;
  dailyPopulationMetric.historicalMedianAPR = historicalAPR;
  dailyPopulationMetric.historicalMedianUnrealisedPnL = historicalProjectedAPR;
  dailyPopulationMetric.historicalMedianProjectedUnrealisedPnL = historicalProjectedAPR;
  
  dailyPopulationMetric.save();
  
  log.info("Created DailyPopulationMetric entity for day timestamp {} with {} agents, median ROI: {}, median APR: {}, median projected unrealised PnL: {}", [
    dayTimestamp.toString(),
    totalAgents.toString(),
    medianROI.toString(),
    medianAPR.toString(),
    medianProjectedUnrealisedPnL.toString()
  ]);
}

/**
 * Create or update DailyPopulationMetric entity with calculated metrics including ETH-adjusted values
 */
export function updateDailyPopulationMetricEntityWithEthAdjusted(
  medianROI: BigDecimal,
  medianAPR: BigDecimal,
  medianUnrealisedPnL: BigDecimal,
  medianProjectedUnrealisedPnL: BigDecimal,
  sma7dROI: BigDecimal,
  sma7dAPR: BigDecimal,
  sma7dUnrealisedPnL: BigDecimal,
  sma7dProjectedUnrealisedPnL: BigDecimal,
  historicalROI: BigDecimal[],
  historicalAPR: BigDecimal[],
  historicalUnrealisedPnL: BigDecimal[],
  historicalProjectedUnrealisedPnL: BigDecimal[],
  medianEthAdjustedROI: BigDecimal,
  medianEthAdjustedAPR: BigDecimal,
  medianEthAdjustedUnrealisedPnL: BigDecimal,
  medianEthAdjustedProjectedUnrealisedPnL: BigDecimal,
  sma7dEthAdjustedROI: BigDecimal,
  sma7dEthAdjustedAPR: BigDecimal,
  sma7dEthAdjustedUnrealisedPnL: BigDecimal,
  sma7dEthAdjustedProjectedUnrealisedPnL: BigDecimal,
  historicalEthAdjustedROI: BigDecimal[],
  historicalEthAdjustedAPR: BigDecimal[],
  historicalEthAdjustedUnrealisedPnL: BigDecimal[],
  historicalEthAdjustedProjectedUnrealisedPnL: BigDecimal[],
  medianAUM: BigDecimal,
  sma7dAUM: BigDecimal,
  historicalAUM: BigDecimal[],
  totalAgents: number,
  block: ethereum.Block
): void {
  // Use day timestamp (UTC midnight) for entity ID to ensure one entity per day
  let dayTimestamp = getDayTimestamp(block.timestamp);
  let globalId = dayTimestamp.toString();
  
  // Check if entity already exists for this day to prevent duplicates
  let existingEntity = DailyPopulationMetric.load(Bytes.fromUTF8(globalId));
  if (existingEntity != null) {
    log.info("DailyPopulationMetric already exists for day {}, skipping creation", [dayTimestamp.toString()]);
    return;
  }
  
  let dailyPopulationMetric = new DailyPopulationMetric(Bytes.fromUTF8(globalId));
  
  // Set population metrics
  dailyPopulationMetric.medianPopulationROI = medianROI;
  dailyPopulationMetric.medianPopulationAPR = medianAPR;
  dailyPopulationMetric.medianUnrealisedPnL = medianUnrealisedPnL;
  dailyPopulationMetric.medianProjectedUnrealisedPnL = medianProjectedUnrealisedPnL;
  
  //  Set ETH-adjusted population metrics
  dailyPopulationMetric.medianEthAdjustedROI = medianEthAdjustedROI;
  dailyPopulationMetric.medianEthAdjustedAPR = medianEthAdjustedAPR;
  dailyPopulationMetric.medianEthAdjustedUnrealisedPnL = medianEthAdjustedUnrealisedPnL;
  dailyPopulationMetric.medianEthAdjustedProjectedUnrealisedPnL = medianEthAdjustedProjectedUnrealisedPnL;
  
  // Set 7-day simple moving averages
  dailyPopulationMetric.sma7dROI = sma7dROI;
  dailyPopulationMetric.sma7dAPR = sma7dAPR;
  dailyPopulationMetric.sma7dUnrealisedPnL = sma7dUnrealisedPnL;
  dailyPopulationMetric.sma7dProjectedUnrealisedPnL = sma7dProjectedUnrealisedPnL;
  
  //  Set ETH-adjusted 7-day SMAs
  dailyPopulationMetric.sma7dEthAdjustedROI = sma7dEthAdjustedROI;
  dailyPopulationMetric.sma7dEthAdjustedAPR = sma7dEthAdjustedAPR;
  dailyPopulationMetric.sma7dEthAdjustedUnrealisedPnL = sma7dEthAdjustedUnrealisedPnL;
  dailyPopulationMetric.sma7dEthAdjustedProjectedUnrealisedPnL = sma7dEthAdjustedProjectedUnrealisedPnL;
  
  // Set metadata
  dailyPopulationMetric.timestamp = dayTimestamp; // Use day timestamp for consistency
  dailyPopulationMetric.block = block.number;
  dailyPopulationMetric.totalAgents = totalAgents as i32;
  
  // Set historical data
  dailyPopulationMetric.historicalMedianROI = historicalROI;
  dailyPopulationMetric.historicalMedianAPR = historicalAPR;
  dailyPopulationMetric.historicalMedianUnrealisedPnL = historicalUnrealisedPnL;
  dailyPopulationMetric.historicalMedianProjectedUnrealisedPnL = historicalProjectedUnrealisedPnL;
  
  //  Set ETH-adjusted historical data
  dailyPopulationMetric.historicalMedianEthAdjustedROI = historicalEthAdjustedROI;
  dailyPopulationMetric.historicalMedianEthAdjustedAPR = historicalEthAdjustedAPR;
  dailyPopulationMetric.historicalMedianEthAdjustedUnrealisedPnL = historicalEthAdjustedUnrealisedPnL;
  dailyPopulationMetric.historicalMedianEthAdjustedProjectedUnrealisedPnL = historicalEthAdjustedProjectedUnrealisedPnL;
  
  // Load all services from the registry to get service addresses for staking calculations
  let registryId = Bytes.fromUTF8("registry");
  let serviceRegistry = ServiceRegistry.load(registryId);
  let serviceAddresses: Bytes[] = [];
  if (serviceRegistry) {
    serviceAddresses = serviceRegistry.serviceAddresses;
  }
  
  //Set AUM fields
  dailyPopulationMetric.medianAUM = medianAUM;
  dailyPopulationMetric.sma7dAUM = sma7dAUM;
  
  //  Set staking APR calculation support fields
  dailyPopulationMetric.totalFundedAUM = calculateTotalFundedAUM(serviceAddresses);
  dailyPopulationMetric.averageAgentDaysActive = calculateAverageAgentDaysActive(block);
  
  //Set AUM historical data
  dailyPopulationMetric.historicalMedianAUM = historicalAUM;
  
  dailyPopulationMetric.save();
  
  log.info("Created DailyPopulationMetric entity for day timestamp {} with {} agents, median ROI: {}, median APR: {}, median projected unrealised PnL: {}, ETH-adjusted ROI: {}, ETH-adjusted APR: {}", [
    dayTimestamp.toString(),
    totalAgents.toString(),
    medianROI.toString(),
    medianAPR.toString(),
    medianProjectedUnrealisedPnL.toString(),
    medianEthAdjustedROI.toString(),
    medianEthAdjustedAPR.toString()
  ]);
}

/**
 * Calculate median AUM across agents included in portfolio snapshots
 * @param snapshots Array of agent portfolio snapshots (already filtered for position requirements)
 * @returns Median AUM as BigDecimal
 */
export function calculateMedianAUM(snapshots: AgentPortfolioSnapshot[]): BigDecimal {
  let aumValues: BigDecimal[] = [];
  
  for (let i = 0; i < snapshots.length; i++) {
    let snapshot = snapshots[i];
    let serviceAddress = snapshot.service;
    let fundingBalance = FundingBalance.load(serviceAddress);
    
    if (fundingBalance) {
      aumValues.push(fundingBalance.netUsd);
    }
  }
  
  return calculateMedian(aumValues);
}

/**
 * Calculate total funded AUM across all active BabyDegen services
 * @param serviceAddresses Array of service addresses
 * @returns Total funded AUM as BigDecimal
 */
export function calculateTotalFundedAUM(serviceAddresses: Bytes[]): BigDecimal {
  let totalAUM = BigDecimal.zero();
  
  for (let i = 0; i < serviceAddresses.length; i++) {
    let serviceAddress = serviceAddresses[i];
    let fundingBalance = FundingBalance.load(serviceAddress);
    
    if (fundingBalance) {
      // Use netUsd (total funding balance) for AUM calculation
      totalAUM = totalAUM.plus(fundingBalance.netUsd);
    }
  }
  
  return totalAUM;
}
/**
 * Update AUM historical array with new median value, maintaining 7-day window
 * @param historicalAUM Current historical AUM array
 * @param newMedianAUM New median AUM to add
 * @returns Updated historical AUM array
 */
export function updateAUMHistoricalArray(
  historicalAUM: BigDecimal[],
  newMedianAUM: BigDecimal
): BigDecimal[] {
  // Add new value to the end
  historicalAUM.push(newMedianAUM);
  
  // Keep only last 7 days (remove oldest if we have more than 7)
  if (historicalAUM.length > 7) {
    historicalAUM.shift(); // Remove first element
  }
  
  return historicalAUM;
}

/**
 * Calculate average agent days active for annualization
 * @param block Current ethereum block
 * @returns Average days active as BigDecimal
 */
export function calculateAverageAgentDaysActive(block: ethereum.Block): BigDecimal {
  let totalDaysActive = BigDecimal.zero();
  let activeAgentCount = 0;
  
  // Load all services from the registry
  let registryId = Bytes.fromUTF8("registry");
  let serviceRegistry = ServiceRegistry.load(registryId);
  if (!serviceRegistry) {
    log.warning("ServiceRegistry not found when calculating average agent days active", []);
    return BigDecimal.zero();
  }
  
  // For each service, calculate days since first trading/funding
  for (let i = 0; i < serviceRegistry.serviceAddresses.length; i++) {
    let serviceAddress = serviceRegistry.serviceAddresses[i];
    
    // Load the portfolio for this service
    let portfolio = AgentPortfolio.load(serviceAddress);
    if (portfolio) {
      let startTimestamp = portfolio.firstTradingTimestamp;
      
      // Fallback to service registration timestamp if no trading activity
      if (startTimestamp.equals(BigInt.zero())) {
        let service = Service.load(serviceAddress);
        if (service && service.latestRegistrationTimestamp.gt(BigInt.zero())) {
          startTimestamp = service.latestRegistrationTimestamp;
          
          log.debug("Using service registration timestamp for agent {} - no trading activity yet", [
            serviceAddress.toHexString()
          ]);
        }
      }
      
      // Calculate days active if we have a valid start timestamp
      if (startTimestamp.gt(BigInt.zero())) {
        let secondsActive = block.timestamp.minus(startTimestamp);
        let daysActive = secondsActive.toBigDecimal().div(BigDecimal.fromString("86400")); // 86400 seconds per day
        
        // Only include agents with at least some activity (> 0 days)
        if (daysActive.gt(BigDecimal.zero())) {
          totalDaysActive = totalDaysActive.plus(daysActive);
          activeAgentCount++;
          
          log.debug("Agent {} has been active for {} days", [
            serviceAddress.toHexString(),
            daysActive.toString()
          ]);
        }
      }
    }
  }
  
  // Calculate average
  let averageDaysActive = BigDecimal.zero();
  if (activeAgentCount > 0) {
    averageDaysActive = totalDaysActive.div(BigDecimal.fromString(activeAgentCount.toString()));
  }
  
  log.info("Calculated average agent days active: {} days across {} active agents", [
    averageDaysActive.toString(),
    activeAgentCount.toString()
  ]);
  
  return averageDaysActive;
}

/**
 * Main function to calculate and store population metrics
 * @param block Current ethereum block
 */
export function calculateGlobalMetrics(block: ethereum.Block): void {
  log.info("Starting population metrics calculation for block {} at timestamp {}", [
    block.number.toString(),
    block.timestamp.toString()
  ]);
  
  // Use day timestamp (UTC midnight) for consistent daily entities
  let dayTimestamp = getDayTimestamp(block.timestamp);
  
  // Get all agent snapshots for this day
  let snapshots = getAllAgentSnapshotsForDay(block);
  
  if (snapshots.length == 0) {
    log.warning("No agent snapshots found for population metrics calculation at day timestamp {}", [
      dayTimestamp.toString()
    ]);
    return;
  }
  
  // Extract values from snapshots with selective filtering for unrealised PnL
  let roiValues: BigDecimal[] = [];
  let aprValues: BigDecimal[] = [];
  let unrealisedPnLValues: BigDecimal[] = [];
  let projectedUnrealisedPnLValues: BigDecimal[] = [];
  
  //  Extract ETH-adjusted values from snapshots with selective filtering
  let ethAdjustedRoiValues: BigDecimal[] = [];
  let ethAdjustedAprValues: BigDecimal[] = [];
  let ethAdjustedProjectedRoiValues: BigDecimal[] = [];
  let ethAdjustedProjectedAprValues: BigDecimal[] = [];
  
  // Track exclusions for logging
  let totalSnapshots = snapshots.length;
  let excludedFromProjectedROI = 0;
  
  for (let i = 0; i < snapshots.length; i++) {
    let snapshot = snapshots[i];
    
    // Always include in actual ROI/APR calculations (no filtering)
    roiValues.push(snapshot.roi);
    aprValues.push(snapshot.apr);
    ethAdjustedRoiValues.push(snapshot.ethAdjustedRoi);
    ethAdjustedAprValues.push(snapshot.ethAdjustedApr);
    
    // Apply filtering logic for projected ROI/APR calculations
    let shouldExclude = shouldExcludeFromProjectedROI(snapshot);
    
    if (shouldExclude) {
      excludedFromProjectedROI++;
      log.info("Excluding agent {} from projected ROI calculations - initial: {} USD, final: {} USD", [
        snapshot.service.toHexString(),
        snapshot.initialValue.toString(),
        snapshot.finalValue.toString()
      ]);
    } else {
      // Only include in unrealised PnL calculations if not excluded
      // Use the unrealised PnL fields
      let unrealisedPnL = snapshot.unrealisedPnL; // Use unrealised PnL
      unrealisedPnLValues.push(unrealisedPnL);
      projectedUnrealisedPnLValues.push(snapshot.projectedUnrealisedPnL);
      ethAdjustedProjectedRoiValues.push(snapshot.ethAdjustedUnrealisedPnL);
      ethAdjustedProjectedAprValues.push(snapshot.ethAdjustedProjectedUnrealisedPnL);
    }
  }
  
  // Log filtering summary
  let includedInProjectedROI = totalSnapshots - excludedFromProjectedROI;
  log.info("Median calculation summary - Total snapshots: {}, Excluded from projected ROI: {}, Included in projected ROI: {}", [
    totalSnapshots.toString(),
    excludedFromProjectedROI.toString(),
    includedInProjectedROI.toString()
  ]);
  
  // Calculate median values
  let medianROI = calculateMedian(roiValues);
  let medianAPR = calculateMedian(aprValues);
  let medianUnrealisedPnL = calculateMedian(unrealisedPnLValues);
  let medianProjectedUnrealisedPnL = calculateMedian(projectedUnrealisedPnLValues);
  
  // Calculate medians for ETH-adjusted metrics
  let medianEthAdjustedROI = calculateMedian(ethAdjustedRoiValues);
  let medianEthAdjustedAPR = calculateMedian(ethAdjustedAprValues);
  let medianEthAdjustedProjectedROI = calculateMedian(ethAdjustedProjectedRoiValues);
  let medianEthAdjustedProjectedAPR = calculateMedian(ethAdjustedProjectedAprValues);
  
  // Get previous DailyPopulationMetric entity for historical data using day timestamp
  let previousDailyPopulationMetric = getPreviousDailyPopulationMetric(dayTimestamp);
  let historicalROI: BigDecimal[] = [];
  let historicalAPR: BigDecimal[] = [];
  let historicalUnrealisedPnL: BigDecimal[] = [];
  let historicalProjectedUnrealisedPnL: BigDecimal[] = [];
  
  //  Initialize ETH-adjusted historical arrays
  let historicalEthAdjustedROI: BigDecimal[] = [];
  let historicalEthAdjustedAPR: BigDecimal[] = [];
  let historicalEthAdjustedProjectedROI: BigDecimal[] = [];
  let historicalEthAdjustedProjectedAPR: BigDecimal[] = [];
  
  if (previousDailyPopulationMetric) {
    historicalROI = previousDailyPopulationMetric.historicalMedianROI;
    historicalAPR = previousDailyPopulationMetric.historicalMedianAPR;
    historicalUnrealisedPnL = previousDailyPopulationMetric.historicalMedianUnrealisedPnL;
    historicalProjectedUnrealisedPnL = previousDailyPopulationMetric.historicalMedianProjectedUnrealisedPnL;
    
    //  Load ETH-adjusted historical data
    historicalEthAdjustedROI = previousDailyPopulationMetric.historicalMedianEthAdjustedROI;
    historicalEthAdjustedAPR = previousDailyPopulationMetric.historicalMedianEthAdjustedAPR;
    historicalEthAdjustedProjectedROI = previousDailyPopulationMetric.historicalMedianEthAdjustedUnrealisedPnL;
    historicalEthAdjustedProjectedAPR = previousDailyPopulationMetric.historicalMedianEthAdjustedProjectedUnrealisedPnL;
  }
  
  // Update historical arrays with new median values
  let updatedHistorical = updateHistoricalArrays(historicalROI, historicalAPR, medianROI, medianAPR);
  let updatedHistoricalROI = updatedHistorical[0];
  let updatedHistoricalAPR = updatedHistorical[1];
  
  // Update unrealised PnL historical array
  let updatedHistoricalUnrealisedPnL = updateProjectedAPRHistoricalArray(historicalUnrealisedPnL, medianUnrealisedPnL);
  
  // Update projected unrealised PnL historical array
  let updatedHistoricalProjectedUnrealisedPnL = updateProjectedAPRHistoricalArray(historicalProjectedUnrealisedPnL, medianProjectedUnrealisedPnL);
  
  //  Update historical arrays with ETH-adjusted values
  let updatedHistoricalEthAdjusted = updateHistoricalArraysEthAdjusted(
    historicalEthAdjustedROI,
    historicalEthAdjustedAPR,
    historicalEthAdjustedProjectedROI,
    historicalEthAdjustedProjectedAPR,
    medianEthAdjustedROI,
    medianEthAdjustedAPR,
    medianEthAdjustedProjectedROI,
    medianEthAdjustedProjectedAPR
  );
  
  // Calculate 7-day simple moving averages
  let sma7dROI = calculate7DaysSMA(updatedHistoricalROI);
  let sma7dAPR = calculate7DaysSMA(updatedHistoricalAPR);
  let sma7dProjectedAPR = calculate7DaysSMA(updatedHistoricalProjectedUnrealisedPnL);
  
  //  Calculate 7-day SMAs for ETH-adjusted metrics
  let sma7dEthAdjustedROI = calculate7DaysSMA(updatedHistoricalEthAdjusted[0]);
  let sma7dEthAdjustedAPR = calculate7DaysSMA(updatedHistoricalEthAdjusted[1]);
  let sma7dEthAdjustedProjectedROI = calculate7DaysSMA(updatedHistoricalEthAdjusted[2]);
  let sma7dEthAdjustedProjectedAPR = calculate7DaysSMA(updatedHistoricalEthAdjusted[3]);
  
  // Calculate 7-day SMAs for unrealised PnL metrics
  let sma7dUnrealisedPnL = calculate7DaysSMA(updatedHistoricalUnrealisedPnL);
  let sma7dProjectedUnrealisedPnL = calculate7DaysSMA(updatedHistoricalProjectedUnrealisedPnL);
  
  // Load all services from the registry to get service addresses
  let registryId = Bytes.fromUTF8("registry");
  let serviceRegistry = ServiceRegistry.load(registryId);
  let serviceAddresses: Bytes[] = [];
  if (serviceRegistry) {
    serviceAddresses = serviceRegistry.serviceAddresses;
  }
  
  // Calculate AUM metrics using the same filtered snapshots
  let medianAUM = calculateMedianAUM(snapshots);
  let totalFundedAUM = calculateTotalFundedAUM(serviceAddresses);
  let averageAgentDaysActive = calculateAverageAgentDaysActive(block);
  
  //Load historical AUM data
  let historicalAUM: BigDecimal[] = [];
  if (previousDailyPopulationMetric) {
    historicalAUM = previousDailyPopulationMetric.historicalMedianAUM;
  }
  
  // Update AUM historical array
  let updatedHistoricalAUM = updateAUMHistoricalArray(historicalAUM, medianAUM);
  
  //Calculate 7-day SMA for AUM
  let sma7dAUM = calculate7DaysSMA(updatedHistoricalAUM);
  
  // Create and save DailyPopulationMetric entity with ETH-adjusted metrics
  updateDailyPopulationMetricEntityWithEthAdjusted(
    medianROI,
    medianAPR,
    medianUnrealisedPnL,
    medianProjectedUnrealisedPnL,
    sma7dROI,
    sma7dAPR,
    sma7dUnrealisedPnL,
    sma7dProjectedUnrealisedPnL,
    updatedHistoricalROI,
    updatedHistoricalAPR,
    updatedHistoricalUnrealisedPnL,
    updatedHistoricalProjectedUnrealisedPnL,
    medianEthAdjustedROI,
    medianEthAdjustedAPR,
    medianEthAdjustedProjectedROI,
    medianEthAdjustedProjectedAPR,
    sma7dEthAdjustedROI,
    sma7dEthAdjustedAPR,
    sma7dEthAdjustedProjectedROI,
    sma7dEthAdjustedProjectedAPR,
    updatedHistoricalEthAdjusted[0],
    updatedHistoricalEthAdjusted[1],
    updatedHistoricalEthAdjusted[2],
    updatedHistoricalEthAdjusted[3],
    medianAUM,
    sma7dAUM,
    updatedHistoricalAUM,
    snapshots.length,
    block
  );
  
  log.info("Population metrics calculation completed successfully for day {}", [dayTimestamp.toString()]);
}
