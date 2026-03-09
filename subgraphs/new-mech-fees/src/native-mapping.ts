import { Address, BigDecimal, dataSource, log } from "@graphprotocol/graph-ts"
import {
  MechBalanceAdjusted,
  Withdraw
} from "../generated/BalanceTrackerFixedPriceNative/BalanceTrackerFixedPriceNative"
import { AggregatorV3Interface } from "../generated/BalanceTrackerFixedPriceNative/AggregatorV3Interface"
import { Mech } from "../generated/schema"
import {
  getBurnAddressMechFees,
  CHAINLINK_PRICE_FEED_ADDRESS_BASE_ETH_USD,
  CHAINLINK_PRICE_FEED_ADDRESS_POLYGON_POL_USD,
  CHAINLINK_PRICE_FEED_ADDRESS_OPTIMISM_ETH_USD,
  CHAINLINK_PRICE_FEED_ADDRESS_ETHEREUM_ETH_USD,
  CHAINLINK_PRICE_FEED_ADDRESS_ARBITRUM_ETH_USD,
  CHAINLINK_PRICE_FEED_ADDRESS_CELO_CELO_USD
} from "../../../shared/constants"
import {
  updateTotalFeesIn,
  updateTotalFeesOut,
  convertGnosisNativeWeiToUsd,
  convertNativeWeiToUsd,
  updateMechFeesIn,
  updateMechFeesOut,
  createMechTransactionForAccrued,
  createMechTransactionForCollected,
  updateMechModelIn,
  updateMechModelOut,
  updateDailyTotalsIn,
  updateDailyTotalsOut,
  updateMechDailyIn,
  updateMechDailyOut
} from "./utils"

const BURN_ADDRESS = getBurnAddressMechFees();
const MODEL = "native";

function getChainlinkPriceFeedAddress(): Address {
  const n = dataSource.network();
  if (n == "mainnet") return Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_ETHEREUM_ETH_USD);
  if (n == "base") return Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_BASE_ETH_USD);
  if (n == "matic") return Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_POLYGON_POL_USD);
  if (n == "optimism") return Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_OPTIMISM_ETH_USD);
  if (n == "arbitrum-one") return Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_ARBITRUM_ETH_USD);
  if (n == "celo") return Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_CELO_CELO_USD);
  return Address.zero();
}

export function handleMechBalanceAdjustedForNative(event: MechBalanceAdjusted): void {
  const amountWei = event.params.deliveryRate;
  const mechId = event.params.mech.toHex();
  const network = dataSource.network();

  let amountUsd: BigDecimal;
  if (network == "xdai" || network == "gnosis") {
    amountUsd = convertGnosisNativeWeiToUsd(amountWei);
  } else {
    const priceFeed = AggregatorV3Interface.bind(getChainlinkPriceFeedAddress());
    const latestRoundData = priceFeed.try_latestRoundData();
    if (latestRoundData.reverted) {
      log.error("Could not get price from Chainlink for tx: {}", [event.transaction.hash.toHex()]);
      return;
    }
    amountUsd = convertNativeWeiToUsd(amountWei, latestRoundData.value.value1);
  }

  updateTotalFeesIn(amountUsd);
  updateMechFeesIn(mechId, amountUsd, amountWei.toBigDecimal());
  updateMechModelIn(mechId, MODEL, amountUsd, amountWei.toBigDecimal());
  updateDailyTotalsIn(amountUsd, event.block.timestamp);
  updateMechDailyIn(mechId, amountUsd, amountWei.toBigDecimal(), event.block.timestamp);

  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForAccrued(
      mech,
      amountWei.toBigDecimal(),
      amountUsd,
      event,
      event.params.deliveryRate,
      event.params.balance,
      event.params.rateDiff,
      MODEL
    );
  }
}

export function handleWithdrawForNative(event: Withdraw): void {
  const recipientAddress = event.params.account;
  const withdrawalAmountWei = event.params.amount;
  const mechId = recipientAddress.toHex();

  if (recipientAddress.equals(BURN_ADDRESS)) {
    return;
  }

  const network = dataSource.network();

  let withdrawalAmountUsd: BigDecimal;
  if (network == "xdai" || network == "gnosis") {
    withdrawalAmountUsd = convertGnosisNativeWeiToUsd(withdrawalAmountWei);
  } else {
    const priceFeed = AggregatorV3Interface.bind(getChainlinkPriceFeedAddress());
    const latestRoundData = priceFeed.try_latestRoundData();
    if (latestRoundData.reverted) {
      log.error("Could not get price from Chainlink for tx: {}", [event.transaction.hash.toHex()]);
      return;
    }
    withdrawalAmountUsd = convertNativeWeiToUsd(withdrawalAmountWei, latestRoundData.value.value1);
  }

  updateTotalFeesOut(withdrawalAmountUsd);
  updateMechFeesOut(mechId, withdrawalAmountUsd, withdrawalAmountWei.toBigDecimal());
  updateMechModelOut(mechId, MODEL, withdrawalAmountUsd, withdrawalAmountWei.toBigDecimal());
  updateDailyTotalsOut(withdrawalAmountUsd, event.block.timestamp);
  updateMechDailyOut(mechId, withdrawalAmountUsd, withdrawalAmountWei.toBigDecimal(), event.block.timestamp);

  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForCollected(
      mech,
      withdrawalAmountWei.toBigDecimal(),
      withdrawalAmountUsd,
      event,
      MODEL
    );
  }
}
