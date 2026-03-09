import { Address, BigDecimal, BigInt, Bytes, dataSource, log } from "@graphprotocol/graph-ts"
import {
  MechBalanceAdjusted,
  Withdraw
} from "../generated/BalanceTrackerFixedPriceTokenOLAS/BalanceTrackerFixedPriceToken"
import { Mech } from "../generated/schema"
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
  convertNativeWeiToUsd
} from "./utils"
import { calculateOlasInUsd } from "./token-utils"
import { ETH_DECIMALS } from "./constants"
import { BalancerV2WeightedPool } from "../generated/BalanceTrackerFixedPriceTokenOLAS/BalancerV2WeightedPool"
import { AggregatorV3Interface } from "../generated/BalanceTrackerFixedPriceTokenOLAS/AggregatorV3Interface"
import {
  getBalancerVaultAddress,
  getOlasStablePoolAddress,
  getOlasTokenAddress,
  getStableTokenAddress,
  getBurnAddressMechFees,
  CHAINLINK_PRICE_FEED_ADDRESS_POLYGON_POL_USD,
  CHAINLINK_PRICE_FEED_ADDRESS_OPTIMISM_ETH_USD,
  CHAINLINK_PRICE_FEED_ADDRESS_ARBITRUM_ETH_USD
} from "../../../shared/constants"

const BURN_ADDRESS = getBurnAddressMechFees();
const VAULT_ADDRESS = getBalancerVaultAddress();
const POOL_ADDRESS = getOlasStablePoolAddress();
const OLAS_ADDRESS = getOlasTokenAddress();
const STABLE_ADDRESS = getStableTokenAddress();
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

function getStablecoinDecimals(): i32 {
  const n = dataSource.network();
  if (n == "base") return 6;
  return 18; // Gnosis (WXDAI), Polygon (WMATIC), Optimism (WETH), Arbitrum (WETH)
}

function needsChainlinkConversion(): boolean {
  const n = dataSource.network();
  return n == "matic" || n == "optimism" || n == "arbitrum-one";
}

function getChainlinkPriceFeedAddress(): Address {
  const n = dataSource.network();
  if (n == "matic") return Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_POLYGON_POL_USD);
  if (n == "optimism") return Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_OPTIMISM_ETH_USD);
  if (n == "arbitrum-one") return Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_ARBITRUM_ETH_USD);
  return Address.zero();
}

function calculateOlasToUsd(olasAmount: BigInt): BigDecimal {
  const n = dataSource.network();

  // No OLAS pricing pool available on Celo yet - USD will be 0
  if (n == "celo") {
    return BigDecimal.fromString("0");
  }

  const poolId = getPoolIdSafe(POOL_ADDRESS);
  const stablecoinDecimals = getStablecoinDecimals();

  const poolValue = calculateOlasInUsd(
    VAULT_ADDRESS,
    poolId,
    OLAS_ADDRESS,
    STABLE_ADDRESS,
    stablecoinDecimals,
    olasAmount
  );

  if (!needsChainlinkConversion()) {
    return poolValue;
  }

  // For Polygon/Optimism: pool gives intermediate native token value, convert via Chainlink
  const priceFeed = AggregatorV3Interface.bind(getChainlinkPriceFeedAddress());
  const latestRoundData = priceFeed.try_latestRoundData();

  if (latestRoundData.reverted) {
    log.error("Could not get native token price from Chainlink", []);
    return BigDecimal.fromString("0");
  }

  const nativeValueInWei = poolValue
    .times(BigInt.fromI32(10).pow(ETH_DECIMALS as u8).toBigDecimal())
    .truncate(0).digits;
  return convertNativeWeiToUsd(
    BigInt.fromString(nativeValueInWei.toString()),
    latestRoundData.value.value1
  );
}

export function handleMechBalanceAdjustedForTokenOlas(event: MechBalanceAdjusted): void {
  const deliveryRateOlas = event.params.deliveryRate;
  const mechId = event.params.mech.toHex();

  const deliveryRateUsd = calculateOlasToUsd(deliveryRateOlas);

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

  const withdrawalAmountUsd = calculateOlasToUsd(withdrawalAmountOlas);

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
