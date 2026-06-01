// Per-network constants. Mirrors the shared/constants.ts pattern of a
// dataSource.network() switch resolver.

import { Address, Bytes, dataSource, log } from "@graphprotocol/graph-ts";

// Service state strings (matches plan §5.1).
export const SERVICE_STATE_REGISTERED = "REGISTERED";
export const SERVICE_STATE_DEPLOYED = "DEPLOYED";
export const SERVICE_STATE_STAKED = "STAKED";
export const SERVICE_STATE_UNSTAKED = "UNSTAKED";
export const SERVICE_STATE_TERMINATED = "TERMINATED";

// FundsCategory string values (the schema enum surfaces in AS as strings).
export const CATEGORY_SAFE_DEPLOYED = "SAFE_DEPLOYED";
export const CATEGORY_SERVICE_BOND_DEPOSIT = "SERVICE_BOND_DEPOSIT";
export const CATEGORY_SERVICE_BOND_REFUND = "SERVICE_BOND_REFUND";
export const CATEGORY_STAKING_REWARD_CLAIM = "STAKING_REWARD_CLAIM";
export const CATEGORY_UNSTAKE_REWARD = "UNSTAKE_REWARD";
export const CATEGORY_SERVICE_EVICTED = "SERVICE_EVICTED";

// Phase 2a categories.
export const CATEGORY_SAFE_SETUP_TRANSFER = "SAFE_SETUP_TRANSFER";
export const CATEGORY_MASTER_FUNDING_IN = "MASTER_FUNDING_IN";
export const CATEGORY_MASTER_WITHDRAWAL = "MASTER_WITHDRAWAL";
export const CATEGORY_MASTER_TO_AGENT = "MASTER_TO_AGENT";
export const CATEGORY_AGENT_TO_MASTER = "AGENT_TO_MASTER";
export const CATEGORY_AGENT_TO_APP = "AGENT_TO_APP";
export const CATEGORY_APP_TO_AGENT = "APP_TO_AGENT";
export const CATEGORY_OTHER = "OTHER";

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

// SRTU address resolver (mirrors networks.json). Used by classifyTransfer
// in Phase 2a to mark Master Safe ↔ SRTU OLAS transfers as
// SERVICE_BOND_DEPOSIT / SERVICE_BOND_REFUND raw reconciliation rows.
// Gnosis + Polygon happen to share the same deployer-deterministic
// address; Optimism and Base are distinct.
const SRTU_GNOSIS = "0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8";
const SRTU_POLYGON = "0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8";
const SRTU_OPTIMISM = "0xBb7e1D6Cb6F243D6bdE81CE92a9f2aFF7Fbe7eac";
const SRTU_BASE = "0x34C895f302D0b5cf52ec0Edd3945321EB0f83dd5";

export function getSrtuAddress(network: string): Address {
  if (network == "gnosis" || network == "xdai") {
    return Address.fromString(SRTU_GNOSIS);
  }
  if (network == "matic" || network == "polygon") {
    return Address.fromString(SRTU_POLYGON);
  }
  if (network == "optimism") {
    return Address.fromString(SRTU_OPTIMISM);
  }
  if (network == "base") {
    return Address.fromString(SRTU_BASE);
  }
  log.critical("Unsupported network in getSrtuAddress: {}", [network]);
  return Address.zero();
}

// Wrapped-native resolvers (Rev. 4 — added per @Tanya-atatakai's PR #130
// review). Each chain has exactly one wrapped native asset that Pearl
// services may touch (DEX swaps, Omen settlements on Gnosis). Indexed
// as a `WrappedNative` ERC-20 Transfer data source in the manifest,
// not via the Safe template.
const WXDAI_GNOSIS = "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d";
const WPOL_POLYGON = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
const WETH_OPTIMISM = "0x4200000000000000000000000000000000000006";
const WETH_BASE = "0x4200000000000000000000000000000000000006";

