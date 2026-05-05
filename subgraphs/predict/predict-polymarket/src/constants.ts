import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";

export const PREDICT_AGENT_ID = 86;

export const ONE_DAY = BigInt.fromI32(86400);

// v2 migration: collateral used for ConditionalTokens positionId derivation.
// Regular markets pin positions against USDC.e; negrisk markets against the
// NegRiskAdapter wrapper. v2 exchanges keep ctfCollateral = USDC.e, so
// tokenIds for all pre-cutover markets stay valid.
export const USDC_E_ADDRESS = Address.fromString(
  "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
);
export const NEG_RISK_ADAPTER_ADDRESS = Address.fromString(
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
);

export const ZERO_BYTES32 = Bytes.fromHexString(
  "0x0000000000000000000000000000000000000000000000000000000000000000",
) as Bytes;
