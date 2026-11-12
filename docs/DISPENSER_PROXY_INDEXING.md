# New Dispenser proxy indexing — draft

This change prepares indexing only. The new Dispenser is deployed but staking claims are paused and activation is pending. Keep the production indexer and consumers on their current deployments.

## Source

- Ethereum proxy: `0x78Bd94F48CAe623CC74828eCbFEBE3bDF428D83D`, start block **26397771**.
- [Creation transaction](https://eth.blockscout.com/tx/0x15ac4b34d1ba94fbefa135fd81b35dedf188d04117f16efdf431f4e79f3243f1).
- [Deployment ABI](https://github.com/valory-xyz/autonolas-tokenomics/blob/0a5ac87da7fa557b32596e74302ea93d9f1f9f2c/abis/0.8.30/Dispenser.json), copied as the ABI array into `abis/DispenserProxy.json`.
- Studio main baseline: `4ca8d119c75f08e16437a41cce31f7d9a4e6ea67`.

V1/V2 sources remain intact. The new source adds `ImplementationUpdated` and excludes the removed `TokenomicsUpdated`/`StakingParamsUpdated` events. Identical event layouts reuse existing handlers. VoteWeighting is not a source in the current governance subgraph; L2 holder indexers need no bridge-route source changes.

## Claims and accounting limits

Raw claim entities preserve emitted incentive, actual transfer and returned amounts, including withheld-covered claims with zero transfer and nonzero incentive. They do not add these amounts together. Batch children distinguish source, transaction/log and index. New raw claim records expose the proxy in the optional `dispenser` field; legacy records keep their existing shape/IDs.

**Epoch totals are not ready for production cutover.** Claim events aggregate several epochs without emitting a per-epoch allocation. The legacy `lastClaimedEpoch - 1` shortcut would assign the whole amount to one epoch. The new handlers preserve raw events and do not update `StakingIncentive` or `Epoch` totals. Consumers must not interpret absent new-source rollups as zero claims.

## Before approval and production cutover

- Run all Matchstick tests in CI. New fixtures cover upgrades, full/partial withheld coverage, returned-only claims, several batches in one transaction, full-width chain IDs and the absence of fabricated epoch allocations. These do not establish complete epoch accounting.
- Resolve and test per-epoch claim/return attribution, including multi-epoch claims, claim-before-retain/retain-before-claim, zero-weight refunds and carried incentives. Reconcile with Tokenomics `StakingRefunded` and Dispenser `Retained`; do not count the same refund twice. This is required work before production cutover, not implemented by this draft.
- Reconcile legacy history and new-source events against receipts/archive calls on a separate full-index deployment. Confirm consumers' old/new interval policy and epoch totals.
- Confirm activation and production cutover explicitly. No deployment, activation transaction or endpoint/consumer switch is performed by this PR.

Studio requires a fresh deployment and full reindex for this plan. A staging index can capture configuration events from proxy creation while claims remain paused; indexing a deployment is not protocol activation.
