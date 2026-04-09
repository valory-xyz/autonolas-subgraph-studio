import { newMockEvent } from 'matchstick-as/assembly/index';
import { ethereum, Address, BigInt } from '@graphprotocol/graph-ts';
import { Transfer } from '../generated/OLASETHLPToken/ERC20';
import { Sync } from '../generated/OLASETHPair/UniswapV2Pair';
import { Swap } from '../generated/OLASETHSwap/UniswapV2Pair';

export function createTransferEvent(
  from: Address,
  to: Address,
  value: BigInt,
  contractAddress: Address,
  logIndex: i32 = 0
): Transfer {
  let event = changetype<Transfer>(newMockEvent());
  event.address = contractAddress;
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = new Array();

  event.parameters.push(
    new ethereum.EventParam('from', ethereum.Value.fromAddress(from))
  );
  event.parameters.push(
    new ethereum.EventParam('to', ethereum.Value.fromAddress(to))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'value',
      ethereum.Value.fromUnsignedBigInt(value)
    )
  );

  return event;
}

export function createSyncEvent(
  reserve0: BigInt,
  reserve1: BigInt,
  contractAddress: Address,
  logIndex: i32 = 0
): Sync {
  let event = changetype<Sync>(newMockEvent());
  event.address = contractAddress;
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = new Array();

  event.parameters.push(
    new ethereum.EventParam(
      'reserve0',
      ethereum.Value.fromUnsignedBigInt(reserve0)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      'reserve1',
      ethereum.Value.fromUnsignedBigInt(reserve1)
    )
  );

  return event;
}

export function createSwapEvent(
  sender: Address,
  amount0In: BigInt,
  amount1In: BigInt,
  amount0Out: BigInt,
  amount1Out: BigInt,
  to: Address,
  contractAddress: Address,
  timestamp: BigInt = BigInt.fromI32(1700000000),
  logIndex: i32 = 0
): Swap {
  let event = changetype<Swap>(newMockEvent());
  event.address = contractAddress;
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = timestamp;
  event.parameters = new Array();

  event.parameters.push(
    new ethereum.EventParam('sender', ethereum.Value.fromAddress(sender))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'amount0In',
      ethereum.Value.fromUnsignedBigInt(amount0In)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      'amount1In',
      ethereum.Value.fromUnsignedBigInt(amount1In)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      'amount0Out',
      ethereum.Value.fromUnsignedBigInt(amount0Out)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      'amount1Out',
      ethereum.Value.fromUnsignedBigInt(amount1Out)
    )
  );
  event.parameters.push(
    new ethereum.EventParam('to', ethereum.Value.fromAddress(to))
  );

  return event;
}
