import { BigInt } from "@graphprotocol/graph-ts"
import {
  MechBalanceAdjusted,
  Withdraw
} from "../../common/generated/BalanceTrackerNvmSubscriptionToken/BalanceTrackerNvmSubscriptionToken"
import { Mech } from "../../common/generated/schema"
import {
  TOKEN_RATIO_POLYGON,
  USDC_TOKEN_DECIMALS_POLYGON,
  ETH_DECIMALS
} from "../../common/constants"
import { getBurnAddressMechFees } from "../../../../shared/constants"
import {
  updateTotalFeesIn,
  updateTotalFeesOut,
  convertBaseUsdcToUsd,
  calculatePolygonNvmFeesIn,
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
} from "../../common/utils";

const BURN_ADDRESS = getBurnAddressMechFees();
const MODEL = "nvm";

export function handleMechBalanceAdjustedForNvm(event: MechBalanceAdjusted): void {
  const deliveryRateCredits = event.params.deliveryRate;
  const mechId = event.params.mech.toHex();

  // Convert credits to USD using the Polygon formula
  const deliveryRateUsd = calculatePolygonNvmFeesIn(deliveryRateCredits);

  // Update global and mech-specific totals
  updateTotalFeesIn(deliveryRateUsd);
  // Store credits as raw value (not converted to USDC)
  updateMechFeesIn(mechId, deliveryRateUsd, deliveryRateCredits.toBigDecimal());
  updateMechModelIn(mechId, MODEL, deliveryRateUsd, deliveryRateCredits.toBigDecimal());
  updateDailyTotalsIn(deliveryRateUsd, event.block.timestamp);
  updateMechDailyIn(mechId, deliveryRateUsd, deliveryRateCredits.toBigDecimal(), event.block.timestamp);

  // Create the transaction record
  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForAccrued(
      mech,
      deliveryRateCredits.toBigDecimal(), // Store credits as raw amount
      deliveryRateUsd,
      event,
      event.params.deliveryRate,
      event.params.balance,
      event.params.rateDiff,
      MODEL
    );
  }
}

export function handleWithdrawForNvm(event: Withdraw): void {
  const recipientAddress = event.params.account;
  const withdrawalAmountUsdc = event.params.amount;
  const mechId = recipientAddress.toHex();

  if (recipientAddress.equals(BURN_ADDRESS)) {
    return;
  }

  const withdrawalAmountUsd = convertBaseUsdcToUsd(withdrawalAmountUsdc);

  // Convert USDC back to credits for raw storage
  // Formula: credits = (usdc_amount × 1e18 × 1e6) ÷ TOKEN_RATIO_POLYGON
  const ethDivisor = BigInt.fromI32(10).pow(ETH_DECIMALS as u8).toBigDecimal();
  const tokenDivisor = BigInt.fromI32(10).pow(USDC_TOKEN_DECIMALS_POLYGON as u8).toBigDecimal();
  const withdrawalCredits = withdrawalAmountUsdc.toBigDecimal()
    .times(ethDivisor)
    .times(tokenDivisor)
    .div(TOKEN_RATIO_POLYGON);

  updateTotalFeesOut(withdrawalAmountUsd);
  // Store credits as raw value (converted from USDC)
  updateMechFeesOut(mechId, withdrawalAmountUsd, withdrawalCredits);
  updateMechModelOut(mechId, MODEL, withdrawalAmountUsd, withdrawalCredits);
  updateDailyTotalsOut(withdrawalAmountUsd, event.block.timestamp);
  updateMechDailyOut(mechId, withdrawalAmountUsd, withdrawalCredits, event.block.timestamp);

  // Create MechTransaction for the collected fees
  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForCollected(
      mech,
      withdrawalCredits, // Store credits as raw amount
      withdrawalAmountUsd,
      event,
      MODEL
    );
  }
}
