import { newMockEvent } from "matchstick-as/assembly/index";
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts";
import {
  MechBalanceAdjusted,
  Withdraw
} from "../generated/BalanceTrackerFixedPriceNative/BalanceTrackerFixedPriceNative";
import { TestAddresses, TestValues } from "./test-helpers";

/**
 * Creates a mock MechBalanceAdjusted event.
 *
 * Event signature: MechBalanceAdjusted(indexed address mech, uint256 deliveryRate, uint256 balance, uint256 rateDiff)
 */
export function createMechBalanceAdjustedEvent(
  mech: Address,
  deliveryRate: BigInt,
  balance: BigInt,
  rateDiff: BigInt,
  timestamp: BigInt = TestValues.TIMESTAMP,
  blockNumber: BigInt = TestValues.BLOCK,
  logIndex: i32 = 0
): MechBalanceAdjusted {
  let event = changetype<MechBalanceAdjusted>(newMockEvent());
  event.address = TestAddresses.BALANCE_TRACKER_NATIVE;
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = timestamp;
  event.block.number = blockNumber;
  event.parameters = new Array();

  event.parameters.push(
    new ethereum.EventParam("mech", ethereum.Value.fromAddress(mech))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "deliveryRate",
      ethereum.Value.fromUnsignedBigInt(deliveryRate)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "balance",
      ethereum.Value.fromUnsignedBigInt(balance)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "rateDiff",
      ethereum.Value.fromUnsignedBigInt(rateDiff)
    )
  );

  return event;
}

/**
 * Creates a mock Withdraw event.
 *
 * Event signature: Withdraw(indexed address account, indexed address token, uint256 amount)
 */
export function createWithdrawEvent(
  account: Address,
  token: Address,
  amount: BigInt,
  timestamp: BigInt = TestValues.TIMESTAMP,
  blockNumber: BigInt = TestValues.BLOCK,
  logIndex: i32 = 0
): Withdraw {
  let event = changetype<Withdraw>(newMockEvent());
  event.address = TestAddresses.BALANCE_TRACKER_NATIVE;
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = timestamp;
  event.block.number = blockNumber;
  event.parameters = new Array();

  event.parameters.push(
    new ethereum.EventParam("account", ethereum.Value.fromAddress(account))
  );
  event.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "amount",
      ethereum.Value.fromUnsignedBigInt(amount)
    )
  );

  return event;
}
