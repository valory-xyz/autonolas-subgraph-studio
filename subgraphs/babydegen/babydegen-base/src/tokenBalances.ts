import { BigDecimal, Address, Bytes, ethereum, BigInt, log } from "@graphprotocol/graph-ts"
import { TokenBalance, Service, FundingBalance } from "../generated/schema"
import { Transfer as TransferEvent } from "../generated/USDC_Native/ERC20"
import { TOKENS } from "./tokenConfig"
import { getServiceByAgent } from "./config"
import { isUserSide, isWithdrawalRecipient, getAddressType, AddressTypeReader, getEthUsd } from "./common"
import { getTokenPriceUSD } from "./priceDiscovery"
import { WETH, WHITELISTED_TOKENS } from "./constants"
import { ensureAgentPortfolio, calculatePortfolioMetrics } from "./helpers"
import { attributeRewardTransfer } from "./positionIncome"

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

// Calculate the total USD value of uninvested funds (tokens held in the safe)
export function calculateUninvestedValue(serviceSafe: Address): BigDecimal {
  let totalUSD = BigDecimal.zero()
  
  // Check ETH balance
  let ethAddress = Address.zero()
  let ethBalanceId = serviceSafe.toHexString() + "-" + ethAddress.toHexString()
  let ethBalance = TokenBalance.load(Bytes.fromUTF8(ethBalanceId))
  
  if (ethBalance != null && ethBalance.balance.gt(BigDecimal.zero())) {
    totalUSD = totalUSD.plus(ethBalance.balanceUSD)
  }
  
  // Check whitelisted token balances from tokenConfig
  // Use the WHITELISTED_TOKENS array from constants instead of iterating over Map
  let tokenKeysArray = WHITELISTED_TOKENS
  
  for (let i = 0; i < tokenKeysArray.length; i++) {
    let tokenAddressString = tokenKeysArray[i]
    // FIX: Convert string to Address and back to ensure proper formatting
    let tokenAddress = Address.fromString(tokenAddressString)
    let balanceId = serviceSafe.toHexString() + "-" + tokenAddress.toHexString()
    let balance = TokenBalance.load(Bytes.fromUTF8(balanceId))
    
    if (balance != null && balance.balance.gt(BigDecimal.zero())) {
      totalUSD = totalUSD.plus(balance.balanceUSD)
    }
  }
  return totalUSD
}

// Update ETH balance for a service safe
export function updateETHBalance(
  serviceSafe: Address,
  amount: BigInt,
  isIncrease: boolean,
  block: ethereum.Block
): void {
  
  let service = getServiceByAgent(serviceSafe)
  if (service == null) {
    return
  }
  
  let ethAddress = Address.zero()
  let balanceId = serviceSafe.toHexString() + "-" + ethAddress.toHexString()
  let balance = TokenBalance.load(Bytes.fromUTF8(balanceId))
  
  if (balance == null) {
    balance = new TokenBalance(Bytes.fromUTF8(balanceId))
    balance.service = serviceSafe
    balance.token = ethAddress
    balance.symbol = "ETH"
    balance.decimals = 18
    balance.balance = BigDecimal.zero()
    balance.balanceUSD = BigDecimal.zero()
  }
  
  // Update balance
  let amountDecimal = amount.toBigDecimal().div(BigDecimal.fromString("1e18"))
  
  if (isIncrease) {
    balance.balance = balance.balance.plus(amountDecimal)
  } else {
    balance.balance = balance.balance.minus(amountDecimal)
    
    if (balance.balance.lt(BigDecimal.zero())) {
      balance.balance = BigDecimal.zero()
    }
  }
  
  // Update USD value using price discovery
  let ethPrice = getTokenPriceUSD(WETH, block.timestamp, false)
  balance.balanceUSD = balance.balance.times(ethPrice)
  
  balance.lastUpdated = block.timestamp
  balance.lastBlock = block.number
  balance.save()
}

