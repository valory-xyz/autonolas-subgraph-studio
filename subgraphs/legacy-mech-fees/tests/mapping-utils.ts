import { newMockEvent } from 'matchstick-as/assembly/index';
import { ethereum, Address, BigInt, Bytes } from '@graphprotocol/graph-ts';
import { CreateMech } from '../generated/LMFactory/Factory';
import { Request } from '../generated/templates/LegacyMech/AgentMechLM';
import { PriceUpdated as PriceUpdatedLM } from '../generated/templates/LegacyMech/AgentMechLM';
import { PriceUpdated as PriceUpdatedLMM } from '../generated/templates/LegacyMechMarketPlace/AgentMechLMM';

export function createCreateMechEvent(
  mech: Address,
  agentId: BigInt,
  price: BigInt
): CreateMech {
  let event = changetype<CreateMech>(newMockEvent());
  event.parameters = new Array();

  event.parameters.push(
    new ethereum.EventParam('mech', ethereum.Value.fromAddress(mech))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'agentId',
      ethereum.Value.fromUnsignedBigInt(agentId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      'price',
      ethereum.Value.fromUnsignedBigInt(price)
    )
  );

  return event;
}

export function createRequestEvent(
  mechAddress: Address,
  sender: Address,
  requestId: BigInt,
  data: Bytes,
  timestamp: BigInt
): Request {
  let event = changetype<Request>(newMockEvent());
  event.address = mechAddress;
  event.block.timestamp = timestamp;
  event.parameters = new Array();

  event.parameters.push(
    new ethereum.EventParam('sender', ethereum.Value.fromAddress(sender))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'requestId',
      ethereum.Value.fromUnsignedBigInt(requestId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam('data', ethereum.Value.fromBytes(data))
  );

  return event;
}

export function createPriceUpdatedLMEvent(
  mechAddress: Address,
  price: BigInt
): PriceUpdatedLM {
  let event = changetype<PriceUpdatedLM>(newMockEvent());
  event.address = mechAddress;
  event.parameters = new Array();

  event.parameters.push(
    new ethereum.EventParam(
      'price',
      ethereum.Value.fromUnsignedBigInt(price)
    )
  );

  return event;
}

export function createPriceUpdatedLMMEvent(
  mechAddress: Address,
  price: BigInt
): PriceUpdatedLMM {
  let event = changetype<PriceUpdatedLMM>(newMockEvent());
  event.address = mechAddress;
  event.parameters = new Array();

  event.parameters.push(
    new ethereum.EventParam(
      'price',
      ethereum.Value.fromUnsignedBigInt(price)
    )
  );

  return event;
}
