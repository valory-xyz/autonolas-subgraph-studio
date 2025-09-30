import { Transfer } from "../generated/OLAS/OLAS";
import { Transfer as TransferEntity } from "../generated/schema";
import { handleTransferBalances } from "../utils";

export function handleTransfer(event: Transfer): void {
  // Create Transfer entity for tracking
  let transferEntity = new TransferEntity(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  transferEntity.from = event.params.from;
  transferEntity.to = event.params.to;
  transferEntity.value = event.params.amount;
  transferEntity.blockNumber = event.block.number;
  transferEntity.blockTimestamp = event.block.timestamp;
  transferEntity.transactionHash = event.transaction.hash;
  transferEntity.save();

  // Handle OLAS token holder tracking
  handleTransferBalances(
    event.address,
    event.params.from,
    event.params.to,
    event.params.amount
  );
}
