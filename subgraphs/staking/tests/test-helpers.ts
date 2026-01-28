import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";

/**
 * Common test addresses for consistency across tests
 */
export namespace TestAddresses {
  export const CONTRACT_1 = Address.fromString("0x0000000000000000000000000000000000000001");
  export const CONTRACT_2 = Address.fromString("0x0000000000000000000000000000000000000002");
  export const MULTISIG_1 = Address.fromString("0x0000000000000000000000000000000000000003");
  export const MULTISIG_2 = Address.fromString("0x0000000000000000000000000000000000000004");
}

/**
 * Common test bytes for consistency across tests
 */
export namespace TestBytes {
  export const TRANSACTION_HASH_1 = Bytes.fromHexString("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
  export const TRANSACTION_HASH_2 = Bytes.fromHexString("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
  export const DUMMY_HASH = Bytes.fromHexString("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
}

/**
 * Common test BigInts for consistency
 */
export namespace TestConstants {
  export const SERVICE_ID_1 = BigInt.fromI32(1);
  export const SERVICE_ID_2 = BigInt.fromI32(2);
  export const SERVICE_ID_3 = BigInt.fromI32(3);

  export const EPOCH_1 = BigInt.fromI32(1);
  export const EPOCH_2 = BigInt.fromI32(2);
  export const EPOCH_3 = BigInt.fromI32(3);
  export const EPOCH_5 = BigInt.fromI32(5);

  export const REWARD_1000 = BigInt.fromI32(1000);
  export const REWARD_500 = BigInt.fromI32(500);
  export const REWARD_250 = BigInt.fromI32(250);

  export const BLOCK_NUMBER_1000 = BigInt.fromI32(1000);
  export const BLOCK_NUMBER_2000 = BigInt.fromI32(2000);

  export const BLOCK_TIMESTAMP_1 = BigInt.fromI32(1234567890);
  export const BLOCK_TIMESTAMP_2 = BigInt.fromI32(9999999);

  export const MIN_STAKING_DEPOSIT = BigInt.fromString("10000000000000000000");
  export const NUM_AGENT_INSTANCES = BigInt.fromI32(3);
}

/**
 * Helper to create a ServiceRewardsHistory ID
 */
export function createHistoryId(serviceId: BigInt, contractAddress: Bytes, epoch: BigInt): string {
  return serviceId.toString() + "-" + contractAddress.toHexString() + "-" + epoch.toString();
}

/**
 * Helper to create an ActiveServiceEpoch ID
 */
export function createActiveEpochId(contractAddress: Bytes, epoch: BigInt): string {
  return contractAddress.toHexString() + "-" + epoch.toString();
}