// Update token balance for a service safe
export function updateTokenBalance(
  serviceSafe: Address,
  tokenAddress: Address,
  amount: BigInt,
  isIncrease: boolean,
  block: ethereum.Block
): void {
  let service = getServiceByAgent(serviceSafe)
  if (service == null) {
    return
  }
  
  // Check if token is whitelisted
  let tokenConfig = TOKENS.get(tokenAddress.toHexString().toLowerCase())
  if (tokenConfig == null) {
    return
  }
  
  let balanceId = serviceSafe.toHexString() + "-" + tokenAddress.toHexString()
  let balance = TokenBalance.load(Bytes.fromUTF8(balanceId))
  
  if (balance == null) {
    balance = new TokenBalance(Bytes.fromUTF8(balanceId))
    balance.service = serviceSafe
    balance.token = tokenAddress
    balance.symbol = tokenConfig.symbol
    balance.decimals = tokenConfig.decimals
    balance.balance = BigDecimal.zero()
    balance.balanceUSD = BigDecimal.zero()
  }
  
  // Update balance
  let divisor = BigDecimal.fromString("1" + "0".repeat(tokenConfig.decimals))
  let amountDecimal = amount.toBigDecimal().div(divisor)
  
  if (isIncrease) {
    balance.balance = balance.balance.plus(amountDecimal)
  } else {
    balance.balance = balance.balance.minus(amountDecimal)
    if (balance.balance.lt(BigDecimal.zero())) {
      balance.balance = BigDecimal.zero()
    }
  }
  
  // Update USD value using price discovery
  let tokenPrice = getTokenPriceUSD(tokenAddress, block.timestamp, false)
  balance.balanceUSD = balance.balance.times(tokenPrice)
  
  balance.lastUpdated = block.timestamp
  balance.lastBlock = block.number
  balance.save()
}

// Handle ERC20 transfer events
export function handleERC20Transfer(event: TransferEvent): void {
  processERC20Transfer(event, getAddressType)
}

export function processERC20Transfer(event: TransferEvent, readAddressType: AddressTypeReader): void {
  let from = event.params.from
  let to = event.params.to
  let value = event.params.value
  let tokenAddress = event.address
  let txHash = event.transaction.hash.toHexString()
  
  // Check if this is a whitelisted token
  let tokenConfig = TOKENS.get(tokenAddress.toHexString().toLowerCase())
  if (tokenConfig == null) {
    return // Not a whitelisted token
  }
  
  // Handle transfers TO service safes (deposits)
  let toService = getServiceByAgent(to)
  if (toService != null) {
    attributeRewardTransfer(event, from, to, value)
    updateTokenBalance(to, tokenAddress, value, true, event.block)
    
    // ALWAYS ensure portfolio exists and is updated for ANY token activity
    ensureAgentPortfolio(to, event.block.timestamp)
    
    // Trigger portfolio recalculation for any token balance change
    calculatePortfolioMetrics(to, event.block)
    
    if (isUserSide(from, to, event, readAddressType)) {
      let usdValue = transferUsdValue(value, tokenAddress, tokenConfig.decimals, event.block.timestamp)
      updateFundingBalance(to, usdValue, true, event.block.timestamp, txHash)
    }
  }
  
  // Handle transfers FROM service safes (withdrawals)
  let fromService = getServiceByAgent(from)
  if (fromService != null) {
    updateTokenBalance(from, tokenAddress, value, false, event.block)
    
    // Withdrawals are tracked separately so the initial value is preserved
    if (isWithdrawalRecipient(to, from, event, readAddressType)) {
      let usdValue = transferUsdValue(value, tokenAddress, tokenConfig.decimals, event.block.timestamp)
      updateWithdrawalBalance(from, usdValue, event.block.timestamp)
    }
  }
}

