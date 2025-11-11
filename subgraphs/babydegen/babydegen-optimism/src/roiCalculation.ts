import { BigDecimal, BigInt, Address, Bytes, log } from "@graphprotocol/graph-ts"
import { ProtocolPosition, AgentPortfolio, Service } from "../generated/schema"
import { getServiceByAgent } from "./config"

/**
 * Calculate position-based ROI for an agent from closed positions only
 * Formula: (Sum(Gi) - Sum(Ii) - Sum(Ci)) / (Sum(Ii) + Sum(Ci))
 * Where: Gi = gross gains, Ii = investments, Ci = costs
 */
export function calculateActualROI(agent: Address): BigDecimal {
  let service = Service.load(agent)
  if (service == null || service.positionIds == null) {
    return BigDecimal.zero()
  }
  
  let totalInvestments = BigDecimal.zero()  // Sum of Ii (entry amounts only)
  let totalGrossGains = BigDecimal.zero()   // Sum of Gi (exit amounts)
  let totalCosts = BigDecimal.zero()        // Sum of Ci (costs only)
  
  // Iterate through all positions
  let positionIds = service.positionIds
  for (let i = 0; i < positionIds.length; i++) {
    let positionIdString = positionIds[i]
    let position = loadPosition(positionIdString)
    
    if (position != null && !position.isActive) {  // Only closed positions
      // CORRECTED: Separate investments and costs (no double counting)
      totalInvestments = totalInvestments.plus(position.entryAmountUSD)  // Ii
      totalCosts = totalCosts.plus(position.totalCostsUSD)              // Ci
      
      // Gross gains = exit amount
      if (position.exitAmountUSD) {
        totalGrossGains = totalGrossGains.plus(position.exitAmountUSD!)  // Gi
      }
    }
  }
  
  // CORRECTED FORMULA: (G1+G2+G3 - I1-I2-I3 - C1-C2-C3) / (I1+I2+I3 + C1+C2+C3)
  let totalInvestmentPlusCosts = totalInvestments.plus(totalCosts)
  
  if (totalInvestmentPlusCosts.gt(BigDecimal.zero())) {
    let netGain = totalGrossGains.minus(totalInvestments).minus(totalCosts)
    let actualROI = netGain.div(totalInvestmentPlusCosts).times(BigDecimal.fromString("100"))
    
    log.info("ACTUAL ROI: Agent {} - Gains: {}, Investments: {}, Costs: {}, ROI: {}%", [
      agent.toHexString(),
      totalGrossGains.toString(),
      totalInvestments.toString(),
      totalCosts.toString(),
      actualROI.toString()
    ])
    
    return actualROI
  }
  
  return BigDecimal.zero()
}

/**
 * Calculate individual position ROI when position closes
 */
export function calculatePositionROI(position: ProtocolPosition): BigDecimal {
  if (position.isActive || !position.exitAmountUSD) {
    return BigDecimal.zero()  // Only calculate for closed positions
  }
  
  // Investment = entry amount + costs
  let investment = position.entryAmountUSD.plus(position.totalCostsUSD)
  
  if (investment.gt(BigDecimal.zero())) {
    // grossGainUSD = exitAmount
    let grossGainUSD = position.exitAmountUSD!
    
    // netGainUSD = exitAmount - investmentUSD (gain after all costs including slippage)
    let netGainUSD = position.exitAmountUSD!.minus(investment)
    
    // Position ROI = netGainUSD / investmentUSD * 100
    let positionROI = netGainUSD.div(investment).times(BigDecimal.fromString("100"))
    
    position.investmentUSD = investment
    position.grossGainUSD = grossGainUSD  // Total amount received
    position.netGainUSD = netGainUSD      // Actual profit/loss
    position.positionROI = positionROI
    position.save()
    
    return positionROI
  }
  
  return BigDecimal.zero()
}

/**
 * Aggregate closed position metrics for an agent
 */
export function aggregateClosedPositionMetrics(agent: Address): PositionAggregates {
  let service = Service.load(agent)
  if (service == null || service.positionIds == null) {
    return new PositionAggregates(BigDecimal.zero(), BigDecimal.zero(), BigDecimal.zero())
  }
  
  let totalInvestments = BigDecimal.zero()
  let totalGrossGains = BigDecimal.zero()
  let totalCosts = BigDecimal.zero()
  
  let positionIds = service.positionIds
  for (let i = 0; i < positionIds.length; i++) {
    let positionIdString = positionIds[i]
    let position = loadPosition(positionIdString)
    
    if (position != null && !position.isActive) {  // Only closed positions
      totalInvestments = totalInvestments.plus(position.entryAmountUSD)
      totalCosts = totalCosts.plus(position.totalCostsUSD)
      
      if (position.exitAmountUSD) {
        totalGrossGains = totalGrossGains.plus(position.exitAmountUSD!)
      }
    }
  }
  
  return new PositionAggregates(totalInvestments, totalGrossGains, totalCosts)
}

/**
 * Update position costs (called when swaps are associated)
 */
export function updatePositionCosts(position: ProtocolPosition, additionalCosts: BigDecimal): void {
  position.totalCostsUSD = position.totalCostsUSD.plus(additionalCosts)
  position.investmentUSD = position.entryAmountUSD.plus(position.totalCostsUSD)
  
  // Recalculate position ROI if position is closed
  if (!position.isActive && position.exitAmountUSD) {
    calculatePositionROI(position)
  }
  
  position.save()
}

/**
 * Initialize cost tracking for new positions
 */
export function initializePositionCosts(position: ProtocolPosition): void {
  position.totalCostsUSD = BigDecimal.zero()
  position.swapSlippageUSD = BigDecimal.zero()
  position.investmentUSD = position.entryAmountUSD
  position.grossGainUSD = BigDecimal.zero()
  position.netGainUSD = BigDecimal.zero()
  position.positionROI = BigDecimal.zero()
  position.save()
}

/**
 * Helper class for position aggregates
 */
class PositionAggregates {
  totalInvestments: BigDecimal
  totalGrossGains: BigDecimal
  totalCosts: BigDecimal
  
  constructor(investments: BigDecimal, gains: BigDecimal, costs: BigDecimal) {
    this.totalInvestments = investments
    this.totalGrossGains = gains
    this.totalCosts = costs
  }
}

/**
 * Helper function to load position with different ID formats
 */
function loadPosition(positionIdString: string): ProtocolPosition | null {
  // Method 1: Try as direct UTF8 string (standard format)
  let directId = Bytes.fromUTF8(positionIdString)
  let position = ProtocolPosition.load(directId)
  
  if (position == null) {
    // Method 2: Try as hex-decoded string (for any legacy hex-encoded IDs)
    if (positionIdString.startsWith("0x") && positionIdString.length % 2 == 0) {
      let hexBytes = Bytes.fromHexString(positionIdString)
      let decodedString = hexBytes.toString()
      let decodedId = Bytes.fromUTF8(decodedString)
      position = ProtocolPosition.load(decodedId)
    }
  }
  
  return position
}
