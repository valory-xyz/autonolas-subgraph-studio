# Autonolas Predict Polymarket Subgraph

A streamlined GraphQL API for tracking Autonolas agent performance on Polymarket prediction markets on Polygon.

## Core Business Rules

1.  **Selective Tracking**:
    * **Agents**: Only tracks services with agents ID 86 registered through the `ServiceRegistryL2` contract on Polygon.
    * **Markets**: Binary markets (2 outcomes) tracked via UMA OptimisticOracleV3 and ConditionalTokens.
2.  **Accounting & Statistics**:
    * **Historical vs Settled Totals**:
        * `totalTraded` tracks **all bets** regardless of settlement status (updated immediately when bets are placed)
        * `totalTradedSettled` tracks **settled markets only** (updated based on settlement timing)
    * **Settlement Timing for Settled Totals**:
        * **Incorrect bets**: Updated on **market settlement day** (when `QuestionResolved` is recorded)
        * **Correct bets**: Updated on **payout redemption day** (when agent claims winnings)
    * **Profit Attribution**:
        * **Losses** are recorded on the **market settlement day** (for all incorrect bets)
        * **Wins** are recorded on the **payout redemption day**
3.  **Invalid Markets**: If a market is resolved with an invalid answer (no winning outcome), all bets are treated as losses. Because the invalid answer will not match any agent's `outcomeIndex`, costs are automatically deducted as losses on the market settlement day. The payout should happen later for such markets and is expected to be reflected in `totalPayout`
5.  **Agent Profit**: The `DailyProfitStatistic` entity maintains daily profit based on settled markets and payouts, and a list of `profitParticipants` (market IDs). This allows for granular downstream analysis by correlating these market IDs with their titles or external metadata.

---

## Primary Entities

### TraderAgent
Represents an Autonolas trading agent with cumulative performance metrics.
* `id`: agent multisig
* `serviceId`: The agent's service ID from ServiceRegistryL2
* `firstParticipation`: Timestamp of first activity
* `lastActive`: Timestamp of last activity
* `totalBets`: Total number of bets placed
* `totalTraded`: All bets volume (updated immediately when bets are placed)
* `totalTradedSettled`: Volume for **settled** markets only (updated at settlement or payout)
* `totalPayout`: All USDC reclaimed by the agent via redemptions

### Bet
An individual trade (Buy or Sell) placed by an agent.
* `bettor`: The TraderAgent who placed the bet
* `question`: The market (Question entity) this bet is for
* `outcomeIndex`: The outcome the agent bet on (0 or 1)
* `amount`: USDC amount spent on this bet
* `shares`: Number of outcome tokens received
* `countedInTotal`: Flag ensuring volume is added to settled totals only once (at settlement for incorrect bets, at payout for correct bets)
* `countedInProfit`: Flag ensuring PnL impact is processed only once (either at settlement or payout)
* `dailyStatistic`: Reference to the DailyProfitStatistic when the bet was placed

### DailyProfitStatistic
Tracks day-to-day performance for an agent (normalized to start of day UTC).
* `traderAgent`: The agent this statistic is for
* `date`: Normalized timestamp (start of day)
* `totalBets`: Number of bets placed on this day
* `totalTraded`: Volume **placed** on this specific day
* `dailyProfit`: Net profit/loss for this day (adjusted on settlement/payout days)
* `profitParticipants`: List of market IDs that contributed to PnL on this date

### MarketParticipant
Tracks an agent's participation in a specific market.
* `traderAgent`: The agent
* `question`: The market
* `totalBets`: Number of bets in this market
* `totalTraded`: All volume in this market
* `totalTradedSettled`: Settled volume only
* `totalPayout`: Payouts received from this market

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
* `totalTraded`: All bets volume (updated immediately)
* `totalTradedSettled`: Volume for settled markets only
* `totalPayout`: Total payouts across all agents

---

## Technical Data Flow

The subgraph tracks the complete lifecycle of a market from creation to final settlement:

### 1. Condition Preparation (`handleConditionPreparation`)
Triggered when a new binary market is created in ConditionalTokens.
* **Validation**: Only markets with exactly 2 outcomes are tracked (binary markets).
* **Bridge Creation**: Creates a `QuestionIdToConditionId` entity to link the UMA question ID to the ConditionalTokens condition ID.
* **Purpose**: Establishes the bridge between the two ID systems. The actual `Question` entity is created later when metadata arrives.

### 2. Question Initialization (`handleQuestionInitialized`)
Triggered when UMA OptimisticOracleV3 receives the market metadata.
* **Metadata Extraction**: Parses the ancillary data to extract market title, outcomes (e.g., ["Yes", "No"]), and description.
* **Validation**: Only processes Yes/No binary markets; ignores other market types.
* **MarketMetadata Creation**: Creates a `MarketMetadata` entity with human-readable market information.
* **Question Creation**: Creates the `Question` entity using the condition ID (obtained from the bridge) and links it to the metadata.
* **Purpose**: Provides human-readable context for the market. This is when the `Question` entity is actually created.