function transferUsdValue(value: BigInt, tokenAddress: Address, decimals: i32, timestamp: BigInt): BigDecimal {
  let divisor = BigDecimal.fromString("1" + "0".repeat(decimals))
  let tokenPrice = getTokenPriceUSD(tokenAddress, timestamp, false)
  return value.toBigDecimal().div(divisor).times(tokenPrice)
}

// Helper function to update funding balance without circular dependency
// Exported to be the single source of truth for funding balance updates
export function updateFundingBalance(
  serviceSafe: Address,
  usd: BigDecimal,
  deposit: boolean,
  ts: BigInt,
  txHash: string = ""
): void {
  let id = serviceSafe as Bytes
  let fb = FundingBalance.load(id)
  
  if (!fb) {
    fb = new FundingBalance(id)
    fb.service = serviceSafe
    fb.totalInUsd = BigDecimal.zero()
    fb.totalOutUsd = BigDecimal.zero()
    fb.totalWithdrawnUsd = BigDecimal.zero()  // Initialize new field
    fb.netUsd = BigDecimal.zero()
    fb.firstInTimestamp = ts
    fb.fundingInTxs = []
    fb.fundingOutTxs = []
  }
  
  let oldTotalIn = fb.totalInUsd
  let oldTotalOut = fb.totalOutUsd
  
  if (deposit) {
    fb.totalInUsd = fb.totalInUsd.plus(usd)
    
    if (txHash != "") {
      let fundingInTxs = fb.fundingInTxs
      fundingInTxs.push(txHash)
      fb.fundingInTxs = fundingInTxs
    }
    
    //  Set firstTradingTimestamp and capture ETH price on first funding
    if (oldTotalIn.equals(BigDecimal.zero())) {
      // This is the first funding - update portfolio
      let portfolio = ensureAgentPortfolio(serviceSafe, ts)
      if (portfolio.firstTradingTimestamp.equals(BigInt.zero())) {
        portfolio.firstTradingTimestamp = ts
        
        // Capture ETH price at first funding
        let block = createBlockFromTimestamp(ts)
        portfolio.firstFundingEthPrice = getEthUsd(block)
        portfolio.save()
      }
    }
  } else {
    fb.totalOutUsd = fb.totalOutUsd.plus(usd)
    
    if (txHash != "") {
      let fundingOutTxs = fb.fundingOutTxs
      fundingOutTxs.push(txHash)
      fb.fundingOutTxs = fundingOutTxs
    }
  }
  
  fb.netUsd = fb.totalInUsd.minus(fb.totalOutUsd)
  fb.lastChangeTs = ts
  fb.save()
  
  // Ensure AgentPortfolio exists when funding balance is updated
  ensureAgentPortfolio(serviceSafe, ts)
}

//  Helper function to update withdrawal tracking separately (for EOA withdrawals)
export function updateWithdrawalBalance(
  serviceSafe: Address,
  usd: BigDecimal,
  ts: BigInt
): void {
  let id = serviceSafe as Bytes
  let fb = FundingBalance.load(id)
  
  if (!fb) {
    fb = new FundingBalance(id)
    fb.service = serviceSafe
    fb.totalInUsd = BigDecimal.zero()
    fb.totalOutUsd = BigDecimal.zero()
    fb.totalWithdrawnUsd = BigDecimal.zero()
    fb.netUsd = BigDecimal.zero()
    fb.firstInTimestamp = ts
    fb.fundingInTxs = []
    fb.fundingOutTxs = []
  }
  
  // Track withdrawal separately without affecting netUsd
  fb.totalWithdrawnUsd = fb.totalWithdrawnUsd.plus(usd)
  fb.lastChangeTs = ts
  fb.save()
  
  log.info("WITHDRAWAL: Tracked {} USD withdrawal for agent {} - total withdrawn: {}", [
    usd.toString(),
    serviceSafe.toHexString(),
    fb.totalWithdrawnUsd.toString()
  ])
  
  // Ensure AgentPortfolio exists when withdrawal is tracked
  ensureAgentPortfolio(serviceSafe, ts)
}
