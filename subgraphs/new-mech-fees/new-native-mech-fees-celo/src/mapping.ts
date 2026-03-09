import { Address, log } from "@graphprotocol/graph-ts"
import {
  MechBalanceAdjusted,
  Withdraw
} from "../../common/generated/BalanceTrackerFixedPriceNative/BalanceTrackerFixedPriceNative"
import { Mech } from "../../common/generated/schema"
import { getBurnAddressMechFees, CHAINLINK_PRICE_FEED_ADDRESS_CELO_CELO_USD } from "../../../../shared/constants"
import {
  updateTotalFeesIn,
  updateTotalFeesOut,
  convertCeloNativeWeiToUsd,
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
} from "../../common/utils"
import { AggregatorV3Interface } from "../../common/generated/BalanceTrackerFixedPriceNative/AggregatorV3Interface"

const BURN_ADDRESS = getBurnAddressMechFees();
const PRICE_FEED_ADDRESS = Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_CELO_CELO_USD);
const MODEL = "native";

export function handleMechBalanceAdjustedForNative(event: MechBalanceAdjusted): void {
  const deliveryRateCelo = event.params.deliveryRate;
  const mechId = event.params.mech.toHex();

  const priceFeed = AggregatorV3Interface.bind(PRICE_FEED_ADDRESS);
  const latestRoundData = priceFeed.try_latestRoundData();

  if (latestRoundData.reverted) {
    log.error("Could not get price from Chainlink for tx: {}", [event.transaction.hash.toHex()]);
    return;
  }

  const deliveryRateUsd = convertCeloNativeWeiToUsd(
    deliveryRateCelo,
    latestRoundData.value.value1
  );

  updateTotalFeesIn(deliveryRateUsd);
  updateMechFeesIn(mechId, deliveryRateUsd, deliveryRateCelo.toBigDecimal());
  updateMechModelIn(mechId, MODEL, deliveryRateUsd, deliveryRateCelo.toBigDecimal());
  updateDailyTotalsIn(deliveryRateUsd, event.block.timestamp);
  updateMechDailyIn(mechId, deliveryRateUsd, deliveryRateCelo.toBigDecimal(), event.block.timestamp);

  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForAccrued(
      mech,
      deliveryRateCelo.toBigDecimal(),
      deliveryRateUsd,
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

  const priceFeed = AggregatorV3Interface.bind(PRICE_FEED_ADDRESS);
  const latestRoundData = priceFeed.try_latestRoundData();

  if (latestRoundData.reverted) {
    log.error("Could not get price from Chainlink for tx: {}", [event.transaction.hash.toHex()]);
    return;
  }

  const withdrawalAmountUsd = convertCeloNativeWeiToUsd(
    withdrawalAmountWei,
    latestRoundData.value.value1
  );

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
