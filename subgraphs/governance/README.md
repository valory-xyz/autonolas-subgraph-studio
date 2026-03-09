# Governance Subgraph

Tracks the OLAS token governance system on Ethereum mainnet — proposal lifecycle, voting, parameter changes, and timelock management across two GovernorOLAS contract versions.

> **Technical reference**: See [CLAUDE.md](CLAUDE.md) for full schema reference, handler details, quorum calculation logic, and AI context.

## Quick Overview

- Indexes two GovernorOLAS contracts: V1 (archived at block 17527057) and V2 (active)
- **Proposal lifecycle**: Creation, voting, queuing, execution, cancellation — with real-time vote tallies
- **Vote tracking**: `votesFor`/`votesAgainst` accumulated from `VoteCast` events (abstain votes tracked but don't increment counters)
- **Lazy quorum**: Quorum fetched from on-chain state on first lifecycle event after proposal creation
- **Parameter history**: Voting period, delay, threshold, quorum numerator, and timelock changes

## Common Queries

### Recent Proposals
```graphql
{
  proposalCreateds(
    orderBy: blockTimestamp
    orderDirection: desc
    first: 10
  ) {
    id
    proposalId
    proposer
    description
    votesFor
    votesAgainst
    quorum
    isExecuted
    isCancelled
  }
}
```

### Votes for a Proposal
```graphql
{
  voteCasts(
    where: { proposalId: "123" }
    orderBy: blockTimestamp
  ) {
    voter
    support
    weight
    reason
    blockTimestamp
  }
}
```

### Governance Parameter Changes
```graphql
{
  proposalThresholdSets(
    orderBy: blockTimestamp
    orderDirection: desc
    first: 5
  ) {
    oldProposalThreshold
    newProposalThreshold
    blockTimestamp
  }
}
```

## Development

```bash
yarn install    # Install dependencies
yarn codegen    # Generate TypeScript from schema + ABIs
yarn build      # Compile to WebAssembly
yarn test       # Run Matchstick tests
```

### Project Structure
* `src/governor-olas.ts` — All 11 event handlers (proposals, votes, parameter changes)
* `src/utils.ts` — Historical quorum calculation utility

### Setup & Deployment
**Check the [root README](/README.md).**
