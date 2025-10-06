import { BigInt, Bytes, Address, ethereum, log } from "@graphprotocol/graph-ts"
import { Service, ServiceRegistration, ServiceIndex } from "../generated/schema"
import { Safe } from "../generated/templates"
import { registerServiceForSnapshots } from "./portfolioScheduler"
import { OPTIMUS_AGENT_ID } from "./constants"

export function bootstrapManualService(block: ethereum.Block): void {
  log.info("Manual service bootstrap started at block {}", [block.number.toString()])
  
  // Hardcoded values
  let serviceId = BigInt.fromI32(999) // Using 999 as a unique ID that won't conflict with real services
  let operatorSafe = Address.fromString("0x1b1f69188d70ff0e85a5207c2fa1c0f21e8ba4e8") // Lowercase for consistency
  let serviceSafe = Address.fromString("0x8ed5ae443fbb1a36e364ac154887f3150669702a") // Lowercase for consistency
  
  log.info("Registering service with ID {} - serviceSafe: {} - operatorSafe: {}", [
    serviceId.toString(), 
    serviceSafe.toHexString(),
    operatorSafe.toHexString()
  ])
  
  let tempId = Bytes.fromUTF8(serviceId.toString())
  
  // Check if service already exists to prevent duplicates
  let existingIndex = ServiceIndex.load(tempId)
  if (existingIndex != null) {
    log.info("Service with ID {} already exists, skipping manual registration", [serviceId.toString()])
    return
  }
  
  // Create ServiceRegistration
  let registration = new ServiceRegistration(tempId)
  registration.serviceId = serviceId
  registration.operatorSafe = operatorSafe
  registration.registrationBlock = block.number
  registration.registrationTimestamp = block.timestamp
  registration.registrationTxHash = Bytes.fromUTF8("manual-registration")
  registration.save()
  
  // Create ServiceIndex
  let serviceIndex = new ServiceIndex(tempId)
  serviceIndex.serviceId = serviceId
  serviceIndex.currentServiceSafe = serviceSafe
  serviceIndex.save()
  
  // Create Service
  let service = new Service(serviceSafe)
  service.serviceId = serviceId
  service.operatorSafe = operatorSafe
  service.serviceSafe = serviceSafe
  
  // Initialize positionIds as empty array
  service.positionIds = []
  
  // Set registration data
  service.latestRegistrationBlock = block.number
  service.latestRegistrationTimestamp = block.timestamp
  service.latestRegistrationTxHash = Bytes.fromUTF8("manual-registration")
  
  // Set multisig data
  service.latestMultisigBlock = block.number
  service.latestMultisigTimestamp = block.timestamp
  service.latestMultisigTxHash = Bytes.fromUTF8("manual-multisig-creation")
  
  service.isActive = true
  service.createdAt = block.timestamp
  service.updatedAt = block.timestamp
  service.save()
  
  log.info("Manually registered service with ID {} and safe {}", [
    serviceId.toString(),
    serviceSafe.toHexString()
  ])
  
  // Register service for portfolio snapshots
  registerServiceForSnapshots(serviceSafe)
  
  // Create Safe datasource instance to track ETH transfers
  Safe.create(serviceSafe)
  
  log.info("Manual service bootstrap completed successfully - safe: {}", [serviceSafe.toHexString()])
}
