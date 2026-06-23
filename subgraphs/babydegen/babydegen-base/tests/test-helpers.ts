import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"

// Test addresses
export const OPERATOR_SAFE = Address.fromString(
  "0x0000000000000000000000000000000000000001"
)
export const AGENT_INSTANCE = Address.fromString(
  "0x0000000000000000000000000000000000000002"
)
export const SERVICE_SAFE = Address.fromString(
  "0x0000000000000000000000000000000000000003"
)
// Default contract address used by newMockEvent()
export const CONTRACT_ADDRESS = Address.fromString(
  "0xa16081f360e3847006db660bae1c6d1b2e17ec2a"
)

// Chainlink ETH/USD feed address (Base) — must match constants.ETH_USD_FEED
export const ETH_USD_FEED = Address.fromString(
  "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"
)

// Service IDs — indexing is PINNED to the Basius service (115).
export const SERVICE_ID = BigInt.fromI32(115)
export const NON_BASIUS_SERVICE_ID = BigInt.fromI32(100) // any non-pinned service id

// Agent IDs (no longer used for filtering; kept to prove agent id is ignored)
export const OPTIMUS_AGENT_ID = BigInt.fromI32(9)      // Basius canonical agent id
export const NON_OPTIMUS_AGENT_ID = BigInt.fromI32(99)

// Block / timestamp values
export const BLOCK_NUMBER = BigInt.fromI32(136600000)
export const BLOCK_TIMESTAMP = BigInt.fromI32(1700000000)
export const TX_HASH = Bytes.fromHexString(
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
)

// ETH price in 8-decimal Chainlink format ($2000.00)
export const ETH_PRICE_RAW = BigInt.fromI64(200000000000) // 2000 * 1e8
