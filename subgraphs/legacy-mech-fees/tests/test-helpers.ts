import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts';

export namespace TestAddresses {
  export const MECH = Address.fromString(
    '0x1111111111111111111111111111111111111111'
  );
  export const MECH_2 = Address.fromString(
    '0x2222222222222222222222222222222222222222'
  );
  export const SENDER = Address.fromString(
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  export const FACTORY = Address.fromString(
    '0x88de734655184a09b70700ae4f72364d1ad23728'
  );
}

export namespace TestValues {
  // Agent ID
  export const AGENT_ID = BigInt.fromI32(42);
  // Mech price: 0.01 xDAI (10^16 wei)
  export const PRICE = BigInt.fromString('10000000000000000');
  // Updated price: 0.02 xDAI
  export const UPDATED_PRICE = BigInt.fromString('20000000000000000');
  // Timestamp: 2023-11-14 ~12:00 UTC
  export const TIMESTAMP = BigInt.fromI32(1700000000);
  // Block number
  export const BLOCK = BigInt.fromI32(30000000);
  // Request ID
  export const REQUEST_ID = BigInt.fromI32(1);
  // Request data
  export const REQUEST_DATA = Bytes.fromHexString('0xabcdef');
}

// Expected daily fees entity ID for TIMESTAMP (1700000000 / 86400 * 86400 = 1699920000)
export const EXPECTED_DAILY_ID = '1699920000';
