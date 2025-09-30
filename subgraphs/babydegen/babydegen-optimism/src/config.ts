import { Address, Bytes } from "@graphprotocol/graph-ts"
import { Service } from "../../../../generated/schema"

// =============================================================================
// DYNAMIC SERVICE CONFIGURATION - Supports multiple services
// =============================================================================

// Token addresses (network-specific) - Keep these as they're protocol tokens, not service-specific
export const USDC_NATIVE = Address.fromString("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85") // Native USDC on Optimism
export const USDC_BRIDGED = Address.fromString("0x7F5c764cBc14f9669B88837ca1490cCa17c31607") // USDC.e (Bridged) on Optimism

// Chainlink price feeds (network-specific)
export const ETH_USD_FEED = Address.fromString("0x13e3Ee699D1909E989722E753853AE30b17e08c5")
export const USDC_USD_FEED = Address.fromString("0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3")

// Other contract addresses
export const VELO_NFT_MANAGER = Address.fromString("0x416b433906b1B72FA758e166e239c43d68dC6F29")

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
