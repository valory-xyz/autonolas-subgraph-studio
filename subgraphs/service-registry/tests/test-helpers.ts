import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"

// Default contract address used by newMockEvent()
export const CONTRACT_ADDRESS = Address.fromString(
  "0xa16081f360e3847006db660bae1c6d1b2e17ec2a"
)

export const CREATOR_ADDRESS = Address.fromString(
  "0x0000000000000000000000000000000000000001"
)

export const OPERATOR_ADDRESS = Address.fromString(
  "0x0000000000000000000000000000000000000002"
)

export const AGENT_INSTANCE_ADDRESS = Address.fromString(
  "0x0000000000000000000000000000000000000003"
)

export const MULTISIG_ADDRESS = Address.fromString(
  "0x0000000000000000000000000000000000000099"
)

export const SERVICE_ID = BigInt.fromI32(1)
export const AGENT_ID = BigInt.fromI32(40)
export const TIMESTAMP = BigInt.fromI32(1700000000)
export const CONFIG_HASH = Bytes.fromHexString(
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
)
