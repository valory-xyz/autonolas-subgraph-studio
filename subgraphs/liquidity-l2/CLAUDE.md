# Liquidity L2 Subgraph — Technical Reference

Tracks Balancer V2 pool reserves and BPT (Balancer Pool Token) supply for OLAS liquidity pools across 6 L2 chains. Uses the template pattern for multi-network deployment.

Part of the broader POL (Protocol Owned Liquidity) tracking system. See [../liquidity/README.md](../liquidity/README.md) for the full POL picture.

## Architecture Overview

### Directory Structure
```
subgraphs/liquidity-l2/
├── schema.graphql
├── subgraph.template.yaml           # Template with {{ network }}, {{ BalancerPool.address }}, {{ BalancerPool.startBlock }}
├── networks.json                    # Per-network pool addresses and start blocks
├── subgraph.{network}.yaml          # Generated per-network manifests (6 networks)
├── src/
│   ├── mapping.ts                   # BPT Transfer handler with Vault contract calls
│   └── utils.ts                     # Constants, helpers, get-or-create
├── tests/
│   ├── mapping.test.ts              # 7 Matchstick tests
│   ├── mapping-utils.ts             # Event factory (createBPTTransferEvent)
│   └── test-helpers.ts              # Test constants, pool ID
├── package.json                     # graph-cli ^0.97.0, graph-ts ^0.38.0
└── tsconfig.json
```

### Supported Networks

5 pools are Balancer V2 Weighted Pools (50/50), using the Balancer V2 Vault at `0xBA12222222228d8Ba445958a75a0704d566BF2C8`. Celo is an **Ubeswap (UniswapV2)** pair — handled as a special case with a manual manifest.

| Network | Pool (LP) Address | Pair | DEX | Start Block |
|---------|-------------------|------|-----|-------------|
| Gnosis | `0x79C872Ed3Acb3fc5770dd8a0cD9Cd5dB3B3Ac985` | OLAS-WXDAI | Balancer V2 | 30,396,445 |
| Polygon (matic) | `0x62309056c759c36879Cde93693E7903bF415E4Bc` | OLAS-WMATIC | Balancer V2 | 51,626,717 |
| Arbitrum One | `0xAF8912a3C4f55a8584B67DF30ee0dDf0e60e01f8` | OLAS-WETH | Balancer V2 | 175,754,394 |
| Optimism | `0x5bb3e58887264b667f915130fd04bbb56116c278` | WETH-OLAS | Balancer V2 | 117,547,761 |
| Base | `0x5332584890d6e415a6dc910254d6430b8aab7e69` | OLAS-USDC | Balancer V2 | 12,416,046 |
| Celo | `0x2976Fa805141b467BCBc6334a69AffF4D914d96A` | CELO-OLAS | Ubeswap (UniswapV2) | 27,100,181 |

---

## Schema Reference

### PoolMetrics (mutable)
Singleton per network — tracks pool reserves and BPT supply.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | Pool (BPT) contract address |
| poolId | `Bytes!` | Balancer V2 pool ID (bytes32), fetched via `pool.getPoolId()` |
| token0 | `Bytes!` | First token address, from `vault.getPoolTokens()` |
| token1 | `Bytes!` | Second token address |
| reserve0 | `BigInt!` | First token balance in pool (wei) |
| reserve1 | `BigInt!` | Second token balance in pool (wei) |
| totalSupply | `BigInt!` | BPT total supply (minted - burned) |
| totalMinted | `BigInt!` | Cumulative BPT minted |
| totalBurned | `BigInt!` | Cumulative BPT burned |
| lastUpdatedBlock | `BigInt!` | |
| lastUpdatedTimestamp | `BigInt!` | |
| lastUpdatedTransaction | `Bytes!` | |

### BPTTransfer (immutable)
Individual BPT transfer event.

| Field | Type | Notes |
|-------|------|-------|
| id | `Bytes!` | `txHash.concatI32(logIndex)` |
| from | `Bytes!` | Sender address |
| to | `Bytes!` | Recipient address |
| value | `BigInt!` | BPT transferred (wei) |
| blockNumber | `BigInt!` | |
| blockTimestamp | `BigInt!` | |
| transactionHash | `Bytes!` | |

---

## Event Handlers

### handleBPTTransfer
**File**: `src/mapping.ts` | **Event**: `Transfer(indexed address, indexed address, uint256)`

Shared handler for all 6 chains (both Balancer and Ubeswap pools). On each LP Transfer:
1. Creates immutable `BPTTransfer` entity
2. **Mint detection**: `from == 0x0` → increments `totalSupply` and `totalMinted`
3. **Burn detection**: `to == 0x0` → decrements `totalSupply`, increments `totalBurned`
4. **Reserve fetch (mint/burn only, Balancer chains)**: On mint or burn, calls `pool.getPoolId()` then `vault.getPoolTokens(poolId)` to get absolute token balances. On Celo (Ubeswap), these calls fail silently via `try_` — reserves come from `handleUniswapSync` instead.
5. Updates `PoolMetrics` with fresh reserves, token addresses, and supply

