import { RegisterInstance as RegisterInstanceEvent } from "../generated/ServiceRegistryL2/ServiceRegistryL2";
import { Service } from "../generated/schema";

// Scaffold handler. Phase 1a will replace this with the full handler set
// from IMPLEMENTATION-PLAN.md §5.2 (handleRegisterInstance with
// PendingRegistration buffering and PendingBondAttribution write,
// handleActivateRegistration, handleCreateMultisigWithAgents,
// handleServiceNftTransfer, handleTerminateService).
//
// For now this records a minimal Service row keyed by serviceId so the
// build, codegen, and Matchstick run produce a non-empty store.
export function handleRegisterInstance(event: RegisterInstanceEvent): void {
  const serviceId = event.params.serviceId;
  const id = serviceId.toString();

  let service = Service.load(id);
  if (service == null) {
    service = new Service(id);
    service.serviceId = serviceId;
    service.registeredTimestamp = event.block.timestamp;
    service.registeredBlock = event.block.number;
    service.save();
  }
}
