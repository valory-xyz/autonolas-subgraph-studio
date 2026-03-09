import { Address, BigDecimal, BigInt, log } from "@graphprotocol/graph-ts"
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
  convertEthereumNativeWeiToUsd
} from "../../common/utils"
import { ETH_DECIMALS } from "../../common/constants"
import { IUniswapV2Pair } from "../../common/generated/BalanceTrackerFixedPriceTokenOLAS/IUniswapV2Pair"
import { AggregatorV3Interface } from "../../common/generated/BalanceTrackerFixedPriceTokenOLAS/AggregatorV3Interface"
import {
  getBurnAddressMechFees,
  OLAS_WETH_UNISWAP_V2_PAIR_ETHEREUM,
  OLAS_ADDRESS_ETHEREUM,
  CHAINLINK_PRICE_FEED_ADDRESS_ETHEREUM_ETH_USD
} from "../../../../shared/constants"

const BURN_ADDRESS = getBurnAddressMechFees();
const PAIR_ADDRESS = Address.fromString(OLAS_WETH_UNISWAP_V2_PAIR_ETHEREUM);
const OLAS_ADDRESS = Address.fromString(OLAS_ADDRESS_ETHEREUM);
const PRICE_FEED_ADDRESS = Address.fromString(CHAINLINK_PRICE_FEED_ADDRESS_ETHEREUM_ETH_USD);
const MODEL = "token-olas";

function calculateOlasInWeth(olasAmount: BigInt): BigDecimal {
  const pair = IUniswapV2Pair.bind(PAIR_ADDRESS);

  const reservesResult = pair.try_getReserves();
  if (reservesResult.reverted) {
    log.warning("Could not get reserves from Uniswap V2 pair", []);
    return BigDecimal.fromString("0");
  }

  const token0Result = pair.try_token0();
  if (token0Result.reverted) {
    log.warning("Could not get token0 from Uniswap V2 pair", []);
    return BigDecimal.fromString("0");
  }

  const reserve0 = reservesResult.value.value0;
  const reserve1 = reservesResult.value.value1;
  const token0 = token0Result.value;

  let olasReserve: BigInt;
  let wethReserve: BigInt;

  if (token0.equals(OLAS_ADDRESS)) {
    olasReserve = reserve0;
    wethReserve = reserve1;
  } else {
    olasReserve = reserve1;
    wethReserve = reserve0;
  }

  if (olasReserve.isZero() || wethReserve.isZero()) {
    log.warning("Invalid reserves in Uniswap V2 pair", []);
    return BigDecimal.fromString("0");
  }

  // Both OLAS and WETH have 18 decimals, so they cancel out
  const olasDecimal = olasAmount.toBigDecimal();
  const pricePerOlas = wethReserve.toBigDecimal().div(olasReserve.toBigDecimal());
  return olasDecimal.times(pricePerOlas);
}

export function handleMechBalanceAdjustedForTokenOlas(event: MechBalanceAdjusted): void {
  const deliveryRateOlas = event.params.deliveryRate;
  const mechId = event.params.mech.toHex();

  // Step 1: Calculate OLAS value in WETH terms (raw, both 18 decimals)
  const deliveryRateInWeth = calculateOlasInWeth(deliveryRateOlas);

  // Step 2: Get ETH/USD price from Chainlink
  const priceFeed = AggregatorV3Interface.bind(PRICE_FEED_ADDRESS);
  const latestRoundData = priceFeed.try_latestRoundData();

  if (latestRoundData.reverted) {
    log.error("Could not get ETH price from Chainlink for tx: {}", [event.transaction.hash.toHex()]);
    return;
  }

  // Step 3: Convert WETH value to USD
  const wethValueInWei = deliveryRateInWeth.truncate(0).digits;
  const deliveryRateUsd = convertEthereumNativeWeiToUsd(
    BigInt.fromString(wethValueInWei.toString()),
    latestRoundData.value.value1
  );

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

  // Step 1: Calculate OLAS value in WETH terms
  const withdrawalAmountInWeth = calculateOlasInWeth(withdrawalAmountOlas);

  // Step 2: Get ETH/USD price from Chainlink
  const priceFeed = AggregatorV3Interface.bind(PRICE_FEED_ADDRESS);
  const latestRoundData = priceFeed.try_latestRoundData();

  if (latestRoundData.reverted) {
    log.error("Could not get ETH price from Chainlink for tx: {}", [event.transaction.hash.toHex()]);
    return;
  }

  // Step 3: Convert WETH value to USD
  const wethValueInWei = withdrawalAmountInWeth.truncate(0).digits;
  const withdrawalAmountUsd = convertEthereumNativeWeiToUsd(
    BigInt.fromString(wethValueInWei.toString()),
    latestRoundData.value.value1
  );

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
