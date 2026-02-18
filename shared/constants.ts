import { Address, dataSource, log } from "@graphprotocol/graph-ts";

// Raw address constants (by network)
export const BURN_ADDRESS_MECH_FEES_GNOSIS = "0x153196110040a0c729227c603db3a6c6d91851b2";
export const BURN_ADDRESS_MECH_FEES_BASE = "0x3FD8C757dE190bcc82cF69Df3Cd9Ab15bCec1426";
export const BURN_ADDRESS_MECH_FEES_POLYGON = "0x88943F63E29cd436B62cFfE332aD54De92AdCE98";
export const BURN_ADDRESS_MECH_FEES_OPTIMISM = "0x4891f5894634DcD6d11644fe8E56756EF2681582";

export const BALANCER_VAULT_ADDRESS_GNOSIS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
export const BALANCER_VAULT_ADDRESS_BASE = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
export const BALANCER_VAULT_ADDRESS_POLYGON = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
export const BALANCER_VAULT_ADDRESS_OPTIMISM = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

export const OLAS_ADDRESS_GNOSIS = "0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f";
export const OLAS_ADDRESS_BASE = "0x54330d28ca3357F294334BDC454a032e7f353416";
export const OLAS_ADDRESS_POLYGON = "0xFEF5d947472e72Efbb2E388c730B7428406F2F95";
export const OLAS_ADDRESS_OPTIMISM = "0xFC2E6e6BCbd49ccf3A5f029c79984372DcBFE527";

export const WXDAI_ADDRESS_GNOSIS = "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d";
export const USDC_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_ADDRESS_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
export const USDC_ADDRESS_OPTIMISM = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";

export const WMATIC_ADDRESS_POLYGON = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
export const WETH_ADDRESS_OPTIMISM = "0x4200000000000000000000000000000000000006";

export const OLAS_WXDAI_POOL_ADDRESS_GNOSIS = "0x79C872Ed3Acb3fc5770dd8a0cD9Cd5dB3B3Ac985";
export const OLAS_USDC_POOL_ADDRESS_BASE = "0x5332584890D6E415a6dc910254d6430b8aaB7E69";
export const OLAS_WMATIC_POOL_ADDRESS_POLYGON = "0x62309056c759c36879Cde93693E7903bF415E4Bc";
export const OLAS_WETH_POOL_ADDRESS_OPTIMISM = "0x5BB3E58887264B667f915130fD04bbB56116C278";

export const CHAINLINK_PRICE_FEED_ADDRESS_BASE_ETH_USD = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
export const CHAINLINK_PRICE_FEED_ADDRESS_POLYGON_POL_USD = "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0";
export const CHAINLINK_PRICE_FEED_ADDRESS_OPTIMISM_ETH_USD = "0x13e3Ee699D1909E989722E753853AE30b17e08c5";

// Cross-subgraph constants
export const USDC_DECIMALS = 6;

// Convenience selectors (AssemblyScript-friendly)
export function getBurnAddressMechFees(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(BURN_ADDRESS_MECH_FEES_GNOSIS);
  if (n == "base") return Address.fromString(BURN_ADDRESS_MECH_FEES_BASE);
  if (n == "matic" || n == "polygon") return Address.fromString(BURN_ADDRESS_MECH_FEES_POLYGON);
  if (n == "optimism") return Address.fromString(BURN_ADDRESS_MECH_FEES_OPTIMISM);
  log.critical("Unsupported network in getBurnAddressMechFees: {}", [n]);
  return Address.zero();
}

export function getBalancerVaultAddress(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(BALANCER_VAULT_ADDRESS_GNOSIS);
  if (n == "base") return Address.fromString(BALANCER_VAULT_ADDRESS_BASE);
  if (n == "matic" || n == "polygon") return Address.fromString(BALANCER_VAULT_ADDRESS_POLYGON);
  if (n == "optimism") return Address.fromString(BALANCER_VAULT_ADDRESS_OPTIMISM);
  log.critical("Unsupported network in getBalancerVaultAddress: {}", [n]);
  return Address.zero();
}

export function getOlasTokenAddress(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(OLAS_ADDRESS_GNOSIS);
  if (n == "base") return Address.fromString(OLAS_ADDRESS_BASE);
  if (n == "matic" || n == "polygon") return Address.fromString(OLAS_ADDRESS_POLYGON);
  if (n == "optimism") return Address.fromString(OLAS_ADDRESS_OPTIMISM);
  log.critical("Unsupported network in getOlasTokenAddress: {}", [n]);
  return Address.zero();
}

export function getOlasStablePoolAddress(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(OLAS_WXDAI_POOL_ADDRESS_GNOSIS);
  if (n == "base") return Address.fromString(OLAS_USDC_POOL_ADDRESS_BASE);
  if (n == "matic" || n == "polygon") return Address.fromString(OLAS_WMATIC_POOL_ADDRESS_POLYGON);
  if (n == "optimism") return Address.fromString(OLAS_WETH_POOL_ADDRESS_OPTIMISM);
  log.critical("Unsupported network in getOlasStablePoolAddress: {}", [n]);
  return Address.zero();
}

export function getStableTokenAddress(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(WXDAI_ADDRESS_GNOSIS);
  if (n == "base") return Address.fromString(USDC_ADDRESS_BASE);
  if (n == "matic" || n == "polygon") return Address.fromString(WMATIC_ADDRESS_POLYGON);
  if (n == "optimism") return Address.fromString(WETH_ADDRESS_OPTIMISM);
  log.critical("Unsupported network in getStableTokenAddress: {}", [n]);
  return Address.zero();
} 