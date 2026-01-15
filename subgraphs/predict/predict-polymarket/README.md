# Autonolas Predict Polymarket Subgraph

A streamlined GraphQL API for tracking Autonolas agent performance on Polymarket prediction markets on Polygon.

## Core Business Rules

1.  **Selective Tracking**:
    * **Agents**: Only tracks services with agents ID 86 registered through the `ServiceRegistryL2` contract on Polygon.
    * **Markets**: Binary markets (2 outcomes) tracked via UMA OptimisticOracleV3 and ConditionalTokens.

---

## Primary Entities

### TraderAgent
Represents an Autonolas trading agent.
* `serviceId`: The agent's service ID from ServiceRegistryL2
* `firstParticipation`: Timestamp of first activity
* `lastActive`: Timestamp of last activity
* `totalBets`: Total number of bets placed
* `totalTraded`: Total trading volume for settled markets only
* `totalPayout`: Total payouts received
* `totalFees`: Total fees for settled markets only

### Question
Represents a market question linked to a condition.
* `conditionId`: Links to ConditionalTokens condition
* `metadata`: Market metadata (title, outcomes, description)

### MarketMetadata
Market details extracted from UMA ancillary data.
* `title`: Market question title
* `outcomes`: Array of outcome names (e.g., ["Yes", "No"])
* `description`: Optional market description

### Global
Aggregate statistics across all agents.
* `totalTraderAgents`: Total number of registered agents
* `totalActiveTraderAgents`: Number of agents with activity
* `totalBets`: Total bets across all agents
* `totalTraded`: Total trading volume for settled markets only
* `totalPayout`: Total payouts
* `totalFees`: Total fees for settled markets only

---

## Common Queries

### Agent Statistics
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

### Market Information
```graphql
{
  question(id: "0x...") {
    conditionId
    metadata {
      title
      outcomes
      description
    }
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
* `src/service-registry-l-2.ts`: Agent registration (service ID 86 only)
* `src/conditional-tokens.ts`: Condition preparation and payout handling
* `src/uma-mapping.ts`: Market metadata extraction from UMA events
* `schema.graphql`: GraphQL schema

### Setup & Deployment
Check the [root README](/README.md) for build and deployment instructions.


---

## Future Enhancements

This is an initial minimal implementation. Future versions may include:
- Detailed bet tracking per agent
- Daily profit statistics
- Market participation tracking