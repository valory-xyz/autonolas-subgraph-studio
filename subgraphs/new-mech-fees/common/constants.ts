import { BigDecimal } from "@graphprotocol/graph-ts";

// Ratios / Decimals used by new-mech-fees utils
// Gnosis uses xDAI (18 decimals)
export const TOKEN_RATIO_GNOSIS = BigDecimal.fromString("990000000000000000000000000000");
export const XDAI_TOKEN_DECIMALS_GNOSIS = 18;

// Base uses USDC (6 decimals)
export const TOKEN_RATIO_BASE = BigDecimal.fromString("990000000000000000");
export const USDC_TOKEN_DECIMALS_BASE = 6;

// Polygon NVM config (same as Base - 6 decimals USDC)
export const TOKEN_RATIO_POLYGON = BigDecimal.fromString("990000000000000000");
export const USDC_TOKEN_DECIMALS_POLYGON = 6;

// Optimism NVM config (same as Base - 6 decimals USDC)
export const TOKEN_RATIO_OPTIMISM = BigDecimal.fromString("990000000000000000");
export const USDC_TOKEN_DECIMALS_OPTIMISM = 6;

export const CHAINLINK_PRICE_FEED_DECIMALS = 8;
export const ETH_DECIMALS = 18;
export const POL_DECIMALS = 18; 