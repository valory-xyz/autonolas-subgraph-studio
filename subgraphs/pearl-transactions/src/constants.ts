// Per-network constants. Mirrors the shared/constants.ts pattern of a
// dataSource.network() switch resolver. Phase 1a only needs OLAS for
// the SAFE_DEPLOYED row's metadata (currently null) — the resolver is
// here so later phases (raw OLAS Transfer handling) reuse it without
// touching constants.

import { Address, log } from "@graphprotocol/graph-ts";

// Service state strings (matches plan §5.1).
export const SERVICE_STATE_REGISTERED = "REGISTERED";
export const SERVICE_STATE_DEPLOYED = "DEPLOYED";
export const SERVICE_STATE_TERMINATED = "TERMINATED";
// Phase 1b will add STAKED / UNSTAKED.

// FundsCategory string values (the schema enum surfaces in AS as strings).
export const CATEGORY_SAFE_DEPLOYED = "SAFE_DEPLOYED";
export const CATEGORY_SERVICE_BOND_DEPOSIT = "SERVICE_BOND_DEPOSIT";
export const CATEGORY_SERVICE_BOND_REFUND = "SERVICE_BOND_REFUND";

// ServiceBondType string values.
export const BOND_TYPE_SECURITY_DEPOSIT = "SECURITY_DEPOSIT";
export const BOND_TYPE_AGENT_BOND = "AGENT_BOND";

// FundsSource string values.
export const SOURCE_SEMANTIC = "SEMANTIC";
export const SOURCE_RAW_TRANSFER = "RAW_TRANSFER";

// OLAS token address resolver. Used to tag the SAFE_DEPLOYED row's
// `token` field as null (no token) and later for raw-transfer
// classification in Phase 2a.
const OLAS_GNOSIS = "0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f";
const OLAS_POLYGON = "0xFEF5d947472e72Efbb2E388c730B7428406F2F95";
const OLAS_OPTIMISM = "0xFC2E6e6BCbd49ccf3A5f029c79984372DcBFE527";
const OLAS_BASE = "0x54330d28ca3357F294334BDC454a032e7f353416";

export function getOlasAddress(network: string): Address {
  if (network == "gnosis" || network == "xdai") {
    return Address.fromString(OLAS_GNOSIS);
  }
  if (network == "matic" || network == "polygon") {
    return Address.fromString(OLAS_POLYGON);
  }
  if (network == "optimism") {
    return Address.fromString(OLAS_OPTIMISM);
  }
  if (network == "base") {
    return Address.fromString(OLAS_BASE);
  }
  log.critical("Unsupported network in getOlasAddress: {}", [network]);
  return Address.zero();
}
