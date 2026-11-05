import { BigDecimal, Address, Bytes, ethereum, BigInt, log } from "@graphprotocol/graph-ts"
import { TokenBalance, Service, FundingBalance } from "../generated/schema"
import { Transfer as TransferEvent } from "../generated/USDC_Native/ERC20"
import { TOKENS } from "./tokenConfig"
import { getServiceByAgent } from "./config"
import { isUserSide, isWithdrawalRecipient, getAddressType, AddressTypeReader, getEthUsd } from "./common"
import { getTokenPriceUSD } from "./priceDiscovery"
import { convertTokenAmount } from "./tokenUtils"
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
  let amountDecimal = convertTokenAmount(amount, tokenAddress)
  
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
      let usdValue = transferUsdValue(value, tokenAddress, to, event)
      updateFundingBalance(to, usdValue, event.block.timestamp, txHash)
    }
  }
  
  // Handle transfers FROM service safes (withdrawals)
  let fromService = getServiceByAgent(from)
  if (fromService != null) {
    updateTokenBalance(from, tokenAddress, value, false, event.block)
    
    if (isWithdrawalRecipient(to, from, event, readAddressType)) {
      let usdValue = transferUsdValue(value, tokenAddress, from, event)
      updateWithdrawalBalance(from, usdValue, event.block.timestamp)
    }
  }
}

function transferUsdValue(value: BigInt, tokenAddress: Address, safe: Address, event: ethereum.Event): BigDecimal {
  let tokenPrice = getTokenPriceUSD(tokenAddress, event.block.timestamp, false)
  if (tokenPrice.equals(BigDecimal.zero())) {
    log.warning("FUNDING: token {} has no price — its transfer for safe {} in tx {} is valued at $0", [
      tokenAddress.toHexString(), safe.toHexString(), event.transaction.hash.toHexString()
    ])
  }
  return convertTokenAmount(value, tokenAddress).times(tokenPrice)
}

// The single source of truth for funding in. Outflows go to updateWithdrawalBalance, so
// totalOutUsd stays 0 and netUsd equals totalInUsd.
export function updateFundingBalance(
  serviceSafe: Address,
  usd: BigDecimal,
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
  
  fb.totalInUsd = fb.totalInUsd.plus(usd)
  
  if (txHash != "") {
    let fundingInTxs = fb.fundingInTxs
    fundingInTxs.push(txHash)
    fb.fundingInTxs = fundingInTxs
  }
  
  if (oldTotalIn.equals(BigDecimal.zero())) {
    let portfolio = ensureAgentPortfolio(serviceSafe, ts)
    if (portfolio.firstTradingTimestamp.equals(BigInt.zero())) {
      portfolio.firstTradingTimestamp = ts
      let block = createBlockFromTimestamp(ts)
      portfolio.firstFundingEthPrice = getEthUsd(block)
      portfolio.save()
    }
  }
  
  fb.netUsd = fb.totalInUsd
  fb.lastChangeTs = ts
  fb.save()
  
  ensureAgentPortfolio(serviceSafe, ts)
}

// Withdrawals are kept apart from funding, so they never reduce netUsd
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
