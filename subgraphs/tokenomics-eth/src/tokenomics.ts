import { BigInt } from "@graphprotocol/graph-ts";
import {
  AgentRegistryUpdated as AgentRegistryUpdatedEvent,
  ComponentRegistryUpdated as ComponentRegistryUpdatedEvent,
  DepositoryUpdated as DepositoryUpdatedEvent,
  DispenserUpdated as DispenserUpdatedEvent,
  DonatorBlacklistUpdated as DonatorBlacklistUpdatedEvent,
  EffectiveBondUpdated as EffectiveBondUpdatedV2Event,
  EffectiveBondUpdated1 as EffectiveBondUpdatedEvent,
  EpochLengthUpdated as EpochLengthUpdatedEvent,
  EpochSettled as EpochSettledV2Event,
  EpochSettled1 as EpochSettledEvent,
  IDFUpdated as IDFUpdatedEvent,
  IncentiveFractionsUpdateRequested as IncentiveFractionsUpdateRequestedEvent,
  IncentiveFractionsUpdated as IncentiveFractionsUpdatedEvent,
  OwnerUpdated as OwnerUpdatedEvent,
  ServiceRegistryUpdated as ServiceRegistryUpdatedEvent,
  StakingParamsUpdateRequested as StakingParamsUpdateRequestedEvent,
  StakingParamsUpdated as StakingParamsUpdatedEvent,
  StakingRefunded as StakingRefundedEvent,
  TokenomicsImplementationUpdated as TokenomicsImplementationUpdatedEvent,
  TokenomicsParametersUpdateRequested as TokenomicsParametersUpdateRequestedEvent,
  TokenomicsParametersUpdated as TokenomicsParametersUpdatedEvent,
  TreasuryUpdated as TreasuryUpdatedEvent,
} from "../generated/Tokenomics/Tokenomics";
import {
  AgentRegistryUpdated,
  ComponentRegistryUpdated,
  DepositoryUpdated,
  DispenserUpdated,
  DonatorBlacklistUpdated,
  EffectiveBondUpdated,
  EpochLengthUpdated,
  EpochSettled,
  IDFUpdated,
  IncentiveFractionsUpdateRequested,
  IncentiveFractionsUpdated,
  OwnerUpdated,
  ServiceRegistryUpdated,
  StakingParamsUpdateRequested,
  StakingParamsUpdated,
  StakingRefunded,
  TokenomicsImplementationUpdated,
  TokenomicsParametersUpdateRequested,
  TokenomicsParametersUpdated,
  TreasuryUpdated,
  Epoch,
} from "../generated/schema";
import { EpochMapper, handleEpochSave } from "./mappings";
import { findEpochId } from "./utils";

