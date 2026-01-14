import { newMockEvent } from 'matchstick-as';
import { ethereum, Address, BigInt, Bytes } from '@graphprotocol/graph-ts';
import { Sync } from '../generated/OLASETHPair/UniswapV2Pair';
import { Transfer } from '../generated/OLASETHLPToken/ERC20';

// Default pool address used in tests
export const POOL_ADDRESS = Address.fromString(
  '0x09d1d767eDF8Fa23A64C51fa559E0688E526812F'
);

// Treasury address
export const TREASURY_ADDRESS = Address.fromString(
  '0xa0DA53447C0f6C4987964d8463da7e6628B30f82'
);

// Zero address for mints
export const ZERO_ADDRESS = Address.fromString(
  '0x0000000000000000000000000000000000000000'
);

// Chainlink price feed address
export const CHAINLINK_ADDRESS = Address.fromString(
  '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
);

/**
 * Create a mock Sync event with given reserves
 */
export function createSyncEvent(reserve0: BigInt, reserve1: BigInt): Sync {
  let syncEvent = changetype<Sync>(newMockEvent());

  syncEvent.address = POOL_ADDRESS;
  syncEvent.parameters = new Array();

  syncEvent.parameters.push(
    new ethereum.EventParam(
      'reserve0',
      ethereum.Value.fromUnsignedBigInt(reserve0)
    )
  );
  syncEvent.parameters.push(
    new ethereum.EventParam(
      'reserve1',
      ethereum.Value.fromUnsignedBigInt(reserve1)
    )
  );

  return syncEvent;
}

/**
 * Create a mock Transfer event (for mints, burns, or regular transfers)
 */
export function createTransferEvent(
  from: Address,
  to: Address,
  value: BigInt
): Transfer {
  let transferEvent = changetype<Transfer>(newMockEvent());

  transferEvent.parameters = new Array();

  transferEvent.parameters.push(
    new ethereum.EventParam('from', ethereum.Value.fromAddress(from))
  );
  transferEvent.parameters.push(
    new ethereum.EventParam('to', ethereum.Value.fromAddress(to))
  );
  transferEvent.parameters.push(
    new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(value))
  );

  return transferEvent;
}

/**
 * Create a mint event (from zero address)
 */
export function createMintEvent(to: Address, value: BigInt): Transfer {
  return createTransferEvent(ZERO_ADDRESS, to, value);
}

/**
 * Create a burn event (to zero address)
 */
export function createBurnEvent(from: Address, value: BigInt): Transfer {
  return createTransferEvent(from, ZERO_ADDRESS, value);
}

/**
 * Helper to create BigInt from string (for large numbers)
 */
export function toBigInt(value: string): BigInt {
  return BigInt.fromString(value);
}

/**
 * ETH price in Chainlink format (8 decimals)
 * e.g., $1800.00 = 180000000000
 */
export function ethPriceToChainlink(usdPrice: i32): BigInt {
  return BigInt.fromI32(usdPrice).times(BigInt.fromI32(100000000));
}

/**
 * Convert ETH amount to wei
 */
export function ethToWei(ethAmount: i32): BigInt {
  return BigInt.fromI32(ethAmount).times(
    BigInt.fromI32(10).pow(18)
  );
}
