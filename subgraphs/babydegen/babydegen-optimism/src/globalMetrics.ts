import { BigDecimal, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
import { PopulationMetrics, AgentPortfolioSnapshot, ServiceRegistry } from "../generated/schema";

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
 * Get all agent portfolio snapshots for a specific day timestamp
 * @param dayTimestamp UTC midnight timestamp for the day
 * @returns Array of AgentPortfolioSnapshot entities
 */
export function getAllAgentSnapshots(dayTimestamp: BigInt): AgentPortfolioSnapshot[] {
  let snapshots: AgentPortfolioSnapshot[] = [];
  
  // Load all services from the registry
  let registryId = Bytes.fromUTF8("registry");
  let serviceRegistry = ServiceRegistry.load(registryId);
  if (!serviceRegistry) {
    log.warning("ServiceRegistry not found when calculating global metrics", []);
    return snapshots;
  }
  
  // For each service, try to load its snapshot for this day
  for (let i = 0; i < serviceRegistry.serviceAddresses.length; i++) {
    let serviceAddress = serviceRegistry.serviceAddresses[i];
    let snapshotId = serviceAddress.toHexString() + "-" + dayTimestamp.toString();
    let snapshot = AgentPortfolioSnapshot.load(Bytes.fromUTF8(snapshotId));
    
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }
  
  log.info("Found {} agent snapshots for timestamp {}", [
    snapshots.length.toString(),
    dayTimestamp.toString()
  ]);
  
  return snapshots;
}

/**
 * Get previous PopulationMetrics entity to access historical data
 * @param currentDayTimestamp Current day timestamp (UTC midnight)
 * @returns Previous PopulationMetrics entity or null if not found
 */
export function getPreviousPopulationMetrics(currentDayTimestamp: BigInt): PopulationMetrics | null {
  // Calculate previous day timestamp (24 hours ago)
  let previousTimestamp = currentDayTimestamp.minus(BigInt.fromI32(86400)); // 86400 seconds = 24 hours
  let previousGlobalId = previousTimestamp.toString();
  
  return PopulationMetrics.load(Bytes.fromUTF8(previousGlobalId));
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
 * Create or update PopulationMetrics entity with calculated metrics
 * @param medianROI Calculated median ROI
 * @param medianAPR Calculated median APR
 * @param sma7dROI Calculated 7-day SMA ROI
 * @param sma7dAPR Calculated 7-day SMA APR
 * @param historicalROI Updated historical ROI array
 * @param historicalAPR Updated historical APR array
 * @param totalAgents Number of agents included in calculation
 * @param block Current block
 */
export function updatePopulationMetricsEntity(
  medianROI: BigDecimal,
  medianAPR: BigDecimal,
  sma7dROI: BigDecimal,
  sma7dAPR: BigDecimal,
  historicalROI: BigDecimal[],
  historicalAPR: BigDecimal[],
  totalAgents: number,
  block: ethereum.Block
): void {
  // Use day timestamp (UTC midnight) for entity ID to ensure one entity per day
  let dayTimestamp = getDayTimestamp(block.timestamp);
  let globalId = dayTimestamp.toString();
  let populationMetrics = new PopulationMetrics(Bytes.fromUTF8(globalId));
  
  // Set population metrics
  populationMetrics.medianPopulationROI = medianROI;
  populationMetrics.medianPopulationAPR = medianAPR;
  
  // Set 7-day simple moving averages
  populationMetrics.sma7dROI = sma7dROI;
  populationMetrics.sma7dAPR = sma7dAPR;
  
  // Set metadata
  populationMetrics.timestamp = dayTimestamp; // Use day timestamp for consistency
  populationMetrics.block = block.number;
  populationMetrics.totalAgents = totalAgents as i32;
  
  // Set historical data
  populationMetrics.historicalMedianROI = historicalROI;
  populationMetrics.historicalMedianAPR = historicalAPR;
  
  populationMetrics.save();
  
  log.info("Created PopulationMetrics entity for day timestamp {} with {} agents, median ROI: {}, median APR: {}", [
    dayTimestamp.toString(),
    totalAgents.toString(),
    medianROI.toString(),
    medianAPR.toString()
  ]);
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
  let snapshots = getAllAgentSnapshots(dayTimestamp);
  
  if (snapshots.length == 0) {
    log.warning("No agent snapshots found for population metrics calculation at day timestamp {}", [
      dayTimestamp.toString()
    ]);
    return;
  }
  
  // Extract ROI and APR values from snapshots
  let roiValues: BigDecimal[] = [];
  let aprValues: BigDecimal[] = [];
  
  for (let i = 0; i < snapshots.length; i++) {
    roiValues.push(snapshots[i].roi);
    aprValues.push(snapshots[i].apr);
  }
  
  // Calculate median values
  let medianROI = calculateMedian(roiValues);
  let medianAPR = calculateMedian(aprValues);
  
  // Get previous PopulationMetrics entity for historical data using day timestamp
  let previousPopulationMetrics = getPreviousPopulationMetrics(dayTimestamp);
  let historicalROI: BigDecimal[] = [];
  let historicalAPR: BigDecimal[] = [];
  
  if (previousPopulationMetrics) {
    historicalROI = previousPopulationMetrics.historicalMedianROI;
    historicalAPR = previousPopulationMetrics.historicalMedianAPR;
  }
  
  // Update historical arrays with new median values
  let updatedHistorical = updateHistoricalArrays(historicalROI, historicalAPR, medianROI, medianAPR);
  let updatedHistoricalROI = updatedHistorical[0];
  let updatedHistoricalAPR = updatedHistorical[1];
  
  // Calculate 7-day simple moving averages
  let sma7dROI = calculate7DaysSMA(updatedHistoricalROI);
  let sma7dAPR = calculate7DaysSMA(updatedHistoricalAPR);
  
  // Create and save PopulationMetrics entity
  updatePopulationMetricsEntity(
    medianROI,
    medianAPR,
    sma7dROI,
    sma7dAPR,
    updatedHistoricalROI,
    updatedHistoricalAPR,
    snapshots.length,
    block
  );
  
  log.info("Population metrics calculation completed successfully for day {}", [dayTimestamp.toString()]);
}
