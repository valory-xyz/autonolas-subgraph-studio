# BabyDegen Base (Basius) Subgraph

Tracks the **Basius** babydegen agent's portfolio performance on **Base**. Port of
`babydegen-optimism` repointed to Base + **Aerodrome**, plus **Aero** (the merged protocol Basius
moved to in optimus v0.13.10; see "Aero" below).
Indexing **filters by Olas `agentId == 115`** and tracks every Basius service (currently
607/610/611/612 on Base), mirroring optimism's `OPTIMUS_AGENT_ID` filter.

> **Id note:** 115 is the **agent** id, not a service id. (Service *115* is an unrelated
> 2025 service on the generic agent 9 — an early Divya/Tanya mix-up, resolved on-chain.)

> Status: **Phase 1 complete.** Builds and tests green. Registry, Aerodrome surface (ABI
> compatibility verified vs deployed contracts; LpSugar bootstrap uses `forSwaps`), Chainlink
> feeds, LiFi, v2 PoolFactory, startBlock and cadence all confirmed. AERO is priced off the
> Aerodrome AERO/USDC volatile pool; OLAS dropped (not held). Phase 2 (per-day transactions /
> DAA) is **not** built here — it already lives in the `service-registry` subgraph. See
> `IMPLEMENTATION-PLAN.md`.

## What changed vs babydegen-optimism

| Aspect | Optimism | Base (this subgraph) |
|--------|----------|----------------------|
| Network | `optimism` | `base` |
| DEXs tracked | Velodrome CL + V2, **Aero** (CL, v2), **Uniswap V3**, **Balancer** | **Aerodrome** (CL = Slipstream, v2) + **Aero** (CL, v2) |
| Agent scoping | agent-id filter (`OPTIMUS_AGENT_ID = 40`) + excluded ids | agent-id filter (`BASIUS_AGENT_ID = 115`), all matching services |
| Pricing | Chainlink + DEX | Chainlink (Base feeds) + Aerodrome/Aero pools; whitelisted stables referenced to the USDC feed, USDT/DAI/USDe/USDS via their own feeds |
| Reward token | VELO (Velodrome) / xAERO (Aero) | AERO (legacy) / Aero's AERO |

**Dropped files** (Uniswap V3 / Balancer / manual bootstrap / dead helpers):
`uniV3NFTManager.ts`, `uniV3Pool.ts`, `uniV3Shared.ts`, `balancerVault.ts`,
`balancerShared.ts`, `manualServiceBootstrap.ts`, plus the unused
`veloCLPool.ts` / `veloV2Router.ts` / `veloV2DirectPool.ts`.

**Naming note:** the Velodrome handler files keep their `velo*` names (Aerodrome is a
Velodrome fork with identical ABIs — reused from `abis/defi/Velodrome*` and
`abis/nft/VelodromePositionNFTManager.json`). Only the **consumer-facing** protocol
strings changed: `ProtocolPosition.protocol` is now `aerodrome-cl` / `aerodrome-v2`
(`PROTOCOL_VELODROME_V3` / `PROTOCOL_VELODROME_V2` constants).

## Key contracts (Base mainnet)

| Contract | Address | Notes |
|----------|---------|-------|
| ServiceRegistryL2 | `0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE` | canonical Olas registry on Base |
| Basius services | agentId 115 → 607/610/611/612 | tracked dynamically by agent id, not hardcoded |
| Aerodrome Slipstream NFPM | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` | CL positions (`VeloNFTManager`) |
| Aerodrome Slipstream factory | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` | CL pool discovery |
| Aerodrome LpSugar v3 | `0x69dD9db6d8f8E7d83887A704f447b1a584b599A1` | v2 bootstrap (`VeloV2Sugar`) |
| Aerodrome v2 PoolFactory | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | confirmed |
| LiFi Diamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | CREATE2, same on all EVM |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | primary funding/valuation |
| WETH / OLAS / AERO | `0x4200…0006` / `0x54330d28…` / `0x940181a9…` | |
| Aero NFPM | `0x4857DB576eE0e45F10525eC59527BfD10beeC60b` | Aero CL positions (`AeroNFTManager`, start block 52881675) |
| Aero CL factory | `0x9CB220581b91b0C83223012FE69688b92aD07a76` | `AERO_NFT_MANAGER.factory()` |
| Aero v2 stable / volatile factory | `0x78589E87…EF2D` / `0x8E6a9FCd…76D2` | Aero v2 pool discovery |
| Aero GaugeManager | `0xbF234b32c5e58868243A4a14831626f3EdE7b183` | `GaugeCreated` → Aero v2 pool→gauge map |
| AERO (Aero) | `0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee` | Aero gauge reward token (`AERO_PROTOCOL_AERO`) |

