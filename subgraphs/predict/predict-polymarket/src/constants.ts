import { BigInt } from "@graphprotocol/graph-ts";

export const ONE_DAY = BigInt.fromI32(86400);

// PayoutSource enum values — must match the GraphQL enum in schema.graphql.
export const PAYOUT_SOURCE_CONDITIONAL_TOKENS = "CONDITIONAL_TOKENS";
export const PAYOUT_SOURCE_NEG_RISK_ADAPTER = "NEG_RISK_ADAPTER";
