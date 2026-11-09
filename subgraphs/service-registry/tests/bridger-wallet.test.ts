import { afterEach, assert, clearStore, newMockEvent, test } from 'matchstick-as/assembly/index';
import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { AgentMultisigUpdated, AgentWalletSet, ServiceAgentLinked, MetadataSet } from '../generated/IdentityRegistryBridger/IdentityRegistryBridger';
import { CreateMultisigWithAgents, TerminateService } from '../generated/ServiceRegistryL2/ServiceRegistryL2';
import { Service, ERC8004Agent } from '../generated/schema';
import { handleCreateMultisig, handleTerminateService } from '../src/mapping';
import { handleAgentMultisigUpdated, handleAgentWalletSet, handleServiceAgentLinked, handleMetadataSet } from '../src/mapping';

const OLD = Address.fromString('0x0000000000000000000000000000000000000011');
const OTHER = Address.fromString('0x0000000000000000000000000000000000000022');
const ZERO = Address.zero();
const SID = BigInt.fromI32(1);
const AID = BigInt.fromI32(77);
function ids(): ethereum.EventParam[] {
  return [new ethereum.EventParam('serviceId', ethereum.Value.fromUnsignedBigInt(SID)), new ethereum.EventParam('agentId', ethereum.Value.fromUnsignedBigInt(AID))];
}
function changed(oldSafe: Address, newSafe: Address): AgentMultisigUpdated {
  let e = changetype<AgentMultisigUpdated>(newMockEvent());
  e.parameters = ids();
  e.parameters.push(new ethereum.EventParam('oldMultisig', ethereum.Value.fromAddress(oldSafe)));
  e.parameters.push(new ethereum.EventParam('newMultisig', ethereum.Value.fromAddress(newSafe)));
  return e;
}
function authorize(wallet: Address): void {
  let e = changetype<AgentWalletSet>(newMockEvent());
  e.parameters = ids();
  e.parameters.push(new ethereum.EventParam('multisig', ethereum.Value.fromAddress(wallet)));
  handleAgentWalletSet(e);
}
function seed(): void {
  let s = new Service('1');
  s.agentIds = [];
  s.creationTimestamp = BigInt.fromI32(123);
  s.multisig = OLD;
  s.save();
  let link = changetype<ServiceAgentLinked>(newMockEvent());
  link.parameters = ids();
  handleServiceAgentLinked(link);
  let m = changetype<MetadataSet>(newMockEvent());
  m.parameters = ids();
  m.parameters.push(new ethereum.EventParam('metadataKey', ethereum.Value.fromString('custom')));
  m.parameters.push(new ethereum.EventParam('metadataValue', ethereum.Value.fromBytes(Bytes.fromUTF8('retained'))));
  handleMetadataSet(m);
}
function assertIdentity(): void {
  assert.fieldEquals('Service', '1', 'erc8004Agent', '77');
  assert.fieldEquals('ERC8004Metadata', '77-custom', 'value', 'retained');
  assert.fieldEquals('ERC8004Metadata', '77-ecosystem', 'value', 'Olas');
  assert.fieldEquals('ERC8004Metadata', '77-serviceRegistry', 'value', '1');
}
function terminationAndRedeployment(safe: Address): void {
  seed();
  authorize(OLD);
  // The bridger clears authorization before the registry termination event.
  handleAgentMultisigUpdated(changed(OLD, ZERO));
  let termination = changetype<TerminateService>(newMockEvent());
  termination.parameters = [new ethereum.EventParam('serviceId', ethereum.Value.fromUnsignedBigInt(SID))];
  handleTerminateService(termination);
  assert.fieldEquals('ERC8004Agent', '77', 'agentWallet', ZERO.toHexString());
  assertIdentity();
  let creation = changetype<CreateMultisigWithAgents>(newMockEvent());
  creation.parameters = [new ethereum.EventParam('serviceId', ethereum.Value.fromUnsignedBigInt(SID)), new ethereum.EventParam('multisig', ethereum.Value.fromAddress(safe))];
  handleCreateMultisig(creation);
  handleAgentMultisigUpdated(changed(ZERO, safe));
  assert.fieldEquals('Service', '1', 'multisig', safe.toHexString());
  assert.fieldEquals('ERC8004Agent', '77', 'agentWallet', ZERO.toHexString());
  authorize(safe);
  assert.fieldEquals('ERC8004Agent', '77', 'agentWallet', safe.toHexString());
  assertIdentity();
}
afterEach(() => clearStore());
test('termination then same-Safe redeployment requires explicit wallet authorization', () => terminationAndRedeployment(OLD));
test('termination then different-Safe redeployment requires explicit wallet authorization', () => terminationAndRedeployment(OTHER));
test('replacing a legacy nonzero multisig clears the wallet without authorizing its replacement', () => {
  seed(); authorize(OLD);
  handleAgentMultisigUpdated(changed(OLD, OTHER));
  assert.fieldEquals('ERC8004Agent', '77', 'agentWallet', ZERO.toHexString());
  assertIdentity();
  authorize(OTHER);
  assert.fieldEquals('ERC8004Agent', '77', 'agentWallet', OTHER.toHexString());
});
test('zero-old-multisig link neither authorizes a wallet nor clears existing authorization', () => {
  seed();
  handleAgentMultisigUpdated(changed(ZERO, OLD));
  assert.booleanEquals(ERC8004Agent.load('77')!.get('agentWallet') == null, true);
  authorize(OLD);
  handleAgentMultisigUpdated(changed(ZERO, OTHER));
  assert.fieldEquals('ERC8004Agent', '77', 'agentWallet', OLD.toHexString());
  authorize(ZERO);
  assert.fieldEquals('ERC8004Agent', '77', 'agentWallet', ZERO.toHexString());
  assertIdentity();
});

test('legacy termination without a bridger cleanup event retains the recorded wallet', () => {
  seed(); authorize(OLD);
  let e = changetype<TerminateService>(newMockEvent());
  e.parameters = [new ethereum.EventParam('serviceId', ethereum.Value.fromUnsignedBigInt(SID))];
  handleTerminateService(e);
  assert.fieldEquals('ERC8004Agent', '77', 'agentWallet', OLD.toHexString());
  assertIdentity();
});