export function getWrappedNativeAddress(network: string): Address {
  if (network == "gnosis" || network == "xdai") {
    return Address.fromString(WXDAI_GNOSIS);
  }
  if (network == "matic" || network == "polygon") {
    return Address.fromString(WPOL_POLYGON);
  }
  if (network == "optimism") {
    return Address.fromString(WETH_OPTIMISM);
  }
  if (network == "base") {
    return Address.fromString(WETH_BASE);
  }
  log.critical("Unsupported network in getWrappedNativeAddress: {}", [
    network,
  ]);
  return Address.zero();
}

// Token symbol/decimals for the wrapped native per chain. Used by
// getOrCreateToken when first encountering the wrapped-native address.
export function getWrappedNativeSymbol(network: string): string {
  if (network == "gnosis" || network == "xdai") return "WXDAI";
  if (network == "matic" || network == "polygon") return "WPOL";
  if (network == "optimism" || network == "base") return "WETH";
  return "WNATIVE";
}

// getStablecoinSymbol — Phase 2b stablecoin metadata resolver. Returns
// the display symbol for a known per-network stablecoin (all 6 decimals),
// or null if `address` isn't a tracked stablecoin. Addresses mirror the
// `erc20Tokens` set in networks.json (sourced from the Operate app's
// frontend/config/tokens.ts). All comparisons are lowercase-hex
// (graph-ts toHexString() is lowercase).
export function getStablecoinSymbol(
  network: string,
  address: Address
): string | null {
  // Lowercase explicitly: the address literals below are lowercase, and
  // this drops a hidden dependency on graph-ts toHexString() casing.
  const a = address.toHexString().toLowerCase();
  if (network == "gnosis" || network == "xdai") {
    if (a == "0xddafbb505ad214d7b80b1f830fccc89b60fb7a83") return "USDC";
    if (a == "0x2a22f9c3b484c3629090feed35f17ff8f88f76f0") return "USDC.e";
  } else if (network == "matic" || network == "polygon") {
    if (a == "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359") return "USDC";
    if (a == "0x2791bca1f2de4661ed88a30c99a7a9449aa84174") return "USDC.e";
    if (a == "0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb") return "pUSD";
  } else if (network == "optimism") {
    if (a == "0x0b2c639c533813f4aa9d7837caf62653d097ff85") return "USDC";
    if (a == "0x7f5c764cbc14f9669b88837ca1490cca17c31607") return "USDC.e";
  } else if (network == "base") {
    if (a == "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") return "USDC";
  }
  return null;
}

// isAllowedImplementation — the Olas staking ecosystem allows multiple
// StakingProxy implementations but pearl-transactions only indexes
// proxies whose implementation appears on this per-network allow-list.
// Sourced from `subgraphs/staking/src/utils.ts` (the staking subgraph's
// canonical allow-list). Phase 1b includes only the 4 v1 networks; the
// staking subgraph carries arbitrum / celo / mainnet entries that
// aren't in this subgraph's network set.
export function isAllowedImplementation(implementation: Bytes): boolean {
  const network = dataSource.network();
  let allowed: Bytes[] = [];

  if (network == "gnosis" || network == "xdai") {
    allowed = [
      Bytes.fromHexString("0xEa00be6690a871827fAfD705440D20dd75e67AB1"),
    ];
  } else if (network == "matic" || network == "polygon") {
    allowed = [
      Bytes.fromHexString("0x4aba1Cf7a39a51D75cBa789f5f21cf4882162519"),
    ];
  } else if (network == "optimism") {
    allowed = [
      Bytes.fromHexString("0x63C2c53c09dE534Dd3bc0b7771bf976070936bAC"),
    ];
  } else if (network == "base") {
    allowed = [
      Bytes.fromHexString("0xEB5638eefE289691EcE01943f768EDBF96258a80"),
    ];
  }

  for (let i = 0; i < allowed.length; i++) {
    if (implementation.equals(allowed[i])) {
      return true;
    }
  }
  return false;
}