export function handleAgentRegistryUpdated(
  event: AgentRegistryUpdatedEvent
): void {
  let entity = new AgentRegistryUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.agentRegistry = event.params.agentRegistry;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleComponentRegistryUpdated(
  event: ComponentRegistryUpdatedEvent
): void {
  let entity = new ComponentRegistryUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.componentRegistry = event.params.componentRegistry;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleDepositoryUpdated(event: DepositoryUpdatedEvent): void {
  let entity = new DepositoryUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.depository = event.params.depository;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleDispenserUpdated(event: DispenserUpdatedEvent): void {
  let entity = new DispenserUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.dispenser = event.params.dispenser;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleDonatorBlacklistUpdated(
  event: DonatorBlacklistUpdatedEvent
): void {
  let entity = new DonatorBlacklistUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.blacklist = event.params.blacklist;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleEffectiveBondUpdatedV2(
  event: EffectiveBondUpdatedV2Event
): void {
  let entity = new EffectiveBondUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochNumber = event.params.epochNumber;
  entity.effectiveBond = event.params.effectiveBond;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();

  // Update epoch with effectiveBond from each event so that
  // the epoch will eventually record the value of the last event
  let epoch = Epoch.load(event.params.epochNumber.toString());

  if (epoch) {
    epoch.effectiveBond = event.params.effectiveBond;
    epoch.save();
  }
}

export function handleEffectiveBondUpdated(
  event: EffectiveBondUpdatedEvent
): void {
  let entity = new EffectiveBondUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.effectiveBond = event.params.effectiveBond;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  const currentEpochId = findEpochId(event.block.number);

  if (currentEpochId) {
    const epoch = Epoch.load(currentEpochId);
    if (epoch) {
      // Set epoch number
      entity.epochNumber = BigInt.fromI32(epoch.counter);

      // Update epoch with effectiveBond from each event so that
      // the epoch will eventually record the value of the last event
      epoch.effectiveBond = entity.effectiveBond;
      epoch.save();
    }
  }

  entity.save();
}

export function handleEpochLengthUpdated(event: EpochLengthUpdatedEvent): void {
  let entity = new EpochLengthUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochLen = event.params.epochLen;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleEpochSettledV2(event: EpochSettledV2Event): void {
  let entity = new EpochSettled(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochCounter = event.params.epochCounter;
  entity.treasuryRewards = event.params.treasuryRewards;
  entity.accountRewards = event.params.accountRewards;
  entity.accountTopUps = event.params.accountTopUps;
  entity.effectiveBond = event.params.effectiveBond;
  entity.returnedStakingIncentive = event.params.returnedStakingIncentive;
  entity.totalStakingIncentive = event.params.totalStakingIncentive;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();

  const epochParams = new EpochMapper(
    event.address,
    event.block.number,
    event.block.timestamp,
    event.params.epochCounter,
    event.params.accountTopUps,
    event.params.totalStakingIncentive
  );

  handleEpochSave(epochParams);
}

export function handleEpochSettled(event: EpochSettledEvent): void {
  let entity = new EpochSettled(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochCounter = event.params.epochCounter;
  entity.treasuryRewards = event.params.treasuryRewards;
  entity.accountRewards = event.params.accountRewards;
  entity.accountTopUps = event.params.accountTopUps;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();

  const epochParams = new EpochMapper(
    event.address,
    event.block.number,
    event.block.timestamp,
    event.params.epochCounter,
    event.params.accountTopUps,
    // old epochs don't have staking incentives data,
    // so set to 0
    BigInt.fromI32(0)
  );

  handleEpochSave(epochParams);
}

export function handleIDFUpdated(event: IDFUpdatedEvent): void {
  let entity = new IDFUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.idf = event.params.idf;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleIncentiveFractionsUpdateRequested(
  event: IncentiveFractionsUpdateRequestedEvent
): void {
  let entity = new IncentiveFractionsUpdateRequested(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochNumber = event.params.epochNumber;
  entity.rewardComponentFraction = event.params.rewardComponentFraction;
  entity.rewardAgentFraction = event.params.rewardAgentFraction;
  entity.maxBondFraction = event.params.maxBondFraction;
  entity.topUpComponentFraction = event.params.topUpComponentFraction;
  entity.topUpAgentFraction = event.params.topUpAgentFraction;
  entity.stakingFraction = event.params.stakingFraction;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleIncentiveFractionsUpdated(
  event: IncentiveFractionsUpdatedEvent
): void {
  let entity = new IncentiveFractionsUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochNumber = event.params.epochNumber;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleOwnerUpdated(event: OwnerUpdatedEvent): void {
  let entity = new OwnerUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.owner = event.params.owner;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleServiceRegistryUpdated(
  event: ServiceRegistryUpdatedEvent
): void {
  let entity = new ServiceRegistryUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.serviceRegistry = event.params.serviceRegistry;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleStakingParamsUpdateRequested(
  event: StakingParamsUpdateRequestedEvent
): void {
  let entity = new StakingParamsUpdateRequested(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochNumber = event.params.epochNumber;
  entity.maxStakingIncentive = event.params.maxStakingIncentive;
  entity.minStakingWeight = event.params.minStakingWeight;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleStakingParamsUpdated(
  event: StakingParamsUpdatedEvent
): void {
  let entity = new StakingParamsUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochNumber = event.params.epochNumber;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleStakingRefunded(event: StakingRefundedEvent): void {
  let entity = new StakingRefunded(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochNumber = event.params.epochNumber;
  entity.amount = event.params.amount;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleTokenomicsImplementationUpdated(
  event: TokenomicsImplementationUpdatedEvent
): void {
  let entity = new TokenomicsImplementationUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.implementation = event.params.implementation;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleTokenomicsParametersUpdateRequested(
  event: TokenomicsParametersUpdateRequestedEvent
): void {
  let entity = new TokenomicsParametersUpdateRequested(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochNumber = event.params.epochNumber;
  entity.devsPerCapital = event.params.devsPerCapital;
  entity.codePerDev = event.params.codePerDev;
  entity.epsilonRate = event.params.epsilonRate;
  entity.epochLen = event.params.epochLen;
  entity.veOLASThreshold = event.params.veOLASThreshold;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleTokenomicsParametersUpdated(
  event: TokenomicsParametersUpdatedEvent
): void {
  let entity = new TokenomicsParametersUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.epochNumber = event.params.epochNumber;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}

export function handleTreasuryUpdated(event: TreasuryUpdatedEvent): void {
  let entity = new TreasuryUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  entity.treasury = event.params.treasury;

  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;

  entity.save();
}
