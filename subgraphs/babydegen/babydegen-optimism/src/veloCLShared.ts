import { Address, BigDecimal, BigInt, ethereum, Bytes, log } from "@graphprotocol/graph-ts"
import { NonfungiblePositionManager } from "../../../../generated/VeloNFTManager/NonfungiblePositionManager"
import { VelodromeCLPool } from "../../../../generated/VeloNFTManager/VelodromeCLPool"
import { VelodromeCLFactory } from "../../../../generated/VeloNFTManager/VelodromeCLFactory"
import { LiquidityAmounts } from "./libraries/LiquidityAmounts"
import { TickMath } from "./libraries/TickMath"
import { ProtocolPosition, Service, AgentSwapBuffer } from "../../../../generated/schema"
import { getUsd, refreshPortfolio } from "./common"
import { addAgentNFTToPool, removeAgentNFTFromPool, getCachedPoolAddress, cachePoolAddress } from "./poolIndexCache"
import { getTokenPriceUSD } from "./priceDiscovery"
import { VELO_MANAGER, VELO_FACTORY } from "./constants"
import { isServiceAgent, getServiceByAgent } from "./config"
import { parseTotalSlippageFromBucket, associateSwapsWithPosition } from "./helpers"
import { getTokenDecimals, getTokenSymbol } from "./tokenUtils"
import { initializePositionCosts, calculatePositionROI } from "./roiCalculation"

function convertTokenAmount(amount: BigInt, tokenAddress: Address): BigDecimal {
  const decimals = getTokenDecimals(tokenAddress)
  const divisor = BigDecimal.fromString("1e" + decimals.toString())
  return amount.toBigDecimal().div(divisor)
}

export function getVeloCLPositionId(userAddress: Address, tokenId: BigInt): Bytes {
  const positionId = userAddress.toHex() + "-" + tokenId.toString()
  return Bytes.fromUTF8(positionId)
}

// Helper function to derive pool address from position data with caching
function getPoolAddress(token0: Address, token1: Address, tickSpacing: i32, tokenId: BigInt | null = null): Address {
  if (tokenId !== null) {
    const cached = getCachedPoolAddress("velodrome-cl", tokenId)
    if (cached !== null) {
      return cached
    }
  }
  
  const factory = VelodromeCLFactory.bind(VELO_FACTORY)
  const poolResult = factory.try_getPool(token0, token1, tickSpacing)
  
  if (poolResult.reverted) {
    const reversedResult = factory.try_getPool(token1, token0, tickSpacing)
    
    if (reversedResult.reverted) {
      return Address.zero()
    }
    
    const poolAddress = reversedResult.value
    
    if (tokenId !== null) {
      cachePoolAddress("velodrome-cl", tokenId, poolAddress)
    }
    
    return poolAddress
  }
  
  const poolAddress = poolResult.value
  
  if (tokenId !== null) {
    cachePoolAddress("velodrome-cl", tokenId, poolAddress)
  }
  
  return poolAddress
}

export function ensurePoolTemplate(tokenId: BigInt): void {
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  const posResult = mgr.try_positions(tokenId)
  
  if (posResult.reverted) {
    return
  }
  
  const pos = posResult.value
  const poolAddress = getPoolAddress(pos.value2, pos.value3, pos.value4 as i32, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    return
  }
  
  addAgentNFTToPool("velodrome-cl", poolAddress, tokenId)
}

function isPositionClosed(liquidity: BigInt, amount0: BigDecimal, amount1: BigDecimal): boolean {
  const isLiquidityZero = liquidity.equals(BigInt.zero())
  const areAmountsZero = amount0.equals(BigDecimal.zero()) && amount1.equals(BigDecimal.zero())
    
  return isLiquidityZero || areAmountsZero
}

