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

// Service IDs — arbitrary; Basius is identified by AGENT id, so any serviceId with
// agentId 115 is tracked. Two distinct serviceIds are used to prove multi-service tracking.
export const SERVICE_ID = BigInt.fromI32(607)
export const SERVICE_ID_2 = BigInt.fromI32(610)

// Agent IDs — filtering is by agentId. Basius = 115; anything else is ignored.
export const BASIUS_AGENT_ID = BigInt.fromI32(115)
export const NON_BASIUS_AGENT_ID = BigInt.fromI32(99)

// Block / timestamp values
export const BLOCK_NUMBER = BigInt.fromI32(136600000)
export const BLOCK_TIMESTAMP = BigInt.fromI32(1700000000)
export const TX_HASH = Bytes.fromHexString(
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
)

// ETH price in 8-decimal Chainlink format ($2000.00)
export const ETH_PRICE_RAW = BigInt.fromI64(200000000000) // 2000 * 1e8
