# OLAS-ETH Liquidity Pool Subgraph

Tracks liquidity metrics for the OLAS-ETH Uniswap V2 pool on Ethereum mainnet. Monitors LP token supply (mint/burn), treasury holdings, and pool reserves (OLAS/ETH).

## Architecture Overview

### Directory Structure
```
subgraphs/liquidity/
├── schema.graphql
├── subgraph.yaml          # prune: auto enabled
├── src/
│   ├── mapping.ts         # Event handlers (handleLPTransfer, handleSync)
│   └── utils.ts           # Helpers, constants, get-or-create patterns
└── package.json           # graph-cli ^0.97.0, graph-ts ^0.38.0
```

### Contract (Ethereum Mainnet)

| Contract | Address | Start Block |
|----------|---------|-------------|
| OLAS-ETH LP Token (ERC20 + UniswapV2Pair) | `0x09D1d767eDF8Fa23A64C51fa559E0688E526812F` | 17,679,229 |

Same contract address is used for both data sources — it's a Uniswap V2 pair contract that emits both ERC20 `Transfer` and `Sync` events.

### Key Address

- **Treasury**: `0xa0DA53447C0f6C4987964d8463da7e6628B30f82` — LP tokens owned by this address represent protocol-owned liquidity

---

## Schema Reference

### LPTransfer (immutable)
Individual LP token transfer event.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | `txHash.concatI32(logIndex)` |
| from | `Bytes!` | Sender address |
| to | `Bytes!` | Recipient address |
| value | `BigInt!` | LP tokens transferred (wei) |
| blockNumber | `BigInt!` | |
| blockTimestamp | `BigInt!` | |
| transactionHash | `Bytes!` | |

### PoolReserves (mutable)
Current pool reserves — single entity per pool address.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Pool contract address |
| reserve0 | `BigInt!` | OLAS reserves (wei) |
| reserve1 | `BigInt!` | ETH reserves (wei) |
| lastSyncBlock | `BigInt!` | |
| lastSyncTimestamp | `BigInt!` | |
| lastSyncTransaction | `Bytes!` | |

### TreasuryHoldings (mutable)
Treasury LP token balance tracker — single entity keyed by treasury address.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Treasury address |
| currentBalance | `BigInt!` | Current LP token balance |
| totalAcquired | `BigInt!` | Cumulative tokens received |
| totalSold | `BigInt!` | Cumulative tokens sent out |
| firstTransactionTimestamp | `BigInt!` | |
| lastTransactionTimestamp | `BigInt!` | |
| transactionCount | `Int!` | |

### LPTokenMetrics (mutable)
Singleton aggregate metrics (id: `"global"`).

| Field | Type | Notes |
|-------|------|-------|
| totalSupply | `BigInt!` | Current total LP supply (minted - burned) |
| totalMinted | `BigInt!` | Cumulative minted |
| totalBurned | `BigInt!` | Cumulative burned |
| treasurySupply | `BigInt!` | LP tokens held by treasury |
| treasuryPercentage | `BigInt!` | Treasury % in basis points (10000 = 100%) |
| currentReserve0 | `BigInt!` | Current OLAS reserves |
| currentReserve1 | `BigInt!` | Current ETH reserves |
| lastUpdated | `BigInt!` | |
| firstTransferTimestamp | `BigInt!` | |

---

## Event Handlers

### 1. handleLPTransfer
**File**: `src/mapping.ts` | **Event**: `Transfer(indexed address, indexed address, uint256)`

- Creates immutable `LPTransfer` entity for every transfer
- **Mint detection**: `from == 0x0` → increments `totalSupply` and `totalMinted`
- **Burn detection**: `to == 0x0` → decrements `totalSupply`, increments `totalBurned`
- **Treasury tracking**: If `to` is treasury → `updateTreasuryHoldings(amount, isIncoming=true)`; if `from` is treasury → `updateTreasuryHoldings(amount, isIncoming=false)`
- After each transfer: recalculates `treasuryPercentage` = `treasurySupply * 10000 / totalSupply`

### 2. handleSync
**File**: `src/mapping.ts` | **Event**: `Sync(uint112, uint112)`

- Updates `PoolReserves` entity with current `reserve0` (OLAS) and `reserve1` (ETH)
- Updates `LPTokenMetrics.currentReserve0` and `currentReserve1`

---

## Utility Functions

All in `src/utils.ts`:

| Function | Purpose |
|----------|---------|
| `getDayTimestamp(timestamp)` | Truncates to UTC midnight: `timestamp / 86400 * 86400` |
| `isZeroAddress(address)` | Check for zero address (mint/burn detection) |
| `isTreasuryAddress(address)` | Check for treasury address |
| `calculatePercentageBasisPoints(num, denom)` | Returns `num * 10000 / denom`, zero-safe |
| `getOrCreateLPTokenMetrics()` | Singleton load-or-create (id: `"global"`) |
| `getOrCreateTreasuryHoldings()` | Load-or-create keyed by treasury address |
| `getOrCreatePoolReserves(poolAddress)` | Load-or-create keyed by pool address |
| `updateTreasuryHoldings(amount, isIncoming, timestamp)` | Updates balance, cumulative totals, timestamps, count |
| `updateGlobalMetricsAfterTransfer(amount, isMint, isBurn, timestamp)` | Updates supply, treasury %, timestamps |
| `updateGlobalMetricsAfterSync(reserve0, reserve1, timestamp)` | Updates reserve fields on global metrics |

---

## Key Metrics Calculated

1. **Total LP Supply**: `totalMinted - totalBurned` (tracked via mint/burn Transfer events)
2. **Treasury Supply**: Current LP tokens held by treasury address
3. **Protocol-owned Liquidity %**: `treasurySupply * 10000 / totalSupply` (basis points)
4. **Pool Reserves**: OLAS (`reserve0`) and ETH (`reserve1`) from Uniswap Sync events

---

## Configuration (subgraph.yaml)

| Data Source | ABI | Events | Handler |
|-------------|-----|--------|---------|
| OLASETHLPToken | ERC20 | `Transfer` | `handleLPTransfer` |
| OLASETHPair | UniswapV2Pair | `Sync` | `handleSync` |

**Spec**: v1.0.0 | **API**: 0.0.7 | **Network**: mainnet | **Pruning**: auto

**Note**: Both data sources point to the same contract address — the Uniswap V2 pair emits both ERC20 and Sync events. The `entities` list in subgraph.yaml references `DailyLPSupplyChange`, `ReservesSnapshot`, and `DailyMetrics` which are NOT in the schema — these are stale references (no impact on functionality).

---

## Implementation Notes

- All token amounts are in wei (18 decimals)
- Treasury percentage is stored in basis points (10000 = 100%)
- Reserves: `reserve0` = OLAS, `reserve1` = ETH
- No tests currently exist for this subgraph
- No daily aggregation entities — only current-state tracking
- Single network (Ethereum mainnet), no template pattern needed
