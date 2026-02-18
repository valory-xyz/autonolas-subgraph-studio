import { Address, BigDecimal, BigInt, Bytes, log } from "@graphprotocol/graph-ts"
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
  updateMechModelOut,
  convertPolygonNativeWeiToUsd
} from "../../common/utils"
import { calculateOlasInUsd } from "../../common/token-utils"
import { ETH_DECIMALS } from "../../common/constants"
import { BalancerV2WeightedPool } from "../../common/generated/BalanceTrackerFixedPriceTokenOLAS/BalancerV2WeightedPool";
import { AggregatorV3Interface } from "../../common/generated/BalanceTrackerFixedPriceTokenOLAS/AggregatorV3Interface";
import { getBalancerVaultAddress, getOlasStablePoolAddress, getOlasTokenAddress, getStableTokenAddress, getBurnAddressMechFees, CHAINLINK_PRICE_FEED_ADDRESS_POLYGON_POL_USD } from "../../../../shared/constants";

const BURN_ADDRESS = getBurnAddressMechFees();
const VAULT_ADDRESS = getBalancerVaultAddress();
const POOL_ADDRESS = getOlasStablePoolAddress();
const OLAS_ADDRESS = getOlasTokenAddress();
const STABLE_ADDRESS = getStableTokenAddress(); // WMATIC on Polygon
const PRICE_FEED_ADDRESS = Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_POLYGON_POL_USD);
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

  // Step 1: Calculate OLAS value in WMATIC terms (WMATIC has 18 decimals)
  const deliveryRateInMatic = calculateOlasInUsd(
    VAULT_ADDRESS,
    poolId,
    OLAS_ADDRESS,
    STABLE_ADDRESS,
    18,
    deliveryRateOlas
  );

  // Step 2: Get POL/USD price from Chainlink
  const priceFeed = AggregatorV3Interface.bind(PRICE_FEED_ADDRESS);
  const latestRoundData = priceFeed.try_latestRoundData();

  if (latestRoundData.reverted) {
    log.error("Could not get POL price from Chainlink for tx: {}", [event.transaction.hash.toHex()]);
    return;
  }

  // Step 3: Convert WMATIC value to USD using Chainlink POL/USD price feed
  const maticValueInWei = deliveryRateInMatic
    .times(BigInt.fromI32(10).pow(ETH_DECIMALS as u8).toBigDecimal())
    .truncate(0).digits;
  const deliveryRateUsd = convertPolygonNativeWeiToUsd(
    BigInt.fromString(maticValueInWei.toString()),
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

  // Step 1: Calculate OLAS value in WMATIC terms (WMATIC has 18 decimals)
  const withdrawalAmountInMatic = calculateOlasInUsd(
    VAULT_ADDRESS,
    poolId,
    OLAS_ADDRESS,
    STABLE_ADDRESS,
    18,
    withdrawalAmountOlas
  );

  // Step 2: Get POL/USD price from Chainlink
  const priceFeed = AggregatorV3Interface.bind(PRICE_FEED_ADDRESS);
  const latestRoundData = priceFeed.try_latestRoundData();

  if (latestRoundData.reverted) {
    log.error("Could not get POL price from Chainlink for tx: {}", [event.transaction.hash.toHex()]);
    return;
  }

  // Step 3: Convert WMATIC value to USD using Chainlink POL/USD price feed
  const maticValueInWei = withdrawalAmountInMatic
    .times(BigInt.fromI32(10).pow(ETH_DECIMALS as u8).toBigDecimal())
    .truncate(0).digits;
  const withdrawalAmountUsd = convertPolygonNativeWeiToUsd(
    BigInt.fromString(maticValueInWei.toString()),
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