### handleUniswapSync
**File**: `src/mapping.ts` | **Event**: `Sync(uint112, uint112)` | **Celo only**

Handles reserve updates for the Celo Ubeswap (UniswapV2) pool:
1. Reads `reserve0` and `reserve1` directly from the Sync event params
2. On first invocation, populates `token0`/`token1` addresses via `pair.token0()`/`pair.token1()` contract calls
3. Updates `PoolMetrics` with fresh reserves and timestamp

### Design Decisions

- **Celo special case**: The Celo CELO-OLAS pool is an Ubeswap (UniswapV2 fork) pair at `0x2976Fa805141b467BCBc6334a69AffF4D914d96A`, not a Balancer V2 pool. It uses `Sync` events for reserves and `getReserves()` / `token0()` / `token1()` instead of `getPoolId()` / `getPoolTokens()`. The Celo manifest (`subgraph.celo.yaml`) is written manually, not generated from the template.
- **Contract calls only on mint/burn (Balancer)**: Regular transfers don't change pool reserves, so calling `getPoolTokens()` on every transfer would waste indexing resources.
- **Why Transfer events + contract calls (not Vault events)**: Indexing the Vault's `PoolBalanceChanged` would process ALL Balancer pools on the chain — very expensive.
- **Absolute reserves via `getPoolTokens()` (Balancer) / `Sync` event (Celo)**: Both approaches give current balances, no accumulation needed.
- **Reserves only update on join/exit (Balancer) or every swap (Celo)**: On Balancer chains, reserves only update on mint/burn. On Celo, Sync fires on every swap too, giving more frequent updates.

---

## Utility Functions

All in `src/utils.ts`:

| Function | Purpose |
|----------|---------|
| `isZeroAddress(address)` | Check for zero address (mint/burn detection) |
| `getOrCreatePoolMetrics(poolAddress)` | Load-or-create singleton keyed by pool address |

### Constants
| Constant | Value |
|----------|-------|
| `BALANCER_VAULT` | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| `ZERO_ADDRESS` | `0x0000000000000000000000000000000000000000` |

---

## Multi-Network Pattern

Uses the **Template Pattern** for 5 Balancer chains, plus a **manual manifest** for Celo:

1. `networks.json`: Pool address and startBlock for Gnosis, Polygon, Arbitrum, Optimism, Base
2. `subgraph.template.yaml`: Placeholders `{{ network }}`, `{{ BalancerPool.address }}`, `{{ BalancerPool.startBlock }}`
3. `scripts/generate-manifests.js` (at repo root): Generates `subgraph.<network>.yaml` per network
4. `subgraph.celo.yaml`: Written manually — uses UniswapV2Pair ABI with both `Transfer` and `Sync` event handlers

### Generating Manifests
```bash
yarn generate-manifests    # Outputs: subgraph.gnosis.yaml, subgraph.matic.yaml, etc. (NOT celo)
```

---

## Configuration

**Single data source per network**: The LP pool contract

| ABI | Used By | Purpose |
|-----|---------|---------|
| BalancerV2WeightedPool | Balancer chains | BPT Transfer events + `getPoolId()` call |
| BalancerV2Vault | Balancer chains | `getPoolTokens(poolId)` call for reserves |
| UniswapV2Pair | Celo | Transfer events + Sync events + `token0()`/`token1()` calls |

All ABIs are included in every manifest for codegen compatibility. The Celo manifest uses UniswapV2Pair as primary ABI; Balancer manifests use BalancerV2WeightedPool.

**Spec**: v1.0.0 | **API**: 0.0.7 | **Pruning**: auto

---

## Development Workflow

```bash
cd subgraphs/liquidity-l2
yarn install               # Install dependencies
yarn generate-manifests    # Generate per-network YAML files from template
yarn codegen               # Generate TypeScript (uses gnosis manifest)
yarn build                 # Compile to WebAssembly (uses gnosis manifest)
```

---

## Testing

**Framework**: Matchstick-as 0.5.0 | **7 tests**

### Test Files
| File | Purpose |
|------|---------|
| `tests/mapping.test.ts` | 7 test cases for `handleBPTTransfer` |
| `tests/mapping-utils.ts` | Event factory (`createBPTTransferEvent`) |
| `tests/test-helpers.ts` | Namespaced constants (`TestAddresses`, `TestValues`, `POOL_ID`) |

### Test Coverage

| Test | What's Covered |
|------|----------------|
| Mint increases BPT total supply | Zero-address → user transfer increments supply and totalMinted |
| Burn decreases BPT total supply | User → zero-address transfer decrements supply, increments totalBurned |
| Fetches pool reserves from Vault | `vault.getPoolTokens()` mock returns reserves, stored correctly |
| Stores token addresses from Vault | token0 and token1 addresses populated from Vault response |
| Stores pool ID | `pool.getPoolId()` mock returns bytes32, stored in PoolMetrics |
| Regular transfer does not change supply | User → user transfer creates BPTTransfer entity but supply unchanged |
| Multiple mints accumulate correctly | Two mints add up in totalSupply and totalMinted |

