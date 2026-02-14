import { Address, dataSource, log } from "@graphprotocol/graph-ts";

// Raw address constants (by network)
export const BURN_ADDRESS_MECH_FEES_GNOSIS = "0x153196110040a0c729227c603db3a6c6d91851b2";
export const BURN_ADDRESS_MECH_FEES_BASE = "0x3FD8C757dE190bcc82cF69Df3Cd9Ab15bCec1426";

export const BALANCER_VAULT_ADDRESS_GNOSIS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
export const BALANCER_VAULT_ADDRESS_BASE = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

export const OLAS_ADDRESS_GNOSIS = "0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f";
export const OLAS_ADDRESS_BASE = "0x54330d28ca3357F294334BDC454a032e7f353416";

export const WXDAI_ADDRESS_GNOSIS = "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d";
export const USDC_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const OLAS_WXDAI_POOL_ADDRESS_GNOSIS = "0x79C872Ed3Acb3fc5770dd8a0cD9Cd5dB3B3Ac985";
export const OLAS_USDC_POOL_ADDRESS_BASE = "0x5332584890D6E415a6dc910254d6430b8aaB7E69";

export const CHAINLINK_PRICE_FEED_ADDRESS_BASE_ETH_USD = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
export const CHAINLINK_PRICE_FEED_ADDRESS_MAINNET_ETH_USD = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";

// Cross-subgraph constants
export const USDC_DECIMALS = 6;

// Convenience selectors (AssemblyScript-friendly)
export function getBurnAddressMechFees(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(BURN_ADDRESS_MECH_FEES_GNOSIS);
  if (n == "base") return Address.fromString(BURN_ADDRESS_MECH_FEES_BASE);
  log.critical("Unsupported network in getBurnAddressMechFees: {}", [n]);
  return Address.zero();
}

export function getBalancerVaultAddress(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(BALANCER_VAULT_ADDRESS_GNOSIS);
  if (n == "base") return Address.fromString(BALANCER_VAULT_ADDRESS_BASE);
  log.critical("Unsupported network in getBalancerVaultAddress: {}", [n]);
  return Address.zero();
}

export function getOlasTokenAddress(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(OLAS_ADDRESS_GNOSIS);
  if (n == "base") return Address.fromString(OLAS_ADDRESS_BASE);
  log.critical("Unsupported network in getOlasTokenAddress: {}", [n]);
  return Address.zero();
}

export function getOlasStablePoolAddress(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(OLAS_WXDAI_POOL_ADDRESS_GNOSIS);
  if (n == "base") return Address.fromString(OLAS_USDC_POOL_ADDRESS_BASE);
  log.critical("Unsupported network in getOlasStablePoolAddress: {}", [n]);
  return Address.zero();
}

export function getStableTokenAddress(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(WXDAI_ADDRESS_GNOSIS);
  if (n == "base") return Address.fromString(USDC_ADDRESS_BASE);
  log.critical("Unsupported network in getStableTokenAddress: {}", [n]);
  return Address.zero();
} 