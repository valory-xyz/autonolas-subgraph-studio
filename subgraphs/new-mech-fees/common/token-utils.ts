import { Address, BigDecimal, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import { BalancerV2Vault } from "./generated/BalanceTrackerFixedPriceTokenOLAS/BalancerV2Vault";

function getPoolTokenBalances(
  vault: BalancerV2Vault,
  poolId: Bytes,
  olasAddress: Address,
  stablecoinAddress: Address
): Array<BigInt> {
  const poolTokensResult = vault.try_getPoolTokens(poolId);
  if (poolTokensResult.reverted) {
    log.error("Could not get pool tokens for pool {}", [poolId.toHexString()]);
    return [BigInt.zero(), BigInt.zero()];
  }

  const tokens = poolTokensResult.value.getTokens();
  const balances = poolTokensResult.value.getBalances();

  let olasBalance = BigInt.zero();
  let stablecoinBalance = BigInt.zero();

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].equals(olasAddress)) {
      olasBalance = balances[i];
    } else if (tokens[i].equals(stablecoinAddress)) {
      stablecoinBalance = balances[i];
    }
  }

  return [olasBalance, stablecoinBalance];
}

function calculateOlasPriceFromPool(
  olasAmount: BigInt,
  olasBalance: BigInt,
  stablecoinBalance: BigInt,
  stablecoinDecimals: i32
): BigDecimal {
  const olasDecimalsBigInt = BigInt.fromI32(10).pow(18);
  const stablecoinDecimalsBigInt = BigInt.fromI32(10).pow(stablecoinDecimals as u8);

  const olasAmountDecimal = olasAmount.toBigDecimal().div(olasDecimalsBigInt.toBigDecimal());
  const olasBalanceDecimal = olasBalance.toBigDecimal().div(olasDecimalsBigInt.toBigDecimal());
  const stablecoinBalanceDecimal = stablecoinBalance
    .toBigDecimal()
    .div(stablecoinDecimalsBigInt.toBigDecimal());

  const pricePerOlas = stablecoinBalanceDecimal.div(olasBalanceDecimal);
  return olasAmountDecimal.times(pricePerOlas);
}

export function calculateOlasInUsd(
  vaultAddress: Address,
  poolId: Bytes,
  olasAddress: Address,
  stablecoinAddress: Address,
  stablecoinDecimals: i32,
  olasAmount: BigInt
): BigDecimal {
  if (
    poolId.equals(
      Bytes.fromHexString(
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      )
    )
  ) {
    log.warning("Zero pool ID provided for OLAS price calculation", []);
    return BigDecimal.fromString("0");
  }

  const vault = BalancerV2Vault.bind(vaultAddress);
  const balances = getPoolTokenBalances(
    vault,
    poolId,
    olasAddress,
    stablecoinAddress
  );
  const olasBalance = balances[0];
  const stablecoinBalance = balances[1];

  if (olasBalance.isZero() || stablecoinBalance.isZero()) {
    log.warning("Invalid pool balances for pool {}", [poolId.toHexString()]);
    return BigDecimal.fromString("0");
  }

  return calculateOlasPriceFromPool(
    olasAmount,
    olasBalance,
    stablecoinBalance,
    stablecoinDecimals
  );
} 