### 3. Token Registration (`handleTokenRegistered`)
Triggered when outcome tokens are registered in the CTF Exchange.
* **Token Registry Creation**: Creates `TokenRegistry` entities for both outcome tokens (token0 and token1).
* **Outcome Mapping**: Maps each token ID to its outcome index (0 or 1) and the condition ID.
* **Purpose**: Enables the subgraph to identify which outcome an agent is betting on when processing OrderFilled events.

### 4. Bet Placement (`handleOrderFilled`)
Triggered when an agent trades outcome tokens in the CTF Exchange.
* **Agent Identification**: Checks if the **maker** is a registered TraderAgent (agents operate as makers, not takers).
* **Trade Direction**: Determines if the maker is buying (makerAssetId = 0) or selling (takerAssetId = 0) outcome tokens.
* **Bet Creation**: Creates a `Bet` entity with amount (USDC spent), shares (tokens received), and outcome index.
* **Statistics Updates**: Updates `totalBets` and `totalTraded` for TraderAgent, MarketParticipant, Global, and DailyProfitStatistic.
* **Note**: At this stage, bets are active but not yet settled. `totalTraded` is updated immediately, but `totalTradedSettled` remains unchanged until market is settled.

### 5. Market Resolution (`handleQuestionResolved`)
Triggered when the UMA Oracle provides the final answer.
* **Update Settled Totals** (for incorrect bets only): For each **incorrect** bet (where `outcomeIndex != answer`), if `countedInTotal` is false, it increments `totalTradedSettled` for the Agent, MarketParticipant, and Global entities.
* **Realize Losses**: For every **incorrect** bet, the cost (`amount`) is subtracted from the agent's `dailyProfit` for the **settlement date**.
* **Tracking**: The market ID is added to the day's `profitParticipants` to mark that a loss was realized for this market.
* **Note**: Correct bets are **not** processed here - their settled totals are updated during payout redemption.

### 6. Payout Redemption (`handlePayoutRedemption`)
Triggered when an agent claims winnings from ConditionalTokens.
* **Update Settled Totals** (for correct bets): The amount from winning bets that haven't been counted yet (unsettled amount = `totalTraded - totalTradedSettled` for this market participant) is added to `totalTradedSettled` for Agent, MarketParticipant, and Global entities.
* **Net Profit Calculation**: The subgraph identifies the costs (`amount`) of the winning bets that haven't been "counted in profit" yet.
* **Update PnL**: `Profit = Payout - TotalCosts`. This net value is added to the agent's `dailyProfit` on the **redemption date**.
* **Tracking**: The market ID is added to the day's `profitParticipants` to mark that a win was realized for this market.

---

## Common Queries

### Agent PnL & Involved Markets
Track an agent's financial performance and see which markets were settled or paid out on a given day.
```graphql
{
  dailyProfitStatistics(where: { traderAgent: "0x..." }, orderBy: date) {
    date
    totalBets
    totalTraded
    dailyProfit
    profitParticipants {
      id
      metadata {
        title
      }
    }
  }
}
```

### Agent Statistics
```graphql
{
  traderAgent(id: "0x...") {
    serviceId
    firstParticipation
    lastActive
    totalBets
    totalTraded           # All bets volume
    totalTradedSettled    # Settled markets only
    totalPayout
  }
}
```

### Agent's Market Participation
```graphql
{
  marketParticipants(where: { traderAgent: "0x..." }) {
    question {
      id
      metadata {
        title
        outcomes
      }
    }
    totalBets
    totalTraded
    totalTradedSettled
    totalPayout
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
    totalTraded           # All bets volume
    totalTradedSettled    # Settled markets volume only
    totalPayout
  }
}
```

## Development

### Project Structure
* `src/service-registry-l-2.ts`: Agent registration (service ID 86 only)
* `src/conditional-tokens.ts`: Condition preparation and payout redemption logic
* `src/ctf-exchange.ts`: Order tracking from CTF Exchange (agents as makers)
* `src/uma-mapping.ts`: Market metadata extraction and resolution handling
* `src/utils.ts`: Utility functions for daily statistics and entity management
* `schema.graphql`: GraphQL schema

### Important Implementation Details

**CTF Exchange Integration**: Our agents operate as **makers** in the Polymarket CTF Exchange. This means that when tracking OrderFilled events, we identify agents via `event.params.maker`
- The maker perspective determines how we interpret asset flows:
  - **Buying**: `makerAssetId = 0` (USDC) → receives outcome tokens
  - **Selling**: `makerAssetId = token` (outcome tokens) → receives USDC

### Performance Optimizations
The subgraph implements high-performance patterns to handle large volumes of trading data:
* **Caching Strategy**: The `handleQuestionResolved` handler uses internal `Map` caches to store `TraderAgent`, `MarketParticipant`, and `DailyProfitStatistic` entities during execution. This ensures each entity is loaded from the database once and saved once, regardless of the number of bets being processed.
* **Batch Saves**: Using the `saveMapValues()` utility, the subgraph performs bulk updates at the end of execution to minimize I/O overhead.
* **Selective Indexing**: To keep the database lean, the subgraph returns early if a market is not binary or if an agent is not registered via `ServiceRegistryL2`.

### Setup & Deployment
Check the [root README](/README.md) for build and deployment instructions.
