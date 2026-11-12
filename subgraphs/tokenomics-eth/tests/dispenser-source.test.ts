import { assert, beforeEach, clearStore, newMockEvent, test } from 'matchstick-as/assembly/index';
import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import * as LegacyEvents from '../generated/DispenserV2/DispenserV2';
import * as ProxyEvents from '../generated/DispenserProxy/DispenserProxy';
import * as Legacy from '../src/dispenser';
import * as Proxy from '../src/dispenser-proxy';
const PROXY = Address.fromString('0x78Bd94F48CAe623CC74828eCbFEBE3bDF428D83D');
const ACCOUNT = Address.fromString('0x0000000000000000000000000000000000000001');
const TARGET = Bytes.fromHexString('0x0000000000000000000000000000000000000000000000000000000000000001');
const CHAIN = BigInt.fromString('5000000000');
function param(name: string, value: ethereum.Value): ethereum.EventParam { return new ethereum.EventParam(name, value); }
function u(value: i32): ethereum.Value { return ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(value)); }
const OLD = Address.fromString('0x5650300fCBab43A0D7D02F8Cb5d0f039402593f0');
beforeEach(() => { clearStore(); });

test('AddNomineeHash exposes legacy and proxy Dispensers separately', () => {
  let oldEvent = changetype<LegacyEvents.AddNomineeHash>(newMockEvent());
  oldEvent.address = OLD; oldEvent.logIndex = BigInt.fromI32(1); oldEvent.parameters = [param("nomineeHash", ethereum.Value.fromFixedBytes(TARGET))];
  let newEvent = changetype<ProxyEvents.AddNomineeHash>(newMockEvent());
  newEvent.address = PROXY; newEvent.logIndex = BigInt.fromI32(2); newEvent.parameters = [param("nomineeHash", ethereum.Value.fromFixedBytes(TARGET))];
  Legacy.handleAddNomineeHash(oldEvent); Proxy.handleAddNomineeHash(newEvent);
  assert.entityCount('AddNomineeHash', 2);
  assert.fieldEquals('AddNomineeHash', oldEvent.transaction.hash.concatI32(1).toHexString(), 'dispenser', OLD.toHexString());
  assert.fieldEquals('AddNomineeHash', newEvent.transaction.hash.concatI32(2).toHexString(), 'dispenser', PROXY.toHexString());
});

test('RemoveNomineeHash exposes legacy and proxy Dispensers separately', () => {
  let oldEvent = changetype<LegacyEvents.RemoveNomineeHash>(newMockEvent());
  oldEvent.address = OLD; oldEvent.logIndex = BigInt.fromI32(1); oldEvent.parameters = [param("nomineeHash", ethereum.Value.fromFixedBytes(TARGET))];
  let newEvent = changetype<ProxyEvents.RemoveNomineeHash>(newMockEvent());
  newEvent.address = PROXY; newEvent.logIndex = BigInt.fromI32(2); newEvent.parameters = [param("nomineeHash", ethereum.Value.fromFixedBytes(TARGET))];
  Legacy.handleRemoveNomineeHash(oldEvent); Proxy.handleRemoveNomineeHash(newEvent);
  assert.entityCount('RemoveNomineeHash', 2);
  assert.fieldEquals('RemoveNomineeHash', oldEvent.transaction.hash.concatI32(1).toHexString(), 'dispenser', OLD.toHexString());
  assert.fieldEquals('RemoveNomineeHash', newEvent.transaction.hash.concatI32(2).toHexString(), 'dispenser', PROXY.toHexString());
});

test('Retained exposes legacy and proxy Dispensers separately', () => {
  let oldEvent = changetype<LegacyEvents.Retained>(newMockEvent());
  oldEvent.address = OLD; oldEvent.logIndex = BigInt.fromI32(1); oldEvent.parameters = [param("account", ethereum.Value.fromAddress(ACCOUNT)), param("returnAmount", u(10))];
  let newEvent = changetype<ProxyEvents.Retained>(newMockEvent());
  newEvent.address = PROXY; newEvent.logIndex = BigInt.fromI32(2); newEvent.parameters = [param("account", ethereum.Value.fromAddress(ACCOUNT)), param("returnAmount", u(10))];
  Legacy.handleRetained(oldEvent); Proxy.handleRetained(newEvent);
  assert.entityCount('Retained', 2);
  assert.fieldEquals('Retained', oldEvent.transaction.hash.concatI32(1).toHexString(), 'dispenser', OLD.toHexString());
  assert.fieldEquals('Retained', newEvent.transaction.hash.concatI32(2).toHexString(), 'dispenser', PROXY.toHexString());
});

test('WithheldAmountSynced exposes legacy and proxy Dispensers separately', () => {
  let oldEvent = changetype<LegacyEvents.WithheldAmountSynced>(newMockEvent());
  oldEvent.address = OLD; oldEvent.logIndex = BigInt.fromI32(1); oldEvent.parameters = [param("chainId", ethereum.Value.fromUnsignedBigInt(CHAIN)), param("amount", u(10)), param("updatedWithheldAmount", u(20)), param("batchHash", ethereum.Value.fromFixedBytes(TARGET))];
  let newEvent = changetype<ProxyEvents.WithheldAmountSynced>(newMockEvent());
  newEvent.address = PROXY; newEvent.logIndex = BigInt.fromI32(2); newEvent.parameters = [param("chainId", ethereum.Value.fromUnsignedBigInt(CHAIN)), param("amount", u(10)), param("updatedWithheldAmount", u(20)), param("batchHash", ethereum.Value.fromFixedBytes(TARGET))];
  Legacy.handleWithheldAmountSynced(oldEvent); Proxy.handleWithheldAmountSynced(newEvent);
  assert.entityCount('WithheldAmountSynced', 2);
  assert.fieldEquals('WithheldAmountSynced', oldEvent.transaction.hash.concatI32(1).toHexString(), 'dispenser', OLD.toHexString());
  assert.fieldEquals('WithheldAmountSynced', newEvent.transaction.hash.concatI32(2).toHexString(), 'dispenser', PROXY.toHexString());
});