Chainlink feeds (Base, verified on-chain — live, 8 decimals): ETH/USD `0x71041ddd…`,
USDC/USD `0x7e860098…`, USDT/USD `0xf19d560e…`, DAI/USD `0x591e7923…`, USDe/USD `0x790181e9…`,
USDS/USD `0x2330aaE3…` (`constants.ts`).

**startBlock** = `47163056` (earliest agentId-115 service, #607, 2026-06-10) for every data
source except the Aero ones, which start at their deployment: NFPM `52881675`, v2 volatile /
stable factories `52880042` / `52880046`, GaugeManager `52688318`.

### Base reference addresses (NOT indexed by this subgraph)

babydegen tracks via the registry + Safe events, so it does not wire the staking/multisend
contracts. For reference, the corrected Base addresses (Divya's first set were stale
Optimism values): StakingToken `0x2585e63df7BD9De8e058884D496658a030b5c6ce`, ActivityChecker
`0x87C9922A099467E5A80367553e7003349FE50106`, Multisend `0x998739BFdAAdde7C933B942a68053933098f9EDa`.

> **Manifest ABI gotcha.** A handler can only `.bind()` a contract whose ABI is declared
> in the **same data source's** `abis:` list — and this resolves at *index time*, so neither
> `graph build` nor Matchstick catches a missing one (it surfaces as a runtime
> `Could not find ABI for contract "X"` indexing error). Because the shared pricing/refresh
> helpers bind the Chainlink feed and the Aerodrome pools/gauges, **every** data source whose
> handler reaches them must declare those ABIs — not just the pool/NFT templates. In
> particular: token/funding sources need `AggregatorV3Interface` + `VelodromeCLPool` +
> `VelodromeV2Pool` (token pricing via `priceAdapters`), token sources and the `Safe` template
> need `GnosisSafe` (`getThreshold()` for the user-side check), `ServiceRegistryL2` needs
> `AggregatorV3Interface` (`getEthUsd` seeds `firstFundingEthPrice`), and `PortfolioScheduler`
> needs `VeloVoter` + `VeloV2Gauge` + `VeloCLGauge` + `AeroCLGauge` (the snapshot block handler runs
> `refreshAllActivePositions`, which re-binds each position's gauge). Run
> `node scripts/check-subgraph-abis.mjs` to list candidate gaps (it over-approximates
> branch-guarded binds — review against the code).

## Tracked tokens

USDC (native), WETH, AERO (legacy + Aero's), the whitelisted stablecoins BOLD / msUSD / frxUSD /
eUSD / axlUSDC, and USDT / DAI / USDe / USDS (Chainlink-priced, see Aero below). USDC+WETH price off Chainlink; the whitelisted stables are referenced to the USDC feed; **AERO** `0x940181a9…` (the Aerodrome CL-gauge reward token; Aero CL gauges pay Aero's AERO `0x3f5b…a4ee` instead) prices off the Aerodrome
AERO/USDC volatile pool `0x6cdcb1c4…` via the `velodrome_v2` adapter (`tokenConfig.ts`).
**OLAS is not tracked** — Basius holds none and it isn't a trading asset for this agent.

> **AERO gauge rewards (legacy Aerodrome venues; Aero: see below).** Both DEX paths now read claimable AERO from the position's gauge
> into `usdCurrentWithRewards` (→ APR/ROI):
> - **V2** (`refreshVeloV2Position`): resolves the gauge via Aerodrome **Voter** (`gauges(pool)`,
>   `VELO_VOTER`), counts `gauge.balanceOf(safe)` as **staked LP** (so a staked position isn't
>   misread as closed — it had been; fix verified vs Divya's live stake) and adds
>   `gauge.earned(safe)` (selector `earned(address)`). ABIs: `VeloVoter.json`, `VeloV2Gauge.json`.
> - **CL** (`refreshVeloCLPosition`): `gauge.earned(safe, tokenId)` (selector `earned(address,
>   uint256)`). Built in `#156` but **unverified end-to-end** — no live staked Basius Slipstream
>   position yet; a `log.warning` fires if `earned()` reverts on an active position (silent-zero
>   guard). Full runbook + likely fixes: **`AERO-REWARDS-PLAN.md`**.

> **V2 bootstrap pagination.** LpSugar `forSwaps(limit, offset)` walks **raw factory pool
> indices** but returns a **filtered** page (zero-reserve pools dropped), so a page shorter
> than `limit` does NOT mean end-of-list (this early-exit assumption once left ~27.6k of the
> factory's ~28k pool indices unscanned and most Basius LP positions invisible). The bootstrap
> pages up to the v2 factory's `allPoolsLength()` and aborts loudly if that call reverts.
> Entries past the v2 range belong to CL factories and are skipped by the type filter
> (0 = stable, -1 = volatile, positive = CL tickSpacing).

> **V2 entry amounts.** `Transfer(0x0 → safe)` creates the position and stores a
> `PendingMintPosition` keyed by `getVeloV2PositionId` (protocol string from `v2ProtocolFor`: `aerodrome-v2` or `aero-v2`); the
> same-tx `Mint` event then records the real entry amounts (entry USD feeds closed-position
> ROI, so a dropped mint pins ROI/APR at 0). If entry amounts are still zero on a later
> refresh, `refreshVeloV2Position` backfills them from current amounts — keyed on
> `entryAmountUSD == 0` alone, since `entryTimestamp` is always set at creation.

## Aero

Basius moved to Aero (the merged Velodrome/Aerodrome protocol, live 2026-10-22) in optimus
v0.13.10. Aero positions are labelled **`aero-cl` / `aero-v2`**; legacy labels and ids are unchanged.

- **CL** — `AeroNFTManager` reuses the Slipstream handlers except `handleAeroIncreaseLiquidity`
  (Aero's `IncreaseLiquidity` adds `tickLower`/`tickUpper`). The emitting NFPM picks a `CLVenue`
  (manager, CL factory, reward token, label) for the shared `veloCLShared.ts` refresh. Aero's
  CLGauge has no `earned(address,uint256)`: `getAeroCLEarned` checks `stakedContains(agent,
  tokenId)` (unstaked → 0, no revert) and reads `earned(agent, [tokenId])`, paid in Aero's AERO.
- **v2** — both Aero factories (own `PoolCreated` ABI, no indexed `stable`) write a
  `V2PoolVenue` and start an `AeroV2Pool` template (Aero's `Mint` has an indexed `to`; pools have
  no `stable()`). Aero v2 pools have no `gauge()` and the Aero Voter has no `gauges(pool)`, so the
  GaugeManager's `GaugeCreated` builds `AeroGauge { pool → gauge }`, read on every refresh by the
  `aero-v2` branch of `resolveV2Gauge`.
- **Pricing** — Aero's AERO prices off the Aero v2 AERO/USDC volatile pool `0xF634058d…` (`tokenConfig.ts`).
  USDT / DAI / USDe / USDS price off their own Chainlink feeds (priority 1) with
  the Aero CL tickSpacing-1 USDC/USDT pool as USDT's priority-2 fallback. DAI / USDe / USDS are
  feed-only (no pool fallback is configured for them), are not on `usdcReferencedStable`, and are in
  `STABLECOINS`. Bands, priorities, staleness and the depeg flag: see *Pricing* below.

## Schema, core logic, KPIs

Schema and the entire portfolio/ROI/APR/snapshot/population pipeline are **identical** to
babydegen-optimism (network-agnostic). The website KPIs map to existing entities:

- "APR relative to USDC – MA7D" → `DailyPopulationMetric.sma7dAPR`
- "APR relative to ETH – MA7D" → `DailyPopulationMetric.sma7dEthAdjustedAPR`
- per-day ROI (explorer heatmap) → `AgentPortfolioSnapshot.roi`

The `ethAdjusted*` fields are deprecated and equal their unadjusted counterparts.

### Funding and withdrawals (`common.ts`, `tokenBalances.ts`, `safe.ts`)
- Every token in `WHITELISTED_TOKENS` and ETH moves `FundingBalance` (funding in, `totalWithdrawnUsd`
  out), valued at the transfer. The user side (`isUserSide`) is the operator Safe, any Safe (`getThreshold()` answers,
  cached as `AddressType.isSafe`), the tx sender (an EIP-7702 wallet included), or an EOA that is
  not one of `Service.agentInstances`. The Safe itself, its agent EOAs and the zero address never are.
- An outflow to any other contract is a withdrawal only when the receipt shows nothing coming
  back to the Safe: no ERC-20/ERC-721 `Transfer` to it, no WETH `Deposit` for it (wrapping) and no `SafeReceived` it emitted
  (`isWithdrawalRecipient`). With no receipt it is not counted. Token Transfer handlers and the Safe's `ExecutionSuccess` set `receipt: true`;
  the other Safe handlers never read it.
- ETH in comes from `SafeReceived`. ETH out is decoded from the Safe's `execTransaction` calldata
  (`ethSentBySafe`): its Call's value, or each Call of a `multiSend` it delegatecalls. ETH to an
  agent EOA lowers value as a cost. A module execution or a relayed execTransaction is not
  readable; its ETH is not counted and a `SAFE_ETH:` warning is logged. A send to the operator
  Safe is counted once (its `SafeReceived` skips a send the decoder read from the same tx).
- Withdrawals go to `totalWithdrawnUsd`; they never reduce `netUsd`, which equals `totalInUsd`.
  `totalOutUsd` and `fundingOutTxs` are deprecated: no longer written, they stay 0 / empty. A transfer of an unpriced
  token is valued at $0 and logged (`FUNDING:`).

### Pricing (`priceDiscovery.ts`, `priceAdapters.ts`, `tokenConfig.ts`)
- No $1 fallback. With no valid price a token keeps its last valid price with `priceStale = true`
  (logged once, `PRICING:`); a token never priced is 0.
- `getTokenPriceUSD` reads sources by priority; a higher-numbered one only when every better
  source failed. Chainlink answers within `STALE_PRICE_THRESHOLD` are accepted.
- A pool's pair leg is priced from its own token config, never taken as $1: its Chainlink source,
  else its `velodrome_v2` pool when that pool's pair leg has one; otherwise the pool gives no
  price. Feed staleness is judged against the event's block.
- `STABLECOINS` tokens have no lower price bound ($0–1.50; USDC $0–1.05), so a depeg is recorded:
  `depegged` below `DEPEG_THRESHOLD`.
- A stable pool's `getAmountOut` quote is net of the pool's swap fee (about 0.9995 × at the default 5 bps stable fee). The bias is accepted: it is far inside the `DEPEG_THRESHOLD` depeg line. A v2 pool is quoted as stable when
  its `V2PoolVenue` row says so, else when its `stable()` is true (`v2PoolKind`); it is priced from its
  `getAmountOut` quote for one token, not its reserve ratio.

### v2 position cycles (`veloV2Pool.ts`)
- A v2 position is one row per pool, reused across cycles. LP minted into a closed row (seen by
  the LP mint Transfer, before its refresh marks the row active) restarts it: income, exit, costs,
  ROI and entry tracking reset as for a new row, and the Mint records the new entry. The Mint in the
  tx that created or restarted the row (its `entryTxHash`) replaces the entry, including the refresh's
  fallback from current amounts; a top-up Mint adds to it; either way `investmentUSD` = entry +
  `totalCostsUSD`. A partial
  Burn records an exit but leaves the row active, so a later top-up keeps its income. `isActive`
  comes from end-of-block `balanceOf`, so a full exit and re-entry in one block keeps the old cycle
  (accepted).

### CL exits (`veloCLShared.ts`)
- A `DecreaseLiquidity` leaving zero liquidity, or whose `positions()` reverts because the NFT is
  burned later in the same block (`eth_call` reads end-of-block state), closes the position: the
  exit is valued from the event amounts and the stored tokens, decreases in the burn block add up,
  and a `CL exit:` warning is logged. A refresh later in the exit block (e.g. an IncreaseLiquidity
  reading end-of-block zero liquidity) keeps that exit, and any other decrease on a closed row (the
  NFT burned with no exit recorded, or the exit already booked in an earlier block) is skipped and logged.
  A CL transfer out does not close the row (a staked NFT leaves the Safe while still open), so a
  decrease by a wallet the NFT was sent to is still booked as the Safe's exit.

### Position income (`positionIncome.ts`)
- `ProtocolPosition.collectedFees0/1` and `collectedFeesUSD`: every `Collect` first pays out the
  principal `DecreaseLiquidity` released since the last one (`UncollectedPrincipal`, keyed
  `<protocol>-<tokenId>`), wherever it is sent; only the rest, and only to the Safe, is a fee.
- `claimedRewards` / `claimedRewardsUSD`: a reward Transfer from a position's gauge
  (`rewardsContract`) goes to the tokenId of the first `Withdraw(user = Safe, …)` that gauge emits
  after it. With none, a CL claim is split by each active position's `claimableReward` as it stood
  before the block (`ClaimableRewardBeforeBlock`), by liquidity when all are 0; a v2 position takes it all.
- Aero CL (`aero-cl`): from the gauge's `EmissionsClaimed(_account, _tokenId, _recipient,
  _rewardAmount)` with `_recipient` = Safe and a tokenId the Safe owns. A Transfer of
  `rewardTokenFor(PROTOCOL_AERO_CL)` — Aero's AERO `0x3f5b…a4ee` (`AERO_PROTOCOL_AERO`, not the
  `AERO` `0x940181a9…` above), which the gauge mints to the claimer — pays the not-yet-credited
  claims it covers, in log order, each once (`CreditedRewardClaim`). Skipped claims are logged.
- A Withdraw naming a tokenId the Safe does not track is logged, not split. A v2 reward after the
  exit goes to the most recently closed v2 position on that gauge. An `EmissionsClaimed` counts
  only when the position's own gauge emitted it.
- `aero-v2` rewards are not attributed to a position yet; a reward Transfer to a Safe that holds
  or held an `aero-v2` position (rewards are often claimed after the exit) logs a `REWARDS:` warning.
- `grossGainUSD = exitAmountUSD + collectedFeesUSD + claimedRewardsUSD`.

Snapshots fire from the `PortfolioScheduler` block handler at UTC-midnight crossings.
Block-handler interval is `every: 1800` (~1h on Base) — confirmed: a finer interval can't
add snapshots since they only fire on day boundaries.

### Explorer daily metrics (transactions / DAA) — NOT in this subgraph

Per-day transaction counts and daily-active-agents are **already** produced by the
`service-registry` subgraph (which also covers Base): `DailyAgentPerformance.txCount`
(per `agentId` per day, driven by Safe `ExecutionSuccess` / `ExecutionFromModuleSuccess` —
the agreed "transaction" definition) and `DailyUniqueAgents`. The agent-explorer heatmap
should read those for Basius (agentId 115); there is intentionally no duplicate daily-metric
entity here.

## Development

```bash
yarn install && yarn codegen && yarn build && yarn test
```

See the root `CLAUDE.md` for repo-wide conventions. For deeper architecture/handler/price
docs, the optimism `CLAUDE.md` still applies to everything not changed above.
