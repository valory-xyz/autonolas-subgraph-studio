import { Address, Bytes, dataSource, log } from "@graphprotocol/graph-ts";

// Raw address constants (by network)
export const BURN_ADDRESS_MECH_FEES_GNOSIS = "0x153196110040a0c729227c603db3a6c6d91851b2";
export const BURN_ADDRESS_MECH_FEES_BASE = "0x3FD8C757dE190bcc82cF69Df3Cd9Ab15bCec1426";

export const BALANCER_VAULT_ADDRESS_GNOSIS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
export const BALANCER_VAULT_ADDRESS_BASE = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
// Balancer V2 uses same Vault address across all chains
export const BALANCER_VAULT_ADDRESS_POLYGON = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
export const BALANCER_VAULT_ADDRESS_ARBITRUM = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
export const BALANCER_VAULT_ADDRESS_OPTIMISM = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

export const OLAS_ADDRESS_GNOSIS = "0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f";
export const OLAS_ADDRESS_BASE = "0x54330d28ca3357F294334BDC454a032e7f353416";
export const OLAS_ADDRESS_POLYGON = "0xFEF5d947472e72Efbb2E388c730B7428406F2F95";
export const OLAS_ADDRESS_ARBITRUM = "0x064F8b858c2A603e1b106A2039f5446d32dc81c1";
export const OLAS_ADDRESS_OPTIMISM = "0xFC2E6e6BCbd49ccf3A5f029c79984372DcBFE527";
export const OLAS_ADDRESS_CELO = "0xaCFfAe8e57Ec6E394Eb1b41571AFAB11c11Aab22";

export const WXDAI_ADDRESS_GNOSIS = "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d";
export const USDC_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const OLAS_WXDAI_POOL_ADDRESS_GNOSIS = "0x79C872Ed3Acb3fc5770dd8a0cD9Cd5dB3B3Ac985";
export const OLAS_USDC_POOL_ADDRESS_BASE = "0x5332584890D6E415a6dc910254d6430b8aaB7E69";

// Pool-specific identifiers: 32-byte hex strings from Balancer pool creation
// Pool migration changes these constants (see Known Risks in liquidity-l2s.md)
export const OLAS_POOL_ID_GNOSIS = "0x79c872ed3acb3fc5770dd8a0cd9cd5db3b3ac98500020000000000000000075e";
export const OLAS_POOL_ID_POLYGON = "0x9b683ca24b0e013512e2566b68704dbe9677413c0002000000000000000009c6";
export const OLAS_POOL_ID_ARBITRUM = "0x874023da94cf986d4fa00ccfc87748a2b11b00c500020000000000000000050b";
export const OLAS_POOL_ID_OPTIMISM = "0xb4f8b61ad65f0f597a09a44528e87c1d5d15a8ae000200000000000000000135";
export const OLAS_POOL_ID_BASE = "0x5332584890d6e415a6dc910254d6430b8aab7e6900020000000000000000005e";

export const CHAINLINK_PRICE_FEED_ADDRESS_BASE_ETH_USD = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
export const CHAINLINK_PRICE_FEED_ADDRESS_MAINNET_ETH_USD = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
// Celo pool pairs OLAS with native CELO (not ETH), requires CELO/USD feed
export const CHAINLINK_PRICE_FEED_ADDRESS_CELO_CELO_USD = "0x022F9dCC73C5Fb43F2b4eF2EF9ad3eDD1D853946";
export const CELO_DECIMALS = 18;

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
  if (n == "matic") return Address.fromString(BALANCER_VAULT_ADDRESS_POLYGON);
  if (n == "arbitrum-one") return Address.fromString(BALANCER_VAULT_ADDRESS_ARBITRUM);
  if (n == "optimism") return Address.fromString(BALANCER_VAULT_ADDRESS_OPTIMISM);
  log.critical("Unsupported network in getBalancerVaultAddress: {}", [n]);
  return Address.zero();
}

export function getOlasTokenAddress(): Address {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Address.fromString(OLAS_ADDRESS_GNOSIS);
  if (n == "base") return Address.fromString(OLAS_ADDRESS_BASE);
  if (n == "matic") return Address.fromString(OLAS_ADDRESS_POLYGON);
  if (n == "arbitrum-one") return Address.fromString(OLAS_ADDRESS_ARBITRUM);
  if (n == "optimism") return Address.fromString(OLAS_ADDRESS_OPTIMISM);
  if (n == "celo") return Address.fromString(OLAS_ADDRESS_CELO);
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

/**
 * Returns Balancer pool ID for OLAS pool on current network.
 * Called by handlePoolBalanceChanged to filter events by configured pool.
 */
export function getOlasPoolId(): Bytes {
  const n = dataSource.network();
  if (n == "gnosis" || n == "xdai") return Bytes.fromHexString(OLAS_POOL_ID_GNOSIS);
  if (n == "matic") return Bytes.fromHexString(OLAS_POOL_ID_POLYGON);
  if (n == "arbitrum-one") return Bytes.fromHexString(OLAS_POOL_ID_ARBITRUM);
  if (n == "optimism") return Bytes.fromHexString(OLAS_POOL_ID_OPTIMISM);
  if (n == "base") return Bytes.fromHexString(OLAS_POOL_ID_BASE);
  log.critical("Unsupported network in getOlasPoolId: {}", [n]);
  return Bytes.empty();
} 