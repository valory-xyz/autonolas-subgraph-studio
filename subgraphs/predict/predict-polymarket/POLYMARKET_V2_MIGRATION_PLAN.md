# Polymarket v2 Migration

Status: **Re-indexing from scratch** (graft attempt failed; see "History")
v2 cutover: 2026-04-28 ~11:00 UTC

## What changed at cutover

| Concern               | v1                                             | v2                                                    |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Standard CTF Exchange | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982e`   | `0xE111180000d2663C0091e4f400237545B87B996B`          |
| NegRisk CTF Exchange  | `0xC5d563A36AE78145C45a50134d48A1215220f80a`   | `0xe2222d279d744050d28e00520010520000310F59`          |
| ConditionalTokens     | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`   | unchanged                                             |
| NegRiskAdapter        | `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`   | unchanged                                             |
| Collateral (UI)       | USDC.e                                         | pUSD (6-dec, 1:1 USDC-backed; `ctfCollateral` is still USDC.e under the hood, so position IDs survive) |
| `OrderFilled` ABI     | `makerAssetId/takerAssetId`                    | `side` (uint8) + `tokenId` + new `builder`/`metadata` |
| `TokenRegistered`     | emitted                                        | **removed** — derive tokenIds via eth_call (see below) |

## Implementation

- **`src/ctf-exchange-v2.ts`** — `handleOrderFilledV2`. Reads `side` (0=BUY/1=SELL) and `tokenId` directly; normalizes to `processTradeActivity`.
- **`src/conditional-tokens.ts`** — `handleConditionPreparation` derives both outcome tokenIds via eth_call:
  ```
  collectionId_i = ConditionalTokens.getCollectionId(0x0, conditionId, indexSet_i)
  tokenId_i      = ConditionalTokens.getPositionId(collateral, collectionId_i)
  ```
  Branches on `oracle`: NegRiskAdapter → collateral = NegRiskAdapter; otherwise USDC.e. Writes `TokenRegistry` rows the same way `handleTokenRegistered` did. ~2 eth_calls per new binary market — negligible.
- **`src/collateral-adapter.ts`** — `handlePositionsRedeemed` for both `CtfCollateralAdapter` and `NegRiskCtfCollateralAdapter`. Post-cutover, redemptions are routed through these adapters so the Safe receives pUSD directly. The legacy CTF / NegRiskAdapter `PayoutRedemption` events still fire post-cutover but with `redeemer = adapter` — those fall through `TraderAgent.load == null` in the existing handlers, so no double-counting.
- **v1 handlers (`ctf-exchange.ts`, `neg-risk-mapping.ts`)** — unchanged.

## Manifest layout (see `subgraph.yaml` for source of truth)

- v1 exchanges: `endBlock: 86750000` (~cutover + 2 weeks safety buffer; bump if v1 stays live longer).
- v2 exchanges: `startBlock: 85952819` (a few days before cutover; no v2 events fire until cutover, so the extra range is cheap).
- Collateral adapters, two address pairs (Polymarket directed redemptions through one set for a short window, then switched to a different set):
  - **Current** (live from 2026-05-01 15:00 UTC onward — the relayer cutoff for the old adapters), `startBlock: 86263778`:
    - `CtfCollateralAdapter`: `0xAdA100Db00Ca00073811820692005400218FcE1f`
    - `NegRiskCtfCollateralAdapter`: `0xadA2005600Dec949baf300f4C6120000bDB6eAab`
  - **Old** (live ~2026-04-30 → 2026-05-01), pinned to `[86219367, 86263778]` so coverage is contiguous with the current pair:
    - `CtfCollateralAdapterOld`: `0xADa100874d00e3331d00f2007a9c336a65009718`
    - `NegRiskCtfCollateralAdapterOld`: `0xAdA200001000ef00D07553cEE7006808F895c6F1`

## History

### Initial plan: graft-on-top

The first plan was to graft the v2 deployment on top of the paused production base
(`QmZXBjgbyCNCrrB51kEPtNHtzzwwNHy8GnSGmLFHFGDc5Z` @ 85952819) to avoid a full
re-index. That deploy went through and ran for several days post-cutover.

### Adapter backfill graft (failed)

When the collateral adapters were added (this branch), we tried a second graft on top
of the v2-grafted deployment (`QmUMaqgrL8tTJmrSTbajqG6TFhdL2etFYJQ4EjmdjuaN6T` @ 86397457).
graph-node refused to start with:

```
Failed to start subgraph, code: SubgraphStartFailure,
error: store error: Unexpected null for non-null column,
runner_index: 31, sgd: 51
```

Schema was identical to the base, so this wasn't a missing-column issue. We didn't
chase the root cause further; the manifest was already structured to handle a clean
re-index (current + `*Old` adapter pairs cover `[86219367, ∞)` contiguously), so we
dropped grafting and committed to indexing from scratch.

### Decision

Drop `features: grafting` and the `graft:` block. Re-index from scratch. The
`*Old` adapter dataSources backfill the historical `[86219367, 86263778]` window
that the original graft-only deploy silently dropped.

## Open

- v2 `startBlock` (`85952819`) could be bumped to the actual v2 cutover block
  (~`86145578`) to shave a few days of empty scanning off the re-index. Not
  blocking.
