import { Address, BigInt } from "@graphprotocol/graph-ts";

export namespace TestAddresses {
  // Contract that emits events (BalanceTrackerFixedPriceNative on Gnosis)
  export const BALANCE_TRACKER_NATIVE = Address.fromString(
    "0x21cE6799A22A3Da84B7c44a814a9c79ab1d2A50D"
  );

  // A sample mech address used as event.params.mech / event.params.account
  export const MECH_1 = Address.fromString(
    "0x0000000000000000000000000000000000000001"
  );
  export const MECH_2 = Address.fromString(
    "0x0000000000000000000000000000000000000002"
  );

  // Burn address for Gnosis mech fees — withdrawals here are skipped
  export const BURN_ADDRESS = Address.fromString(
    "0x153196110040a0c729227c603db3a6c6d91851b2"
  );

  // Zero address (used as token param in Withdraw event for native currency)
  export const ZERO = Address.fromString(
    "0x0000000000000000000000000000000000000000"
  );
}

export namespace TestValues {
  // 1 xDAI in wei (18 decimals) — should convert to $1.00 USD
  export const ONE_XDAI_WEI = BigInt.fromString("1000000000000000000");

  // 0.5 xDAI in wei
  export const HALF_XDAI_WEI = BigInt.fromString("500000000000000000");

  // 2.5 xDAI in wei
  export const TWO_POINT_FIVE_XDAI_WEI = BigInt.fromString("2500000000000000000");

  // Delivery rate (same as amount for native model)
  export const DELIVERY_RATE = ONE_XDAI_WEI;

  // Balance field in MechBalanceAdjusted
  export const BALANCE = BigInt.fromString("5000000000000000000");

  // RateDiff field in MechBalanceAdjusted
  export const RATE_DIFF = BigInt.fromString("100000000000000000");

  // Timestamp (Nov 15 2023 ~02:13 UTC)
  export const TIMESTAMP = BigInt.fromI32(1700000000);

  // Block number
  export const BLOCK = BigInt.fromI32(38700000);
}
