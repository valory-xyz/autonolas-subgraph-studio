import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts';

export namespace TestAddresses {
  export const ZERO = Address.fromString(
    '0x0000000000000000000000000000000000000000'
  );
  // Gnosis pool (BPT) address
  export const POOL = Address.fromString(
    '0x79C872Ed3Acb3fc5770dd8a0cD9Cd5dB3B3Ac985'
  );
  // Balancer V2 Vault
  export const VAULT = Address.fromString(
    '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
  );
  export const USER_1 = Address.fromString(
    '0x0000000000000000000000000000000000000001'
  );
  export const USER_2 = Address.fromString(
    '0x0000000000000000000000000000000000000002'
  );
  // Token addresses for the pool
  export const TOKEN_OLAS = Address.fromString(
    '0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f'
  );
  export const TOKEN_WXDAI = Address.fromString(
    '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d'
  );
}

export namespace TestValues {
  // 1000 BPT (18 decimals)
  export const BPT_AMOUNT = BigInt.fromString('1000000000000000000000');
  // 500 BPT
  export const BPT_AMOUNT_SMALL = BigInt.fromString('500000000000000000000');
  // OLAS reserves: 500,000 OLAS
  export const RESERVE_OLAS = BigInt.fromString('500000000000000000000000');
  // WXDAI reserves: 100,000 WXDAI
  export const RESERVE_WXDAI = BigInt.fromString('100000000000000000000000');
  // Timestamp
  export const TIMESTAMP = BigInt.fromI32(1700000000);
  export const BLOCK = BigInt.fromI32(30000000);
}

// Synthetic pool ID for testing (first 20 bytes = pool address, rest is test data).
// The real Gnosis pool ID is 0x79c872ed3acb3fc5770dd8a0cd9cd5db3b3ac985000200000000000000000067
export const POOL_ID = Bytes.fromHexString(
  '0x79c872ed3acb3fc5770dd8a0cd9cd5db3b3ac98500020000000000000000001a'
);
