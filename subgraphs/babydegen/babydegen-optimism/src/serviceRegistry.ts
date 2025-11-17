import { 
  RegisterInstance,
  CreateMultisigWithAgents
} from "../generated/ServiceRegistryL2/ServiceRegistryL2"
import { 
  Service, 
  ServiceRegistration, 
  ServiceIndex
} from "../generated/schema"
import { Safe } from "../generated/templates"
import { BigInt, Bytes, store, log, Address } from "@graphprotocol/graph-ts"
import { OPTIMUS_AGENT_ID, EXCLUDED_SERVICE_IDS } from "./constants"
import { registerServiceForSnapshots } from "./portfolioScheduler"
import { ensureAgentPortfolio } from "./helpers"
import { getEthUsd } from "./common"

// Helper function to check if a service ID should be excluded from tracking
function isServiceExcluded(serviceId: BigInt): boolean {
  for (let i = 0; i < EXCLUDED_SERVICE_IDS.length; i++) {
    if (serviceId.equals(EXCLUDED_SERVICE_IDS[i])) {
      return true
    }
  }
  return false
}

export function handleRegisterInstance(event: RegisterInstance): void {
  // Filter for Optimus agents only
  if (!event.params.agentId.equals(OPTIMUS_AGENT_ID)) {
    return
  }
  
  let serviceId = event.params.serviceId
  
  // Check if this service ID should be excluded from tracking
  if (isServiceExcluded(serviceId)) {
    log.info("SERVICE REGISTRY: Skipping excluded service ID {}", [serviceId.toString()])
    return
  }
  
  let tempId = Bytes.fromUTF8(serviceId.toString())
  
  // Always overwrite with latest registration
  let registration = new ServiceRegistration(tempId)
  registration.serviceId = serviceId
  registration.operatorSafe = event.params.operator
  registration.registrationBlock = event.block.number
  registration.registrationTimestamp = event.block.timestamp
  registration.registrationTxHash = event.transaction.hash
  registration.save()
  
  // Update existing service if it exists
  let serviceIndex = ServiceIndex.load(tempId)
  if (serviceIndex != null) {
    let service = Service.load(serviceIndex.currentServiceSafe)
    if (service != null) {
      service.operatorSafe = event.params.operator
      service.latestRegistrationBlock = event.block.number
      service.latestRegistrationTimestamp = event.block.timestamp
      service.latestRegistrationTxHash = event.transaction.hash
      service.updatedAt = event.block.timestamp
      service.save()
    }
  }
}

export function handleCreateMultisigWithAgents(event: CreateMultisigWithAgents): void {
  let serviceId = event.params.serviceId
  let multisig = event.params.multisig
  
  // Check if this service ID should be excluded from tracking
  if (isServiceExcluded(serviceId)) {
    log.info("SERVICE REGISTRY: Skipping multisig creation for excluded service ID {}", [serviceId.toString()])
    return
  }
  
  let tempId = Bytes.fromUTF8(serviceId.toString())
  
  let registration = ServiceRegistration.load(tempId)
  if (registration == null) {
    return // Not an Optimus service
  }
  
  // Check if we already have a service for this serviceId
  let serviceIndex = ServiceIndex.load(tempId)
  if (serviceIndex != null) {
    // Mark old service as inactive
    let oldService = Service.load(serviceIndex.currentServiceSafe)
    if (oldService != null) {
      oldService.isActive = false
      oldService.save()
    }
  } else {
    // Create new index
    serviceIndex = new ServiceIndex(tempId)
    serviceIndex.serviceId = serviceId
  }
  
  // Create new service with multisig address as ID
  let service = new Service(multisig)
  service.serviceId = serviceId
  service.operatorSafe = registration.operatorSafe
  service.serviceSafe = multisig
  
  // Initialize positionIds as empty array
  service.positionIds = []
  
  // Set registration data
  service.latestRegistrationBlock = registration.registrationBlock
  service.latestRegistrationTimestamp = registration.registrationTimestamp
  service.latestRegistrationTxHash = registration.registrationTxHash
  
  // Set multisig data
  service.latestMultisigBlock = event.block.number
  service.latestMultisigTimestamp = event.block.timestamp
  service.latestMultisigTxHash = event.transaction.hash
  
  service.isActive = true
  service.createdAt = event.block.timestamp
  service.updatedAt = event.block.timestamp
  service.save()
  
  // Update index to point to new service
  serviceIndex.currentServiceSafe = multisig
  serviceIndex.save()
  
  //  Set firstTradingTimestamp to registration timestamp if no funding exists
  let portfolio = ensureAgentPortfolio(multisig, event.block.timestamp)
  if (portfolio.firstTradingTimestamp.equals(BigInt.zero())) {
    // No funding has occurred yet - use registration timestamp as fallback
    portfolio.firstTradingTimestamp = event.block.timestamp
    
    // Capture ETH price at registration time as fallback
    portfolio.firstFundingEthPrice = getEthUsd(event.block)
    portfolio.save()
  }
  
  // Register service for portfolio snapshots
  registerServiceForSnapshots(multisig)
  
  // Create Safe datasource instance to track ETH transfers for service safe
  Safe.create(multisig)
  
  //Also create Safe datasource for the operator safe to track ETH inflows
  Safe.create(Address.fromBytes(registration.operatorSafe)) // Dynamic operator safe tracking
}