export function refreshVeloCLPositionWithEventAmounts(
  tokenId: BigInt, 
  block: ethereum.Block, 
  eventAmount0: BigInt,
  eventAmount1: BigInt,
  txHash: Bytes = Bytes.empty()
): void {
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  
  // First, get the actual NFT owner
  const ownerResult = mgr.try_ownerOf(tokenId)
  if (ownerResult.reverted) {
    return
  }
  
  const nftOwner = ownerResult.value

  // AGENT FILTERING: Only process positions owned by a service
  if (!isServiceAgent(nftOwner)) {
    return
  }

  const dataResult = mgr.try_positions(tokenId)
  
  if (dataResult.reverted) {
    return
  }
  
  const data = dataResult.value

  // Derive pool address from position data with caching  
  const poolAddress = getPoolAddress(data.value2, data.value3, data.value4 as i32, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    return
  }

  // USD pricing for event amounts
  const token0Price = getTokenPriceUSD(data.value2, block.timestamp, false)
  const token1Price = getTokenPriceUSD(data.value3, block.timestamp, false)

  // Convert event amounts from wei to human readable using proper decimals
  const eventAmount0Human = convertTokenAmount(eventAmount0, data.value2) // token0
  const eventAmount1Human = convertTokenAmount(eventAmount1, data.value3) // token1
  
  const eventUsd0 = eventAmount0Human.times(token0Price)
  const eventUsd1 = eventAmount1Human.times(token1Price)
  const eventUsd = eventUsd0.plus(eventUsd1)

  // write ProtocolPosition - use consistent ID pattern like Velodrome V2
  const positionId = getVeloCLPositionId(nftOwner, tokenId)
  let pp = ProtocolPosition.load(positionId)
  const isNewPosition = pp == null
  
  if (pp == null) {
    pp = new ProtocolPosition(positionId)
    pp.agent = nftOwner
    pp.service = nftOwner
    pp.protocol = "velodrome-cl"
    pp.pool = poolAddress
    pp.tokenId = tokenId
    pp.isActive = true
    
    let service = Service.load(nftOwner)
    if (service != null) {
      if (service.positionIds == null) {
        service.positionIds = []
      }
      let positionIds = service.positionIds
      let positionIdString = positionId.toString()
      if (positionIds.indexOf(positionIdString) == -1) {
        positionIds.push(positionIdString)
        service.positionIds = positionIds
        service.save()
      }
    }
    
    pp.tickLower = data.value5 as i32
    pp.tickUpper = data.value6 as i32
    pp.tickSpacing = data.value4
    
    pp.entryTxHash = txHash
    pp.entryTimestamp = block.timestamp
    pp.entryAmount0 = eventAmount0Human
    pp.entryAmount0USD = eventUsd0
    pp.entryAmount1 = eventAmount1Human
    pp.entryAmount1USD = eventUsd1
    pp.entryAmountUSD = eventUsd
    
    pp.usdCurrent = eventUsd
    pp.amount0 = eventAmount0Human
    pp.amount1 = eventAmount1Human
    pp.amount0USD = eventUsd0
    pp.amount1USD = eventUsd1
    pp.token0 = data.value2
    pp.token1 = data.value3
    pp.token0Symbol = getTokenSymbol(data.value2)
    pp.token1Symbol = getTokenSymbol(data.value3)
    
    pp.totalCostsUSD = BigDecimal.zero()
    pp.swapSlippageUSD = BigDecimal.zero()
    pp.investmentUSD = BigDecimal.zero()
    pp.grossGainUSD = BigDecimal.zero()
    pp.netGainUSD = BigDecimal.zero()
    pp.positionROI = BigDecimal.zero()
    
    let totalSlippageUSD = associateSwapsWithPosition(nftOwner, block)
    
    if (totalSlippageUSD.lt(BigDecimal.zero())) {
      totalSlippageUSD = BigDecimal.zero()
    }
    
    pp.swapSlippageUSD = totalSlippageUSD
    pp.totalCostsUSD = totalSlippageUSD
    pp.investmentUSD = eventUsd.plus(totalSlippageUSD)
    
    pp.save()
    return
  } else {
    if (pp.entryAmountUSD.equals(BigDecimal.zero()) && pp.entryTimestamp.equals(BigInt.zero())) {
      pp.entryTxHash = txHash
      pp.entryTimestamp = block.timestamp
      pp.entryAmount0 = eventAmount0Human
      pp.entryAmount0USD = eventUsd0
      pp.entryAmount1 = eventAmount1Human
      pp.entryAmount1USD = eventUsd1
      pp.entryAmountUSD = eventUsd
    } else {
      pp.entryAmount0 = pp.entryAmount0.plus(eventAmount0Human)
      pp.entryAmount0USD = pp.entryAmount0USD.plus(eventUsd0)
      pp.entryAmount1 = pp.entryAmount1.plus(eventAmount1Human)
      pp.entryAmount1USD = pp.entryAmount1USD.plus(eventUsd1)
      pp.entryAmountUSD = pp.entryAmountUSD.plus(eventUsd)
    }
    
    pp.save()
    refreshVeloCLPosition(tokenId, block, txHash)
    return
  }
}

