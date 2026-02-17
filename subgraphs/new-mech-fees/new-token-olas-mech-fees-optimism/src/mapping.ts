import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import {
  MechBalanceAdjusted,
  Withdraw
} from "../../common/generated/BalanceTrackerFixedPriceToken/BalanceTrackerFixedPriceToken"
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
  updateMechModelOut,
  convertOptimismNativeWeiToUsd
} from "../../common/utils"
import { calculateOlasInUsd } from "../../common/token-utils"
import { ETH_DECIMALS } from "../../common/constants"
import { BalancerV2WeightedPool } from "../../common/generated/BalanceTrackerFixedPriceToken/BalancerV2WeightedPool";
import { AggregatorV3Interface } from "../../common/generated/BalanceTrackerFixedPriceToken/AggregatorV3Interface";
import { getBalancerVaultAddress, getOlasStablePoolAddress, getOlasTokenAddress, getStableTokenAddress, getBurnAddressMechFees, CHAINLINK_PRICE_FEED_ADDRESS_OPTIMISM_ETH_USD } from "../../../../shared/constants";

const BURN_ADDRESS = getBurnAddressMechFees();
const VAULT_ADDRESS = getBalancerVaultAddress();
const POOL_ADDRESS = getOlasStablePoolAddress();
const OLAS_ADDRESS = getOlasTokenAddress();
const STABLE_ADDRESS = getStableTokenAddress(); // WETH on Optimism
const PRICE_FEED_ADDRESS = Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_OPTIMISM_ETH_USD);
const MODEL = "token-olas";

function getPoolIdSafe(poolAddress: Address): Bytes {
  const pool = BalancerV2WeightedPool.bind(poolAddress);
  const poolIdResult = pool.try_getPoolId();

  if (poolIdResult.reverted) {
    log.warning("Could not get pool ID for pool {}, using placeholder", [poolAddress.toHexString()]);
    return Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");
  }

  return poolIdResult.value;
}

export function handleMechBalanceAdjustedForTokenOlas(event: MechBalanceAdjusted): void {
  const deliveryRateOlas = event.params.deliveryRate;
  const mechId = event.params.mech.toHex();

  const poolId = getPoolIdSafe(POOL_ADDRESS);

  // Step 1: Calculate OLAS value in WETH terms (WETH has 18 decimals)
  const deliveryRateInEth = calculateOlasInUsd(
    VAULT_ADDRESS,
    poolId,
    OLAS_ADDRESS,
    STABLE_ADDRESS,
    18,
    deliveryRateOlas
  );

  // Step 2: Get ETH/USD price from Chainlink
  const priceFeed = AggregatorV3Interface.bind(PRICE_FEED_ADDRESS);
  const latestRoundData = priceFeed.try_latestRoundData();

  if (latestRoundData.reverted) {
    log.error("Could not get ETH price from Chainlink for tx: {}", [event.transaction.hash.toHex()]);
    return;
  }

  // Step 3: Convert WETH value to USD using Chainlink ETH/USD price feed
  const ethValueInWei = deliveryRateInEth
    .times(BigInt.fromI32(10).pow(ETH_DECIMALS as u8).toBigDecimal())
    .truncate(0).digits;
  const deliveryRateUsd = convertOptimismNativeWeiToUsd(
    BigInt.fromString(ethValueInWei.toString()),
    latestRoundData.value.value1
  );

  updateTotalFeesIn(deliveryRateUsd);
  updateMechFeesIn(mechId, deliveryRateUsd, deliveryRateOlas.toBigDecimal());
  updateMechModelIn(mechId, MODEL, deliveryRateUsd, deliveryRateOlas.toBigDecimal());
  updateDailyTotalsIn(deliveryRateUsd, event.block.timestamp);
  updateMechDailyIn(mechId, deliveryRateUsd, deliveryRateOlas.toBigDecimal(), event.block.timestamp);

  // Create MechTransaction for the accrued fees
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

  const poolId = getPoolIdSafe(POOL_ADDRESS);

  // Step 1: Calculate OLAS value in WETH terms (WETH has 18 decimals)
  const withdrawalAmountInEth = calculateOlasInUsd(
    VAULT_ADDRESS,
    poolId,
    OLAS_ADDRESS,
    STABLE_ADDRESS,
    18,
    withdrawalAmountOlas
  );

  // Step 2: Get ETH/USD price from Chainlink
  const priceFeed = AggregatorV3Interface.bind(PRICE_FEED_ADDRESS);
  const latestRoundData = priceFeed.try_latestRoundData();

  if (latestRoundData.reverted) {
    log.error("Could not get ETH price from Chainlink for tx: {}", [event.transaction.hash.toHex()]);
    return;
  }

  // Step 3: Convert WETH value to USD using Chainlink ETH/USD price feed
  const ethValueInWei = withdrawalAmountInEth
    .times(BigInt.fromI32(10).pow(ETH_DECIMALS as u8).toBigDecimal())
    .truncate(0).digits;
  const withdrawalAmountUsd = convertOptimismNativeWeiToUsd(
    BigInt.fromString(ethValueInWei.toString()),
    latestRoundData.value.value1
  );

  updateTotalFeesOut(withdrawalAmountUsd);
  updateMechFeesOut(mechId, withdrawalAmountUsd, withdrawalAmountOlas.toBigDecimal());
  updateMechModelOut(mechId, MODEL, withdrawalAmountUsd, withdrawalAmountOlas.toBigDecimal());
  updateDailyTotalsOut(withdrawalAmountUsd, event.block.timestamp);
  updateMechDailyOut(mechId, withdrawalAmountUsd, withdrawalAmountOlas.toBigDecimal(), event.block.timestamp);

  // Create MechTransaction for the collected fees
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
