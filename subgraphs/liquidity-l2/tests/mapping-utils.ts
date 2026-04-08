import { newMockEvent } from 'matchstick-as/assembly/index';
import { ethereum, Address, BigInt, Bytes } from '@graphprotocol/graph-ts';
import { Transfer } from '../generated/BalancerPool/BalancerV2WeightedPool';
import { Swap as VaultSwap } from '../generated/BalancerPool/BalancerV2Vault';
import { Swap as UniswapSwap } from '../generated/BalancerPool/UniswapV2Pair';

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

export function createVaultSwapEvent(
  poolId: Bytes,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: BigInt,
  amountOut: BigInt,
  vaultAddress: Address,
  timestamp: BigInt = BigInt.fromI32(1700000000),
  logIndex: i32 = 0
): VaultSwap {
  let event = changetype<VaultSwap>(newMockEvent());
  event.address = vaultAddress;
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = timestamp;
  event.parameters = new Array();

  event.parameters.push(
    new ethereum.EventParam('poolId', ethereum.Value.fromFixedBytes(poolId))
  );
  event.parameters.push(
    new ethereum.EventParam('tokenIn', ethereum.Value.fromAddress(tokenIn))
  );
  event.parameters.push(
    new ethereum.EventParam('tokenOut', ethereum.Value.fromAddress(tokenOut))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'amountIn',
      ethereum.Value.fromUnsignedBigInt(amountIn)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      'amountOut',
      ethereum.Value.fromUnsignedBigInt(amountOut)
    )
  );

  return event;
}

export function createUniswapSwapEvent(
  sender: Address,
  amount0In: BigInt,
  amount1In: BigInt,
  amount0Out: BigInt,
  amount1Out: BigInt,
  to: Address,
  contractAddress: Address,
  timestamp: BigInt = BigInt.fromI32(1700000000),
  logIndex: i32 = 0
): UniswapSwap {
  let event = changetype<UniswapSwap>(newMockEvent());
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