// 2b. Handle position exit with actual event amounts
export function refreshVeloCLPositionWithExitAmounts(
  tokenId: BigInt, 
  block: ethereum.Block, 
  eventAmount0: BigInt,
  eventAmount1: BigInt,
  liquidityRemoved: BigInt,
  txHash: Bytes = Bytes.empty()
): void {
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  const ownerResult = mgr.try_ownerOf(tokenId)
  if (ownerResult.reverted) {
    return
  }
  
  const nftOwner = ownerResult.value
  if (!isServiceAgent(nftOwner)) {
    return
  }

  const dataResult = mgr.try_positions(tokenId)
  if (dataResult.reverted) {
    return
  }
  
  const data = dataResult.value
  const positionId = getVeloCLPositionId(nftOwner, tokenId)
  let pp = ProtocolPosition.load(positionId)
  
  if (pp == null) {
    return
  }
  
  const remainingLiquidity = data.value7
  const isFullExit = remainingLiquidity.equals(BigInt.zero())
  
  if (isFullExit) {
    const token0Price = getTokenPriceUSD(data.value2, block.timestamp, false)
    const token1Price = getTokenPriceUSD(data.value3, block.timestamp, false)
    
    const exitAmount0Human = convertTokenAmount(eventAmount0, data.value2)
    const exitAmount1Human = convertTokenAmount(eventAmount1, data.value3)
    
    const exitUsd0 = exitAmount0Human.times(token0Price)
    const exitUsd1 = exitAmount1Human.times(token1Price)
    const exitUsd = exitUsd0.plus(exitUsd1)
    
    pp.isActive = false
    pp.exitTxHash = txHash
    pp.exitTimestamp = block.timestamp
    pp.exitAmount0 = exitAmount0Human
    pp.exitAmount0USD = exitUsd0
    pp.exitAmount1 = exitAmount1Human
    pp.exitAmount1USD = exitUsd1
    pp.exitAmountUSD = exitUsd
    
    pp.amount0 = BigDecimal.zero()
    pp.amount1 = BigDecimal.zero()
    pp.amount0USD = BigDecimal.zero()
    pp.amount1USD = BigDecimal.zero()
    pp.usdCurrent = BigDecimal.zero()
    pp.liquidity = BigInt.zero()
    
    calculatePositionROI(pp)
    
    const poolAddress = getPoolAddress(data.value2, data.value3, data.value4 as i32, tokenId)
    removeAgentNFTFromPool("velodrome-cl", poolAddress, tokenId)
    
    pp.save()
    refreshPortfolio(nftOwner, block)
  } else {
    refreshVeloCLPosition(tokenId, block, txHash)
  }
}

