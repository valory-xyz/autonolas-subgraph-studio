import { Address, BigInt } from '@graphprotocol/graph-ts';

export namespace TestAddresses {
  export const ZERO = Address.fromString(
    '0x0000000000000000000000000000000000000000'
  );
  export const TREASURY = Address.fromString(
    '0xa0DA53447C0f6C4987964d8463da7e6628B30f82'
  );
  export const POOL = Address.fromString(
    '0x09D1d767eDF8Fa23A64C51fa559E0688E526812F'
  );
  export const CHAINLINK_ETH_USD = Address.fromString(
    '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
  );
  export const CHAINLINK_MATIC_USD = Address.fromString(
    '0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676'
  );
  export const CHAINLINK_SOL_USD = Address.fromString(
    '0x4ffC43a60e009B551865A93d232E33Fce9f01507'
  );
  export const USER_1 = Address.fromString(
    '0x0000000000000000000000000000000000000001'
  );
  export const USER_2 = Address.fromString(
    '0x0000000000000000000000000000000000000002'
  );

  // Bridged LP token addresses on Ethereum mainnet
  export const BRIDGED_LP_GNOSIS = Address.fromString(
    '0x27df632fd0dcf191C418c803801D521cd579F18e'
  );
  export const BRIDGED_LP_POLYGON = Address.fromString(
    '0xf9825A563222f9eFC81e369311DAdb13D68e60a4'
  );
  export const BRIDGED_LP_SOLANA = Address.fromString(
    '0x3685B8cC36B8df09ED9E81C1690100306bF23E04'
  );
  export const BRIDGED_LP_ARBITRUM = Address.fromString(
    '0x36B203Cb3086269f005a4b987772452243c0767f'
  );
  export const BRIDGED_LP_BASE = Address.fromString(
    '0x9946d6FD1210D85EC613Ca956F142D911C97a074'
  );
  export const BRIDGED_LP_BASE_WETH = Address.fromString(
    '0xad47b6ffEe3ed15fCE55eCA42AcE9736901b94A1'
  );
}

export namespace TestValues {
  // 1000 LP tokens (18 decimals)
  export const LP_AMOUNT = BigInt.fromString('1000000000000000000000');
  // 500 LP tokens
  export const LP_AMOUNT_SMALL = BigInt.fromString('500000000000000000000');
  // OLAS reserves: 1,000,000 OLAS
  export const RESERVE_OLAS = BigInt.fromString(
    '1000000000000000000000000'
  );
  // ETH reserves: 100 ETH
  export const RESERVE_ETH = BigInt.fromString('100000000000000000000');
  // ETH/USD price: $2000 (8 decimals)
  export const ETH_PRICE = BigInt.fromString('200000000000');
  // MATIC/USD price: $0.22 (8 decimals)
  export const MATIC_PRICE = BigInt.fromString('22000000');
  // SOL/USD price: $92.12 (8 decimals)
  export const SOL_PRICE = BigInt.fromString('9212000000');
  // Timestamp
  export const TIMESTAMP = BigInt.fromI32(1700000000);
  export const BLOCK = BigInt.fromI32(18000000);
}
