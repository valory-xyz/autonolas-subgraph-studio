import { Transfer } from "../generated/OLAS/OLAS";
import { BondClaim, Epoch, Token } from "../generated/schema";
import { findEpochId } from "./utils";
import { handleTransferBalances } from "./utils";
import { Address, BigInt } from "@graphprotocol/graph-ts";
const VEOLAS_ADDRESS = Address.fromString(
  "0x7e01A500805f8A52Fad229b3015AD130A332B7b3"
);
const BIGINT_ZERO = BigInt.fromI32(0);

// Bond claimer contract addresses from the Dune query
const BOND_CLAIMER_ADDRESSES = [
  Address.fromString("0xff8697d8d2998d6aa2e09b405795c6f4beeb0c81"),
  Address.fromString("0x52a043bcebdb2f939baef2e8b6f01652290eab3f"),
];

export function handleTransfer(event: Transfer): void {
  if (BOND_CLAIMER_ADDRESSES.indexOf(event.params.from) > -1) {
    const currentEpochId = findEpochId(event.block.number);
    let bondClaim = new BondClaim(
      event.transaction.hash.concatI32(event.logIndex.toI32())
    );
    bondClaim.epoch = currentEpochId;
    bondClaim.claimer = event.params.to;
    bondClaim.amountOLAS = event.params.amount;
    bondClaim.transactionHash = event.transaction.hash;
    bondClaim.blockNumber = event.block.number;
    bondClaim.blockTimestamp = event.block.timestamp;
    bondClaim.save();

    if (currentEpochId) {
      let epoch = Epoch.load(currentEpochId);
      if (epoch) {
        // Update the total claimed bonds amount in the epoch
        if (!epoch.totalBondsClaimed) {
          epoch.totalBondsClaimed = event.params.amount;
        } else {
          epoch.totalBondsClaimed = epoch.totalBondsClaimed!.plus(
            event.params.amount
          );
        }
        epoch.save();
      }
    }
  }

  // OLAS token and holder tracking
  handleTransferBalances(
    event.address,
    event.params.from,
    event.params.to,
    event.params.amount
  );

  if (
    event.params.to.equals(VEOLAS_ADDRESS) ||
    event.params.from.equals(VEOLAS_ADDRESS)
  ) {
    let token = Token.load(VEOLAS_ADDRESS);
    if (token == null) {
      token = new Token(VEOLAS_ADDRESS);
      token.balance = BIGINT_ZERO;
      token.holderCount = 0;
    }

    // if 'to' is veOLAS contract, increase balance
    if (event.params.to.equals(VEOLAS_ADDRESS)) {
      token.balance = token.balance.plus(event.params.amount);
    }

    // if 'from' is veOLAS contract, decrease balance
    if (event.params.from.equals(VEOLAS_ADDRESS)) {
      token.balance = token.balance.minus(event.params.amount);
    }

    token.save();
  }
}