Contract calls (`getPoolId`, `getPoolTokens`) are mocked via `createMockedFunction`.

### Running Tests
```bash
ln -sf subgraph.gnosis.yaml subgraph.yaml && yarn test; rm -f subgraph.yaml
```

---

### GraphQL Field Names

The Graph auto-generates query field names. Correct queries for this subgraph:

| Entity | Singular Query | Collection Query |
|---|---|---|
| PoolMetrics | `poolMetrics(id: "0x79c872ed3acb3fc5770dd8a0cd9cd5db3b3ac985")` | `poolMetrics_collection` |
| BPTTransfer | N/A (query by filters instead) | `bpttransfers` |

---

## Core Business Rules

### What This Subgraph Tracks

This subgraph indexes the **L2 side** of Olas Protocol Owned Liquidity. 5 chains use Balancer V2 Weighted Pools (50/50); Celo uses an Ubeswap (UniswapV2 fork) pair. The subgraph tracks:

- **LP token supply**: Total minted minus burned. This represents the total number of LP shares in existence for each pool.
- **Pool reserves**: The actual token balances in each pool. On Balancer chains, fetched via `vault.getPoolTokens(poolId)` contract call. On Celo, read directly from UniswapV2 `Sync` events.

The **Treasury does not hold LP tokens on L2 directly** — LP tokens are bridged to Ethereum mainnet where the Treasury accumulates them. Treasury balance tracking happens in the Ethereum mainnet subgraph (`subgraphs/liquidity/`). This subgraph provides the denominator: knowing the total BPT supply and pool reserves on L2, combined with the Treasury's bridged LP balance on L1, gives the Treasury's proportional share of the L2 pool's value.

### How POL Valuation Works Across Chains

1. **L2 subgraph** provides: pool reserves (token0, token1 balances) and BPT total supply
2. **Ethereum subgraph** provides: Treasury's bridged LP balance for each chain
3. **Off-chain aggregation** computes: `Treasury_POL_USD = (bridged_LP_balance / BPT_total_supply) * pool_TVL_USD`

For example, if Gnosis pool has 191K WXDAI + 3.8M OLAS, TVL ~ $384K, and Treasury holds 99.88% of BPT supply via bridged tokens on L1, then Treasury's Gnosis POL ~ $383K.

### Key Accounting Rules

1. **Reserves Only on Mint/Burn (Balancer)**: Contract calls to `vault.getPoolTokens()` are only made when BPT is minted or burned (pool join/exit). Regular user-to-user transfers do not trigger reserve fetches. On Celo, reserves come from every `Sync` event (including swaps).

2. **Mint/Burn Detection**: Transfers from the zero address are mints (liquidity added); transfers to the zero address are burns (liquidity removed).

3. **Underflow Protection**: Burns clamp `totalSupply` to zero if the burn amount exceeds the tracked supply. This guards against data inconsistency from partial-history indexing.

4. **Balancer V2 Architecture (5 chains)**: The pools are Weighted Pools but the reserves are held by the central **Vault** contract (`0xBA12222222228d8Ba445958a75a0704d566BF2C8`, same address on all EVM chains). Each pool has a unique `poolId` (bytes32) that the Vault uses to identify it. The first 20 bytes of the poolId equal the pool contract address.

5. **Ubeswap/UniswapV2 Architecture (Celo)**: The Celo pool (`0x2976Fa805141b467BCBc6334a69AffF4D914d96A`) is a standard UniswapV2 pair. Reserves are emitted in `Sync(uint112, uint112)` events on every swap/join/exit. Token addresses come from `token0()`/`token1()` view functions. No Vault or poolId concept.

6. **No USD Valuation On-Chain**: This subgraph does not compute USD values. Different chains have different paired tokens (WXDAI, WMATIC, WETH, USDC, CELO) requiring different price feeds. USD conversion is deferred to the off-chain aggregation layer.

7. **No Treasury Tracking**: The subgraph does not track who holds LP tokens (no equivalent of `TreasuryHoldings`). It only tracks aggregate supply and pool reserves.

### Unit Conventions

- All token amounts are in wei (18 decimals), except USDC on Base which is 6 decimals
- No USD values in this subgraph
- Token order (token0/token1) is determined by Balancer, not configurable — check the `token0`/`token1` addresses in `PoolMetrics` to know which is which

### Scope Limitations

- **Solana** (Orca pool `CeZ77ti3nPAmcgRkBkUC1JcoAhR8jRti2DHaCcuyUnzR`) is NOT covered — The Graph cannot index Solana
- **Swap-induced reserve changes** are not tracked — only join/exit events update reserves. For balanced 50/50 pools, total value is approximately stable across swaps
- Start blocks are set to actual pool contract creation blocks on each chain
