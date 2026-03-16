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

All pools are Balancer V2 Weighted Pools (50/50). The Balancer V2 Vault is at `0xBA12222222228d8Ba445958a75a0704d566BF2C8` on all chains.

| Network | Pool (BPT) Address | Pair | Start Block |
|---------|-------------------|------|-------------|
| Gnosis | `0x79C872Ed3Acb3fc5770dd8a0cD9Cd5dB3B3Ac985` | OLAS-WXDAI | 30,396,445 |
| Polygon (matic) | `0x62309056c759c36879Cde93693E7903bF415E4Bc` | OLAS-WMATIC | 51,626,717 |
| Arbitrum One | `0xAF8912a3C4f55a8584B67DF30ee0dDf0e60e01f8` | OLAS-WETH | 175,754,394 |
| Optimism | `0x5bb3e58887264b667f915130fd04bbb56116c278` | WETH-OLAS | 117,547,761 |
| Base | `0x5332584890d6e415a6dc910254d6430b8aab7e69` | OLAS-USDC | 12,416,046 |
| Celo | `0x2976Fa805141b467BCBc6334a69AffF4D914d96A` | CELO-OLAS | 27,100,181 |

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

## Event Handler

### handleBPTTransfer
**File**: `src/mapping.ts` | **Event**: `Transfer(indexed address, indexed address, uint256)`

On each BPT Transfer:
1. Creates immutable `BPTTransfer` entity
2. **Mint detection**: `from == 0x0` → increments `totalSupply` and `totalMinted`
3. **Burn detection**: `to == 0x0` → decrements `totalSupply`, increments `totalBurned`
4. **Reserve fetch**: Calls `pool.getPoolId()` then `vault.getPoolTokens(poolId)` to get absolute token balances
5. Updates `PoolMetrics` with fresh reserves, token addresses, and supply

### Why Transfer Events + Contract Calls (not Vault events)

- Indexing the Vault's `PoolBalanceChanged` would process ALL Balancer pools on the chain — very expensive
- BPT Transfer events are scoped to our specific pool contract
- `vault.getPoolTokens()` returns absolute reserves (not deltas), so we don't need to accumulate
- Reserves only update on join/exit (not swaps), but total pool value is approximately stable across swaps for balanced pools

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

Uses the **Template Pattern** (shared with staking, service-registry, tokenomics-l2):

1. `networks.json`: Pool address and startBlock per network
2. `subgraph.template.yaml`: Placeholders `{{ network }}`, `{{ BalancerPool.address }}`, `{{ BalancerPool.startBlock }}`
3. `scripts/generate-manifests.js` (at repo root): Generates `subgraph.<network>.yaml` per network

### Generating Manifests
```bash
yarn generate-manifests    # Outputs: subgraph.gnosis.yaml, subgraph.matic.yaml, etc.
```

---

## Configuration

**Single data source per network**: The BPT pool contract

| ABI | Purpose |
|-----|---------|
| BalancerV2WeightedPool | BPT Transfer events + `getPoolId()` call |
| BalancerV2Vault | `getPoolTokens(poolId)` call for reserves |

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

## Implementation Notes

- All token amounts are in wei (18 decimals, except USDC on Base which is 6 decimals)
- No USD valuation in this subgraph — computed off-chain by aggregation layer
- No treasury tracking — bridged LP token balances are tracked on Ethereum mainnet (see `subgraphs/liquidity/`)
- Reserves update only on BPT mint/burn (join/exit), not on swaps
- Solana (Orca pool) is NOT covered — The Graph cannot index Solana
- Start blocks are set to the actual pool contract creation blocks on each chain
