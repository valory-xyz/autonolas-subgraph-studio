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
    // Use try_quorum so a reverting call (e.g. an unexpected governor change)
    // leaves quorum null instead of halting the whole subgraph.
    const quorumResult = contract.try_quorum(proposalCreated.startBlock);
    if (!quorumResult.reverted) {
      proposalCreated.quorum = quorumResult.value;
      proposalCreated.save();
    }
  }
}
