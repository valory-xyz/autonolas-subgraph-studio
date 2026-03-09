import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { CreateBond, DevIncentive, Epoch } from "../generated/schema";
import { Tokenomics } from "../generated/Tokenomics/Tokenomics";
import { findEpochId } from "./utils";

export class EpochMapper {
  address: Address;
  blockNumber: BigInt;
  blockTimestamp: BigInt;
  epochCounter: BigInt;
  accountTopUps: BigInt;
  availableStakingIncentives: BigInt;

  constructor(
    address: Address,
    blockNumber: BigInt,
    blockTimestamp: BigInt,
    epochCounter: BigInt,
    accountTopUps: BigInt,
    availableStakingIncentives: BigInt
  ) {
    this.address = address;
    this.blockNumber = blockNumber;
    this.blockTimestamp = blockTimestamp;
    this.epochCounter = epochCounter;
    this.accountTopUps = accountTopUps;
    this.availableStakingIncentives = availableStakingIncentives;
  }
}


export function handleEpochSave(params: EpochMapper): void {
  // Epoch entity
  let epoch = Epoch.load(params.epochCounter.toString());
  if (!epoch) {
    epoch = new Epoch(params.epochCounter.toString());
  }
  epoch.counter = params.epochCounter.toI32();
  epoch.endBlock = params.blockNumber;
  epoch.blockTimestamp = params.blockTimestamp;
  epoch.accountTopUps = params.accountTopUps;
  epoch.availableStakingIncentives = params.availableStakingIncentives;

  // Manually set the first epoch startBlock and effectiveBond with accountTopUps
  if (epoch.counter == 1) {
    epoch.startBlock = BigInt.fromString("16699195");
    epoch.effectiveBond = BigInt.fromString("376744602072265367760000");
    epoch.availableDevIncentives = BigInt.fromI32(0)
  }

  /**
   * Calculate totalBondsClaimable and maturedBonds
   **/ 
  let totalBondsClaimable = BigInt.fromI32(0);
  const maturedBonds = new Array<Bytes>()

  const prevEpoch = Epoch.load((epoch.counter - 1).toString());

  if (prevEpoch) {
    // Iterate through epochs from 1 up to the current epoch
    // to find matured bonds
    for (let i = 1; i <= epoch.counter; i++) {
      const epochId = i.toString();
      const historicalEpoch = Epoch.load(epochId);

      if (historicalEpoch && historicalEpoch.createBonds) {
        const bondIds = historicalEpoch.createBonds;
        const bonds = bondIds.load();

        for (let j = 0; j < bonds.length; j++) {
          const bond = bonds[j];

          // Calculate total bonds claimable
          const historicalEpochEndTimestamp = params.blockTimestamp
          const prevEpochEndTimestamp = prevEpoch.blockTimestamp

          if (
            bond !== null &&
            bond.maturity !== null &&
            prevEpochEndTimestamp !== null &&
            bond.maturity! >= prevEpochEndTimestamp &&
            bond.maturity! <= historicalEpochEndTimestamp
          ) {
            totalBondsClaimable = totalBondsClaimable.plus(
              bond.amountOLAS
            );
            maturedBonds.push(bond.id)
          }
        }
      }
    }
  }

  epoch.maturedBonds = maturedBonds;
  epoch.totalBondsClaimable = totalBondsClaimable;

  /**
   * Manually create next epoch to collect all data from the following events correctly
   **/ 
  let nextEpoch = new Epoch((epoch.counter + 1).toString());
  nextEpoch.counter = epoch.counter + 1;
  nextEpoch.startBlock = params.blockNumber.plus(BigInt.fromI32(1));
  nextEpoch.endBlock = null;
  nextEpoch.blockTimestamp = null;
  nextEpoch.accountTopUps = BigInt.fromI32(0);
  nextEpoch.availableStakingIncentives = BigInt.fromI32(0);
  // Access effectiveBond from the contract state when the epoch ends
  const contract = Tokenomics.bind(params.address);
  const effectiveBond = contract.effectiveBond();

  // The effectiveBond is calculated for the next epoch
  nextEpoch.effectiveBond = effectiveBond;

  // The availableDevIncentives are calculated for the next epoch
  let adjustedAccountTopUps = params.accountTopUps;
  if (epoch.counter == 1) { 
    adjustedAccountTopUps = BigInt.fromI32(0);
  }
  // There was an error in the 2d epoch for topUp calculation, manually reduce the value
  if (epoch.counter == 2) {
    adjustedAccountTopUps = adjustedAccountTopUps.minus(
      BigInt.fromString("877000006048735000000000")
    );
  }

  nextEpoch.availableDevIncentives = adjustedAccountTopUps

  nextEpoch.save();
  epoch.save();
}

export class DevIncentiveMapper {
  blockNumber: BigInt;
  transactionHash: Bytes;
  owner: Address;
  reward: BigInt;
  topUp: BigInt;

  constructor(
    blockNumber: BigInt,
    transactionHash: Bytes,
    owner: Address,
    reward: BigInt,
    topUp: BigInt
  ) {
    this.blockNumber = blockNumber;
    this.transactionHash = transactionHash;
    this.owner = owner;
    this.reward = reward;
    this.topUp = topUp;
  }
}

export function handleDevIncentiveSave(params: DevIncentiveMapper): void {
  const currentEpochId = findEpochId(params.blockNumber);
  if (currentEpochId) {
    const epoch = Epoch.load(currentEpochId);

    if (epoch) {
      let devIncentive = new DevIncentive(params.transactionHash.toHex());
      devIncentive.epoch = epoch.id;
      devIncentive.owner = params.owner;
      devIncentive.reward = params.reward;
      devIncentive.topUp = params.topUp;
      devIncentive.save();

      // Update the total dev incentives topUp in the epoch
      if (!epoch.devIncentivesTotalTopUp) {
        epoch.devIncentivesTotalTopUp = params.topUp;
      } else {
        epoch.devIncentivesTotalTopUp = epoch.devIncentivesTotalTopUp!.plus(
          params.topUp
        );
      }

      epoch.save();
    }
  }
}
