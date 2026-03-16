import { newMockEvent } from 'matchstick-as/assembly/index';
import { ethereum, Address, BigInt } from '@graphprotocol/graph-ts';
import { Transfer } from '../generated/BalancerPool/BalancerV2WeightedPool';

export function createBPTTransferEvent(
  from: Address,
  to: Address,
  value: BigInt,
  poolAddress: Address,
  logIndex: i32 = 0
): Transfer {
  let event = changetype<Transfer>(newMockEvent());
  event.address = poolAddress;
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
