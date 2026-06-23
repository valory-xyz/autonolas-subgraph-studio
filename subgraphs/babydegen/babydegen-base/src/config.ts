import { Address, Bytes } from "@graphprotocol/graph-ts"
import { Service } from "../generated/schema"

// =============================================================================
// DYNAMIC SERVICE CONFIGURATION - Supports multiple services
// =============================================================================

// Network-specific addresses are defined once in constants.ts (Base) and
// re-exported here for the consumers that historically imported them from config.
export {
  USDC_NATIVE,
  ETH_USD_FEED,
  USDC_USD_FEED,
  VELO_NFT_MANAGER
} from "./constants"

// Service lookup functions - DYNAMIC (supports multiple services)
export function getServiceByAgent(address: Address): Service | null {
  // Dynamic service lookup - works for any registered service
  return Service.load(address)
}

export function isServiceAgent(address: Address): boolean {
  return getServiceByAgent(address) !== null
}

// Legacy function name for compatibility
export function isValidAgent(address: Address): boolean {
  return isServiceAgent(address)
}
