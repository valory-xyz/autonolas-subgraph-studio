# Staking v0.4 source ABI and indexer behavior

The ABI was compiled from `autonolas-registries` revision
`0e065705af0ca8df84f75f7a19b814c21fa2d083` (the 5 November 2026 review),
`contracts/staking/StakingToken.sol`, with Solidity
`0.8.30+commit.73712a01`, optimizer enabled with 1,000,000 runs and EVM target
`prague`. The pinned solmate submodule is
`8f9b23f8838670afda0fd8983f2c41e8037ae6bc`. This is an ABI-only build, not
bytecode/deployment verification or confirmation of the final release build.

## Reproduce the ABI

Check out the registries revision above and initialize its `lib/solmate`
submodule. From the indexer repository root:

```sh
npm install --prefix /tmp/staking-abi-tools --ignore-scripts --no-audit --no-fund solc@0.8.30
node scripts/generate-staking-v4-abi.cjs /path/to/autonolas-registries /tmp/staking-abi-tools
```

The generator checks the source revision, clean tracked files, solmate revision
and compiler version. No RPC, deployment credentials or deployed address is
needed. The existing legacy `StakingProxy.json` is retained.

## Versioned indexing

Factory discovery selects v0.4 decoding only for `VERSION() == "0.4.0"`.
Legacy version handling is retained, including rejection of unsupported
implementations. New implementations use the existing factory and proxy event
sources; no new factory address or speculative start block is introduced.
Native-funded deployments are outside the planned rollout. Mode is excluded
from the infra rollout and its legacy Graph indexer is unchanged.

- `ServiceStaked.rewardDistributionInfo` records the emitted distribution value.
  Keep its emitted epoch: a refill checkpoint can increment it before the stake.
- `RewardClaimed.reward` is the sum of the actual `receivers` / `rewardAmounts`
  arrays. These optional arrays are retained alongside legacy scalar records.
  They can describe a direct Master Safe payment or multiple recipients.
- `ServiceUnstakedV4` records the new event including `enforced`. There is no
  reward amount in this event. `RewardClaimed` is the sole payout record, even
  on normal unstake. Forced unstaking releases the recorded stake without
  inventing a payout/return amount or overwriting checkpoint earnings.
- `ServicesRebaselined` is keyed by contract and epoch. The following matching
  checkpoint/history records are marked `isRebaseline`; an empty checkpoint
  without the marker remains an ordinary checkpoint. A baseline rolls the epoch
  tracking forward but produces no claimable RewardUpdate or back-pay.
- `ServiceBaselineEvent` retains missing/recovered transitions.
  `ServiceBaselineState` is scoped by contract and service, resets on stake and
  unstake, and never creates rewards. Recovery establishes a baseline, not an
  allocation for the preceding interval. Consumers must still read the contract
  for a pending rebaseline that has not executed; deposits alone are not used
  to infer that state.

Legacy optional fields can remain null. Historical monetary totals retain their
existing token guards. The primary staking indexer does not index wallet ERC20
transfer balances; recipient-aware Pearl history/middleware changes and their
transfer reconciliation are a separate delivery and activation dependency.

## Release and historical recovery

Merge readiness depends on review and CI. Activation additionally requires
confirmation of the final contract build, chain/implementation activation matrix,
deployed indexer verification and consumer acceptance.

Studio requires a fresh deployment and full reindex for these schema additions.
The squid includes an additive database migration with nullable fields for old
rows. Apply it before the new processor/API. Database compatibility alone does
not backfill events or repair previously skipped v0.4 instances: replay from
those instances' factory `InstanceCreated` logs, or perform a separately verified
configuration refresh and backfill. A resume or graft carrying stale state does
not reconstruct the missing history. Verify the migration against the target
PostgreSQL deployment before production use.
