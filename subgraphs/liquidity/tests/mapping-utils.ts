import { newMockEvent } from 'matchstick-as/assembly/index';
import { ethereum, Address, BigInt } from '@graphprotocol/graph-ts';
import { Transfer } from '../generated/OLASETHLPToken/ERC20';
import { Sync } from '../generated/OLASETHPair/UniswapV2Pair';

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
