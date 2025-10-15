import { Address, BigInt } from "@graphprotocol/graph-ts";
import { GovernorOLAS } from "../generated/GovernorOLAS/GovernorOLAS";
import { ProposalCreated } from "../generated/schema";

/**
 * Update quorum for historical proposals
 * Quorum can be retrieved on chain at a block in the past
 */
export function updateProposalQuorum(
  proposalId: BigInt,
  blockNumber: BigInt,
  contractAddress: Address,
): void {
  let proposalCreated = ProposalCreated.load(proposalId.toString());

  if (
    proposalCreated &&
    proposalCreated.quorum === null &&
    blockNumber.gt(proposalCreated.startBlock)
  ) {
    const contract = GovernorOLAS.bind(contractAddress);
    const quorum = contract.quorum(proposalCreated.startBlock);
    proposalCreated.quorum = quorum;
    proposalCreated.save();
  }
}
