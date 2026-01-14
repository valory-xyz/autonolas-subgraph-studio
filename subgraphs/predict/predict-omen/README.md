# Autonolas Predict Omen Subgraph

A streamlined GraphQL API for tracking prediction markets and Autonolas agent performance on Gnosis Chain.

## Core Business Rules

1.  **Selective Tracking**: 
    * **Agents**: Only tracks agents registered through the `ServiceRegistryL2` contract.
    * **Markets**: Only indexes binary markets created by whitelisted creator agents.
2.  **Market Lifecycle**: Markets are typically open for **4 days**. Payouts generally occur **24+ hours** after closing.
3.  **Accounting & Statistics**:
    * **Settlement-Based Totals**: Global and agent `totalTraded` and `totalFees` are updated **only when a market closes** (settles), not at the time of the bet.
    * **Profit Attribution**:
        * **Losses** are recorded on the **market settlement day** (for all incorrect bets).
        * **Wins** are recorded on the **payout redemption day**.
4.  **No Arbitration / Single Answer**: We assume a simplified oracle flow with **no arbitration**. The subgraph expects `LogNewAnswer` to occur only once per question. Events like `LogAnswerReveal` or `LogNotifyOfArbitrationRequest` are not expected, and tracked only for debugging.
5.  **Invalid Markets**: If a market is closed with an "Invalid" answer from the oracle, it is treated as a settlement. Because the invalid answer will not match the agents' `outcomeIndex`, spends (amount + fees) are automatically deducted as losses on the market settlement day.
6.  **Profit Participants & Fee Analysis**: The `DailyProfitStatistic` entity maintains a list of `profitParticipants` (market IDs). This allows for granular downstream analysis, such as calculating **Mech fees** separately by correlating these market IDs with their titles or external metadata.

---

## Primary Entities

### TraderAgent
Represents an Autonolas trading agent. It tracks cumulative performance metrics.
* `totalTraded` / `totalFees`: Volume/Fees for **settled** markets only.
* `totalPayout`: All xDAI reclaimed by the agent via redemptions.

### Bet
An individual trade (Buy or Sell).
* `amount`: Positive for buys, negative for sells.
* `countedInTotal`: Flag ensuring volume is added to totals only once (at settlement).
* `countedInProfit`: Flag ensuring PnL impact is processed only once (either at settlement or payout).

### DailyProfitStatistic
Tracks day-to-day performance for an agent.
* **Activity**: `totalTraded` reflects volume **placed** on that specific day.
* **PnL**: `dailyProfit` is adjusted on the day of settlement (losses) or payout (wins).
* **Profit Participants**: List of market IDs that contributed to the PnL on this specific date.

---

## Technical Data Flow

The subgraph uses two primary handlers to manage the transition from "Active Bet" to "Realized PnL":

### 1. Market Closing (`handleLogNewAnswer`)
Triggered when the Oracle provides the final answer.
* **Update Totals**: It iterates through all market bets. If `countedInTotal` is false, it increments `totalTraded` and `totalFees` for the Agent and the Global state.
* **Realize Losses**: For every **incorrect** bet (where `outcomeIndex != answer`), the cost (`amount + fee`) is subtracted from the agent's `dailyProfit` for the **settlement date**.
* **Tracking**: The market ID is added to the day's `profitParticipants` to mark that a loss was realized for this market.



### 2. Payout Redemption (`handlePayoutRedemption`)
Triggered when an agent claims winnings.
* **Net Profit Calculation**: The subgraph identifies the costs (`amount + fee`) of the winning bets that haven't been "counted in profit" yet.
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
    dailyProfit
    profitParticipants {
      id
      question # Used to correlate and calculate Mech fees
    }
  }
}
```

### Global Statistics
```graphql
{
  globals {
    totalActiveTraderAgents
    totalBets
    totalTraded # Settled volume only
    totalPayout
  }
}
```

## Development

### Performance Optimizations
The subgraph implements high-performance patterns to handle large volumes of trading data:
* **Caching Strategy**: The `handleLogNewAnswer` handler uses internal `Map` caches to store `TraderAgent`, `MarketParticipant`, and `DailyProfitStatistic` entities during execution. This ensures each entity is loaded from the database once and saved once, regardless of the number of bets being processed.
* **Batch Saves**: Using the `saveMapValues()` utility, the subgraph performs bulk updates at the end of execution to minimize I/O overhead.
* **Selective Indexing**: To keep the database lean, the subgraph returns early if a market creator is not on the whitelist or if an agent is not registered via `ServiceRegistryL2`.

### Project Structure
* `src/service-registry-l-2.ts`: Handles agent registration and multisig creation.
* `src/conditional-tokens.ts`: Manages condition preparation and payout redemption logic.
* `src/realitio.ts`: Processes oracle answers, updates market status, and triggers settlement accounting.
* `src/FixedProductMarketMakerMapping.ts`: Records real-time buy/sell activity and updates daily volume stats.

### Setup & Deployment
** Check in the [root README](/README.md).**