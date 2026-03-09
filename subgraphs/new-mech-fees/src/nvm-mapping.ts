import { BigInt, dataSource } from "@graphprotocol/graph-ts"
import {
  MechBalanceAdjusted,
  Withdraw
} from "../generated/BalanceTrackerNvmSubscription/BalanceTrackerNvmSubscription"
import { Mech } from "../generated/schema"
import {
  TOKEN_RATIO_GNOSIS,
  XDAI_TOKEN_DECIMALS_GNOSIS,
  TOKEN_RATIO_BASE,
  USDC_TOKEN_DECIMALS_BASE,
  ETH_DECIMALS
} from "./constants"
import { getBurnAddressMechFees } from "../../../shared/constants"
import {
  updateTotalFeesIn,
  updateTotalFeesOut,
  calculateGnosisNvmFeesIn,
  calculateBaseNvmFeesIn,
  calculatePolygonNvmFeesIn,
  calculateOptimismNvmFeesIn,
  convertGnosisNativeWeiToUsd,
  convertBaseUsdcToUsd,
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
const MODEL = "nvm";

export function handleMechBalanceAdjustedForNvm(event: MechBalanceAdjusted): void {
  const deliveryRateCredits = event.params.deliveryRate;
  const mechId = event.params.mech.toHex();
  const network = dataSource.network();

  let deliveryRateUsd = calculateBaseNvmFeesIn(deliveryRateCredits);
  if (network == "xdai" || network == "gnosis") {
    deliveryRateUsd = calculateGnosisNvmFeesIn(deliveryRateCredits);
  } else if (network == "matic") {
    deliveryRateUsd = calculatePolygonNvmFeesIn(deliveryRateCredits);
  } else if (network == "optimism") {
    deliveryRateUsd = calculateOptimismNvmFeesIn(deliveryRateCredits);
  }

  updateTotalFeesIn(deliveryRateUsd);
  updateMechFeesIn(mechId, deliveryRateUsd, deliveryRateCredits.toBigDecimal());
  updateMechModelIn(mechId, MODEL, deliveryRateUsd, deliveryRateCredits.toBigDecimal());
  updateDailyTotalsIn(deliveryRateUsd, event.block.timestamp);
  updateMechDailyIn(mechId, deliveryRateUsd, deliveryRateCredits.toBigDecimal(), event.block.timestamp);

  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForAccrued(
      mech,
      deliveryRateCredits.toBigDecimal(),
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
  const withdrawalAmount = event.params.amount;
  const mechId = recipientAddress.toHex();

  if (recipientAddress.equals(BURN_ADDRESS)) {
    return;
  }

  const network = dataSource.network();
  const ethDivisor = BigInt.fromI32(10).pow(ETH_DECIMALS as u8).toBigDecimal();

  let withdrawalAmountUsd = convertBaseUsdcToUsd(withdrawalAmount);
  let withdrawalCredits = withdrawalAmount.toBigDecimal()
    .times(ethDivisor)
    .times(BigInt.fromI32(10).pow(USDC_TOKEN_DECIMALS_BASE as u8).toBigDecimal())
    .div(TOKEN_RATIO_BASE);

  if (network == "xdai" || network == "gnosis") {
    withdrawalAmountUsd = convertGnosisNativeWeiToUsd(withdrawalAmount);
    const tokenDivisor = BigInt.fromI32(10).pow(XDAI_TOKEN_DECIMALS_GNOSIS as u8).toBigDecimal();
    withdrawalCredits = withdrawalAmount.toBigDecimal()
      .times(ethDivisor)
      .times(tokenDivisor)
      .div(TOKEN_RATIO_GNOSIS);
  }

  updateTotalFeesOut(withdrawalAmountUsd);
  updateMechFeesOut(mechId, withdrawalAmountUsd, withdrawalCredits);
  updateMechModelOut(mechId, MODEL, withdrawalAmountUsd, withdrawalCredits);
  updateDailyTotalsOut(withdrawalAmountUsd, event.block.timestamp);
  updateMechDailyOut(mechId, withdrawalAmountUsd, withdrawalCredits, event.block.timestamp);

  const mech = Mech.load(mechId);
  if (mech != null) {
    createMechTransactionForCollected(
      mech,
      withdrawalCredits,
      withdrawalAmountUsd,
      event,
      MODEL
    );
  }
}
