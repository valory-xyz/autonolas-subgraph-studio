import { BigDecimal, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { Global, MechTransaction, Mech, MechDaily, DailyTotals, MechModel } from "./generated/schema";
import {
  TOKEN_RATIO_GNOSIS,
  XDAI_TOKEN_DECIMALS_GNOSIS,
  TOKEN_RATIO_BASE,
  USDC_TOKEN_DECIMALS_BASE,
  TOKEN_RATIO_POLYGON,
  USDC_TOKEN_DECIMALS_POLYGON,
  TOKEN_RATIO_OPTIMISM,
  USDC_TOKEN_DECIMALS_OPTIMISM,
  CHAINLINK_PRICE_FEED_DECIMALS,
  ETH_DECIMALS,
} from "./constants";
import { USDC_DECIMALS } from "../../../shared/constants";

const GLOBAL_ID = "";
const FEE_IN = "FEE_IN";
const FEE_OUT = "FEE_OUT";

export function getOrInitialiseGlobal(): Global {
  let global = Global.load(GLOBAL_ID);
  if (global == null) {
    global = new Global(GLOBAL_ID);
    global.totalFeesInUSD = BigDecimal.fromString("0");
    global.totalFeesOutUSD = BigDecimal.fromString("0");
  }
  return global;
}

// ---------------- Per-model helpers ----------------
function mechModelId(mechId: string, model: string): string {
  return mechId + "-" + model;
}

function getOrInitializeMechModel(mechId: string, model: string): MechModel {
  const id = mechModelId(mechId, model);
  let mm = MechModel.load(id);
  if (mm == null) {
    mm = new MechModel(id);
    mm.mech = mechId;
    mm.model = model;
    mm.totalFeesInUSD = BigDecimal.fromString("0");
    mm.totalFeesOutUSD = BigDecimal.fromString("0");
    mm.totalFeesInRaw = BigDecimal.fromString("0");
    mm.totalFeesOutRaw = BigDecimal.fromString("0");
  }
  return mm as MechModel;
}

export function updateMechModelIn(
  mechId: string,
  model: string,
  amountUsd: BigDecimal,
  amountRaw: BigDecimal
): void {
  const mm = getOrInitializeMechModel(mechId, model);
  mm.totalFeesInUSD = mm.totalFeesInUSD.plus(amountUsd);
  mm.totalFeesInRaw = mm.totalFeesInRaw.plus(amountRaw);
  mm.save();
}

export function updateMechModelOut(
  mechId: string,
  model: string,
  amountUsd: BigDecimal,
  amountRaw: BigDecimal
): void {
  const mm = getOrInitializeMechModel(mechId, model);
  mm.totalFeesOutUSD = mm.totalFeesOutUSD.plus(amountUsd);
  mm.totalFeesOutRaw = mm.totalFeesOutRaw.plus(amountRaw);
  mm.save();
}

// ---------------- Transactions ----------------
export function createMechTransactionForAccrued(
  mech: Mech,
  amountRaw: BigDecimal,
  amountUSD: BigDecimal,
  event: ethereum.Event,
  deliveryRate: BigInt,
  balance: BigInt,
  rateDiff: BigInt,
  model: string
): void {
  const transaction = new MechTransaction(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  transaction.mech = mech.id;
  transaction.type = FEE_IN;
  transaction.model = model;
  transaction.amountRaw = amountRaw;
  transaction.amountUSD = amountUSD;
  transaction.timestamp = event.block.timestamp;
  transaction.blockNumber = event.block.number;
  transaction.txHash = event.transaction.hash;
  transaction.deliveryRate = deliveryRate;
  transaction.balance = balance;
  transaction.rateDiff = rateDiff;
  transaction.save();
}

export function createMechTransactionForCollected(
  mech: Mech,
  amountRaw: BigDecimal,
  amountUSD: BigDecimal,
  event: ethereum.Event,
  model: string
): void {
  const transaction = new MechTransaction(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  transaction.mech = mech.id;
  transaction.type = FEE_OUT;
  transaction.model = model;
  transaction.amountRaw = amountRaw;
  transaction.amountUSD = amountUSD;
  transaction.timestamp = event.block.timestamp;
  transaction.blockNumber = event.block.number;
  transaction.txHash = event.transaction.hash;
  transaction.save();
}

export function updateTotalFeesIn(amount: BigDecimal): void {
  const global = getOrInitialiseGlobal();
  global.totalFeesInUSD = global.totalFeesInUSD.plus(amount);
  global.save();
}

export function updateTotalFeesOut(amount: BigDecimal): void {
  const global = getOrInitialiseGlobal();
  global.totalFeesOutUSD = global.totalFeesOutUSD.plus(amount);
  global.save();
}

// For native fees on Gnosis
export function convertGnosisNativeWeiToUsd(amountInWei: BigInt): BigDecimal {
  const ethDivisor = BigInt.fromI32(10).pow(ETH_DECIMALS as u8);
  return amountInWei.toBigDecimal().div(ethDivisor.toBigDecimal());
}

// For native fees on Base
export function convertBaseNativeWeiToUsd(
  amountInWei: BigInt,
  ethPrice: BigInt
): BigDecimal {
  const priceDivisor = BigInt.fromI32(10)
    .pow(CHAINLINK_PRICE_FEED_DECIMALS as u8)
    .toBigDecimal();
  const ethDivisor = BigInt.fromI32(10)
    .pow(ETH_DECIMALS as u8)
    .toBigDecimal();

  return amountInWei
    .toBigDecimal()
    .times(ethPrice.toBigDecimal())
    .div(priceDivisor)
    .div(ethDivisor);
}

// For Polygon native (POL) fees
export function convertPolygonNativeWeiToUsd(
  amountInWei: BigInt,
  polPrice: BigInt
): BigDecimal {
  const priceDivisor = BigInt.fromI32(10)
    .pow(CHAINLINK_PRICE_FEED_DECIMALS as u8)
    .toBigDecimal();
  const polDivisor = BigInt.fromI32(10)
    .pow(ETH_DECIMALS as u8)
    .toBigDecimal();

  return amountInWei
    .toBigDecimal()
    .times(polPrice.toBigDecimal())
    .div(priceDivisor)
    .div(polDivisor);
}

// For Optimism native (ETH) fees
export function convertOptimismNativeWeiToUsd(
  amountInWei: BigInt,
  ethPrice: BigInt
): BigDecimal {
  const priceDivisor = BigInt.fromI32(10)
    .pow(CHAINLINK_PRICE_FEED_DECIMALS as u8)
    .toBigDecimal();
  const ethDivisor = BigInt.fromI32(10)
    .pow(ETH_DECIMALS as u8)
    .toBigDecimal();

  return amountInWei
    .toBigDecimal()
    .times(ethPrice.toBigDecimal())
    .div(priceDivisor)
    .div(ethDivisor);
}

// For NVM fees on Gnosis
export function calculateGnosisNvmFeesIn(deliveryRate: BigInt): BigDecimal {
  const tokenDivisor = BigInt.fromI32(10)
    .pow(XDAI_TOKEN_DECIMALS_GNOSIS as u8)
    .toBigDecimal();
  const ethDivisor = BigInt.fromI32(10).pow(18).toBigDecimal();

  return deliveryRate
    .toBigDecimal()
    .times(TOKEN_RATIO_GNOSIS)
    .div(ethDivisor)
    .div(tokenDivisor);
}

// For NVM fees on Base
export function calculateBaseNvmFeesIn(deliveryRate: BigInt): BigDecimal {
  const tokenDivisor = BigInt.fromI32(10)
    .pow(USDC_TOKEN_DECIMALS_BASE as u8)
    .toBigDecimal();
  const ethDivisor = BigInt.fromI32(10).pow(18).toBigDecimal();

  return deliveryRate
    .toBigDecimal()
    .times(TOKEN_RATIO_BASE)
    .div(ethDivisor)
    .div(tokenDivisor);
}

// For NVM fees on Polygon (same formula as Base)
export function calculatePolygonNvmFeesIn(deliveryRate: BigInt): BigDecimal {
  const tokenDivisor = BigInt.fromI32(10)
    .pow(USDC_TOKEN_DECIMALS_POLYGON as u8)
    .toBigDecimal();
  const ethDivisor = BigInt.fromI32(10).pow(18).toBigDecimal();

  return deliveryRate
    .toBigDecimal()
    .times(TOKEN_RATIO_POLYGON)
    .div(ethDivisor)
    .div(tokenDivisor);
}

// For NVM fees on Optimism (same formula as Base)
export function calculateOptimismNvmFeesIn(deliveryRate: BigInt): BigDecimal {
  const tokenDivisor = BigInt.fromI32(10)
    .pow(USDC_TOKEN_DECIMALS_OPTIMISM as u8)
    .toBigDecimal();
  const ethDivisor = BigInt.fromI32(10).pow(18).toBigDecimal();

  return deliveryRate
    .toBigDecimal()
    .times(TOKEN_RATIO_OPTIMISM)
    .div(ethDivisor)
    .div(tokenDivisor);
}

// For NVM fees on Base converted to USD
export function calculateBaseNvmFeesInUsd(
  deliveryRate: BigInt,
  ethPrice: BigInt
): BigDecimal {
  const feeInEth = calculateBaseNvmFeesIn(deliveryRate);
  const priceDivisor = BigInt.fromI32(10)
    .pow(CHAINLINK_PRICE_FEED_DECIMALS as u8)
    .toBigDecimal();
  return feeInEth.times(ethPrice.toBigDecimal()).div(priceDivisor);
}

// For USDC withdrawals on Base (assumes 1 USDC = 1 USD)
export function convertBaseUsdcToUsd(amountInUsdc: BigInt): BigDecimal {
  const usdcDivisor = BigInt.fromI32(10).pow(USDC_DECIMALS as u8).toBigDecimal();
  return amountInUsdc.toBigDecimal().div(usdcDivisor);
}

// Helper function to get or initialize a mech entity
export function getOrInitializeMech(mechId: string): Mech {
  let mech = Mech.load(mechId);
  if (mech == null) {
    mech = new Mech(mechId);
    mech.totalFeesInUSD = BigDecimal.fromString("0");
    mech.totalFeesOutUSD = BigDecimal.fromString("0");
    mech.totalFeesInRaw = BigDecimal.fromString("0");
    mech.totalFeesOutRaw = BigDecimal.fromString("0");
  }
  return mech;
}

// Helper function to update mech fees in
export function updateMechFeesIn(
  mechId: string,
  amountUsd: BigDecimal,
  amountRaw: BigDecimal
): void {
  const mech = getOrInitializeMech(mechId);
  mech.totalFeesInUSD = mech.totalFeesInUSD.plus(amountUsd);
  mech.totalFeesInRaw = mech.totalFeesInRaw.plus(amountRaw);
  mech.save();
}

// Helper function to update mech fees out
export function updateMechFeesOut(
  mechId: string,
  amountUsd: BigDecimal,
  amountRaw: BigDecimal
): void {
  const mech = getOrInitializeMech(mechId);
  mech.totalFeesOutUSD = mech.totalFeesOutUSD.plus(amountUsd);
  mech.totalFeesOutRaw = mech.totalFeesOutRaw.plus(amountRaw);
  mech.save();
}

// ---------------- Daily aggregation helpers ----------------
function dayStart(timestamp: BigInt): i32 {
  return (timestamp.toI32() / 86400) * 86400;
}

function dayId(timestamp: BigInt): string {
  return dayStart(timestamp).toString();
}

function getOrInitDailyTotals(timestamp: BigInt): DailyTotals {
  const id = dayId(timestamp);
  let d = DailyTotals.load(id);
  if (d == null) {
    d = new DailyTotals(id);
    d.date = dayStart(timestamp);
    d.totalFeesInUSD = BigDecimal.fromString("0");
    d.totalFeesOutUSD = BigDecimal.fromString("0");
  }
  return d as DailyTotals;
}

function getOrInitMechDaily(mechId: string, timestamp: BigInt): MechDaily {
  const id = mechId + "-" + dayId(timestamp);
  let md = MechDaily.load(id);
  if (md == null) {
    md = new MechDaily(id);
    md.mech = mechId;
    md.date = dayStart(timestamp);
    md.feesInUSD = BigDecimal.fromString("0");
    md.feesOutUSD = BigDecimal.fromString("0");
    md.feesInRaw = BigDecimal.fromString("0");
    md.feesOutRaw = BigDecimal.fromString("0");
  }
  return md as MechDaily;
}

export function updateDailyTotalsIn(
  amountUsd: BigDecimal,
  timestamp: BigInt
): void {
  if (amountUsd.le(BigDecimal.fromString("0"))) return;
  const d = getOrInitDailyTotals(timestamp);
  d.totalFeesInUSD = d.totalFeesInUSD.plus(amountUsd);
  d.save();
}

export function updateDailyTotalsOut(
  amountUsd: BigDecimal,
  timestamp: BigInt
): void {
  if (amountUsd.le(BigDecimal.fromString("0"))) return;
  const d = getOrInitDailyTotals(timestamp);
  d.totalFeesOutUSD = d.totalFeesOutUSD.plus(amountUsd);
  d.save();
}

export function updateMechDailyIn(
  mechId: string,
  amountUsd: BigDecimal,
  amountRaw: BigDecimal,
  timestamp: BigInt
): void {
  if (
    amountUsd.le(BigDecimal.fromString("0")) &&
    amountRaw.le(BigDecimal.fromString("0"))
  )
    return;
  const md = getOrInitMechDaily(mechId, timestamp);
  md.feesInUSD = md.feesInUSD.plus(amountUsd);
  md.feesInRaw = md.feesInRaw.plus(amountRaw);
  md.save();
}

export function updateMechDailyOut(
  mechId: string,
  amountUsd: BigDecimal,
  amountRaw: BigDecimal,
  timestamp: BigInt
): void {
  if (
    amountUsd.le(BigDecimal.fromString("0")) &&
    amountRaw.le(BigDecimal.fromString("0"))
  )
    return;
  const md = getOrInitMechDaily(mechId, timestamp);
  md.feesOutUSD = md.feesOutUSD.plus(amountUsd);
  md.feesOutRaw = md.feesOutRaw.plus(amountRaw);
  md.save();
} 