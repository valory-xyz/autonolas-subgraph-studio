import { Address, BigDecimal, Bytes, log } from "@graphprotocol/graph-ts"
import {
  MechBalanceAdjusted,
  Withdraw
} from "../../common/generated/BalanceTrackerFixedPriceTokenOLAS/BalanceTrackerFixedPriceToken"
import { Mech } from "../../common/generated/schema"
import {
  updateTotalFeesIn,
  updateTotalFeesOut,
  updateMechFeesIn,
  updateMechFeesOut,
  createMechTransactionForAccrued,
  createMechTransactionForCollected,
  updateDailyTotalsIn,
  updateDailyTotalsOut,
  updateMechDailyIn,
  updateMechDailyOut,
  updateMechModelIn,
  updateMechModelOut
} from "../../common/utils"
import { getBurnAddressMechFees } from "../../../../shared/constants";

const BURN_ADDRESS = getBurnAddressMechFees();
const MODEL = "token-olas";

// NOTE: No OLAS pricing pool available on Celo yet.
// OLAS amounts are tracked as raw values; USD conversions will be 0 until a pool is deployed.

export function handleMechBalanceAdjustedForTokenOlas(event: MechBalanceAdjusted): void {
  const deliveryRateOlas = event.params.deliveryRate;
  const mechId = event.params.mech.toHex();

  const deliveryRateUsd = BigDecimal.fromString("0");

  updateTotalFeesIn(deliveryRateUsd);
  updateMechFeesIn(mechId, deliveryRateUsd, deliveryRateOlas.toBigDecimal());
  updateMechModelIn(mechId, MODEL, deliveryRateUsd, deliveryRateOlas.toBigDecimal());
  updateDailyTotalsIn(deliveryRateUsd, event.block.timestamp);
  updateMechDailyIn(mechId, deliveryRateUsd, deliveryRateOlas.toBigDecimal(), event.block.timestamp);

  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForAccrued(
      mech,
      deliveryRateOlas.toBigDecimal(),
      deliveryRateUsd,
      event,
      event.params.deliveryRate,
      event.params.balance,
      event.params.rateDiff,
      MODEL
    );
  }
}

export function handleWithdrawForTokenOlas(event: Withdraw): void {
  const recipientAddress = event.params.account;
  const withdrawalAmountOlas = event.params.amount;
  const mechId = recipientAddress.toHex();

  if (recipientAddress.equals(BURN_ADDRESS)) {
    return;
  }

  const withdrawalAmountUsd = BigDecimal.fromString("0");

  updateTotalFeesOut(withdrawalAmountUsd);
  updateMechFeesOut(mechId, withdrawalAmountUsd, withdrawalAmountOlas.toBigDecimal());
  updateMechModelOut(mechId, MODEL, withdrawalAmountUsd, withdrawalAmountOlas.toBigDecimal());
  updateDailyTotalsOut(withdrawalAmountUsd, event.block.timestamp);
  updateMechDailyOut(mechId, withdrawalAmountUsd, withdrawalAmountOlas.toBigDecimal(), event.block.timestamp);

  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForCollected(
      mech,
      withdrawalAmountOlas.toBigDecimal(),
      withdrawalAmountUsd,
      event,
      MODEL
    );
  }
}
