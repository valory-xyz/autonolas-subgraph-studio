import { BigDecimal, log } from "@graphprotocol/graph-ts"
import {
  MechBalanceAdjusted,
  Withdraw
} from "../../common/generated/BalanceTrackerFixedPriceToken/BalanceTrackerFixedPriceToken"
import { Mech } from "../../common/generated/schema"
import { getBurnAddressMechFees } from "../../../../shared/constants"
import { convertBaseUsdcToUsd } from "../../common/utils"
import {
  updateTotalFeesIn,
  updateTotalFeesOut,
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
const MODEL = "token-usdc";

export function handleMechBalanceAdjustedForTokenUSDC(event: MechBalanceAdjusted): void {
  const deliveryRateUsdc = event.params.deliveryRate;
  const mechId = event.params.mech.toHex();

  // Convert USDC to USD (1:1 with decimal adjustment)
  const deliveryRateUsd = convertBaseUsdcToUsd(deliveryRateUsdc);

  if (deliveryRateUsd.equals(BigDecimal.fromString("0"))) {
    log.warning("USDC conversion returned 0 for tx: {}", [event.transaction.hash.toHex()]);
    return;
  }

  updateTotalFeesIn(deliveryRateUsd);
  updateMechFeesIn(mechId, deliveryRateUsd, deliveryRateUsdc.toBigDecimal());
  updateMechModelIn(mechId, MODEL, deliveryRateUsd, deliveryRateUsdc.toBigDecimal());
  updateDailyTotalsIn(deliveryRateUsd, event.block.timestamp);
  updateMechDailyIn(mechId, deliveryRateUsd, deliveryRateUsdc.toBigDecimal(), event.block.timestamp);

  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForAccrued(
      mech,
      deliveryRateUsdc.toBigDecimal(),
      deliveryRateUsd,
      event,
      event.params.deliveryRate,
      event.params.balance,
      event.params.rateDiff,
      MODEL
    );
  }
}

export function handleWithdrawForTokenUSDC(event: Withdraw): void {
  const recipientAddress = event.params.account;

  if (recipientAddress.equals(BURN_ADDRESS)) {
    return;
  }

  const withdrawalAmountUsdc = event.params.amount;
  const mechId = recipientAddress.toHex();

  const withdrawalAmountUsd = convertBaseUsdcToUsd(withdrawalAmountUsdc);

  if (withdrawalAmountUsd.equals(BigDecimal.fromString("0"))) {
    log.warning("USDC conversion returned 0 for tx: {}", [event.transaction.hash.toHex()]);
    return;
  }

  updateTotalFeesOut(withdrawalAmountUsd);
  updateMechFeesOut(mechId, withdrawalAmountUsd, withdrawalAmountUsdc.toBigDecimal());
  updateMechModelOut(mechId, MODEL, withdrawalAmountUsd, withdrawalAmountUsdc.toBigDecimal());
  updateDailyTotalsOut(withdrawalAmountUsd, event.block.timestamp);
  updateMechDailyOut(mechId, withdrawalAmountUsd, withdrawalAmountUsdc.toBigDecimal(), event.block.timestamp);

  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForCollected(
      mech,
      withdrawalAmountUsdc.toBigDecimal(),
      withdrawalAmountUsd,
      event,
      MODEL
    );
  }
}
