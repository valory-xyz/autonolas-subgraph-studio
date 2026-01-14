# Autonolas Predict Polymarket Subgraph

A streamlined GraphQL API for tracking Autonolas agent performance on Polymarket prediction markets on Polygon.

## Overview

This subgraph indexes Autonolas trading agent activity on Polymarket, providing basic agent tracking and global statistics. This is a **minimal initial implementation** that tracks only registered agents and global metrics.

## Core Business Rules

1.  **Selective Tracking**:
    * **Agents**: Only tracks agents registered through the `ServiceRegistryL2` contract on Polygon.
    * **Scope**: This initial version tracks only TraderAgent and Global entities.

---

## Primary Entities

### TraderAgent
Represents an Autonolas trading agent with basic tracking information.
* `serviceId`: The agent's service ID from ServiceRegistryL2
* `firstParticipation`: Timestamp of first activity
* `lastActive`: Timestamp of last activity
* `totalBets`: Total number of bets placed
* `totalTraded`: Total trading volume
* `totalPayout`: Total payouts received
* `totalFees`: Total fees paid

### Global
Aggregate statistics across all agents.
* `totalTraderAgents`: Total number of registered agents
* `totalActiveTraderAgents`: Number of agents with activity
* `totalBets`: Total bets across all agents
* `totalTraded`: Total trading volume
* `totalPayout`: Total payouts
* `totalFees`: Total fees

---

## Common Queries

### Agent Statistics
Track an individual agent's performance.
```graphql
{
  traderAgent(id: "0x...") {
    serviceId
    firstParticipation
    lastActive
    totalBets
    totalTraded
    totalPayout
    totalFees
  }
}
```

### Global Statistics
```graphql
{
  global(id: "") {
    totalTraderAgents
    totalActiveTraderAgents
    totalBets
    totalTraded
    totalPayout
  }
}
```

## Development

### Project Structure
* `src/service-registry-l-2.ts`: Handles agent registration and multisig creation.
* `schema.graphql`: GraphQL schema with TraderAgent and Global entities.

### Setup & Deployment
Check the [root README](/README.md) for build and deployment instructions.

---

## Future Enhancements

This is an initial minimal implementation. Future versions may include:
- Detailed bet tracking per agent
- Daily profit statistics
- Market participation tracking
- Integration with Polymarket-specific events