export function refreshVeloCLPosition(tokenId: BigInt, block: ethereum.Block, txHash: Bytes = Bytes.empty()): void {
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  const ownerResult = mgr.try_ownerOf(tokenId)
  if (ownerResult.reverted) {
    return
  }
  
  const nftOwner = ownerResult.value
  if (!isServiceAgent(nftOwner)) {
    return
  }

  const positionId = getVeloCLPositionId(nftOwner, tokenId)
  let position = ProtocolPosition.load(positionId)
  
  if (position && !position.isActive) {
    return
  }
  
  const dataResult = mgr.try_positions(tokenId)
  if (dataResult.reverted) {
    return
  }
  
  const data = dataResult.value
  const poolAddress = getPoolAddress(data.value2, data.value3, data.value4 as i32, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    return
  }
  
  const pool = VelodromeCLPool.bind(poolAddress)
  const slot0Result = pool.try_slot0()
  
  if (slot0Result.reverted) {
    return
  }
  
  const slot0 = slot0Result.value
  const tickLower = data.value5 as i32
  const tickUpper = data.value6 as i32
  
  const sqrtPa = TickMath.getSqrtRatioAtTick(tickLower)
  const sqrtPb = TickMath.getSqrtRatioAtTick(tickUpper)
  
  const amounts = LiquidityAmounts.getAmountsForLiquidity(
                    slot0.value0, sqrtPa, sqrtPb, data.value7)

  const token0Price = getTokenPriceUSD(data.value2, block.timestamp, false)
  const token1Price = getTokenPriceUSD(data.value3, block.timestamp, false)

  const amount0Human = convertTokenAmount(amounts.amount0, data.value2)
  const amount1Human = convertTokenAmount(amounts.amount1, data.value3)
  
  const usd0 = amount0Human.times(token0Price)
  const usd1 = amount1Human.times(token1Price)
  const usd = usd0.plus(usd1)

  let pp = ProtocolPosition.load(positionId)
  const isNewPosition = pp == null
  
  if (pp == null) {
    pp = new ProtocolPosition(positionId)
    pp.agent = nftOwner
    pp.service = nftOwner
    pp.protocol = "velodrome-cl"
    pp.pool = poolAddress
    pp.tokenId = tokenId
    pp.isActive = true
    
    let service = Service.load(nftOwner)
    if (service != null) {
      if (service.positionIds == null) {
        service.positionIds = []
      }
      let positionIds = service.positionIds
      let positionIdString = positionId.toString()
      if (positionIds.indexOf(positionIdString) == -1) {
        positionIds.push(positionIdString)
        service.positionIds = positionIds
        service.save()
      }
    }
    
    pp.tickLower = tickLower
    pp.tickUpper = tickUpper
    pp.tickSpacing = data.value4
    
    pp.usdCurrent = usd
    pp.token0 = data.value2
    pp.token0Symbol = getTokenSymbol(data.value2)
    pp.amount0 = amount0Human
    pp.amount0USD = usd0
    pp.token1 = data.value3
    pp.token1Symbol = getTokenSymbol(data.value3)
    pp.amount1 = amount1Human
    pp.amount1USD = usd1
    pp.liquidity = data.value7
    
    pp.entryTxHash = txHash
    pp.entryTimestamp = block.timestamp
    pp.entryAmount0 = BigDecimal.zero()
    pp.entryAmount0USD = BigDecimal.zero()
    pp.entryAmount1 = BigDecimal.zero()
    pp.entryAmount1USD = BigDecimal.zero()
    pp.entryAmountUSD = BigDecimal.zero()
    
    initializePositionCosts(pp)
  }
  
  pp.usdCurrent = usd
  pp.token0 = data.value2
  pp.token0Symbol = getTokenSymbol(data.value2)
  pp.amount0 = amount0Human
  pp.amount0USD = usd0
  pp.token1 = data.value3
  pp.token1Symbol = getTokenSymbol(data.value3)
  pp.amount1 = amount1Human
  pp.amount1USD = usd1
  pp.liquidity = data.value7
  
  if (pp.totalCostsUSD.equals(BigDecimal.zero()) && pp.swapSlippageUSD.equals(BigDecimal.zero())) {
    if (pp.investmentUSD.equals(BigDecimal.zero()) && pp.entryAmountUSD.gt(BigDecimal.zero())) {
      pp.investmentUSD = pp.entryAmountUSD.plus(pp.totalCostsUSD)
    }
  }
  
  if (isPositionClosed(data.value7, amount0Human, amount1Human)) {
    pp.isActive = false
    pp.exitTxHash = txHash
    pp.exitTimestamp = block.timestamp
    pp.exitAmount0 = amount0Human
    pp.exitAmount0USD = usd0
    pp.exitAmount1 = amount1Human
    pp.exitAmount1USD = usd1
    pp.exitAmountUSD = usd
    
    calculatePositionROI(pp)
    removeAgentNFTFromPool("velodrome-cl", poolAddress, tokenId)
  }
  
  pp.save()
  refreshPortfolio(nftOwner, block)
}

export function handleNFTTransferForCache(tokenId: BigInt, from: Address, to: Address): void {
  const mgr = NonfungiblePositionManager.bind(VELO_MANAGER)
  const posResult = mgr.try_positions(tokenId)
  
  if (posResult.reverted) {
    return
  }
  
  const pos = posResult.value
  const poolAddress = getPoolAddress(pos.value2, pos.value3, pos.value4 as i32, tokenId)
  
  if (poolAddress.equals(Address.zero())) {
    return
  }
  
  if (!from.equals(Address.zero())) {
    removeAgentNFTFromPool("velodrome-cl", poolAddress, tokenId)
  }
  
  if (!to.equals(Address.zero())) {
    addAgentNFTToPool("velodrome-cl", poolAddress, tokenId)
  }
}
