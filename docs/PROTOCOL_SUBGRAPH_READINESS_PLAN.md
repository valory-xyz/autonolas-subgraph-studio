# Protocol changes — subgraph readiness plan

Updated: 6 November 2026. Status: approval draft; implementation, owners and readiness dates are not yet signed off.

## Scope and deployment approaches

There are two ways to apply changes to Graph subgraphs: **full reindexing**, which rebuilds all indexed history, and **grafting**, which copies an existing deployment's state at a chosen block and continues from there. Grafting avoids a full replay when the schema is compatible and earlier history does not need recalculating.

For squids, the two approaches are **full reindexing** and **database migration with redeployment**, which preserves existing data and resumes indexing after any required database changes. The latter is more flexible and can avoid replaying history, provided the change does not require historical backfilling or recalculation.

This plan covers two repositories, whose hosting determines which of these approaches we can use:

- **autonolas-subgraph-studio** contains subgraphs deployed in The Graph Studio. For this plan, changes require a fresh deployment and full reindex; grafting is unavailable.
- **autonolas-subgraph** contains self-hosted Graph subgraphs and squids. Graph grafting is conditional on schema compatibility and a suitable historical block. Squids can retain their database and resume after compatible migrations.

Together, these repositories cover **Ethereum, Gnosis, Base, Polygon, Optimism, Arbitrum, Celo** and **Robinhood**. Mode is excluded because it's no longer supported, its indexers remain unchanged.

## Deployment order of changes affecting indexers

Protocol go-live dates are not yet confirmed. The list below follows the protocol’s planned deployment order: each item names the protocol change, followed by the work needed in our subgraphs and squids:

1. **Marketplace, mech wrappers and factories:** refresh release ABIs; verify request/delivery accounting and factory events.
2. **ServiceManager:** update indexed ERC-8004 wallet clearing.
3. **Staking v0.4:** update staking and Pearl transaction-history decoding before new programmes are used.
4. **New Dispenser:** add its source to Ethereum tokenomics indexing while preserving old history.
5. **V3 liquidity migration:** extend POL and fee accounting for the selected pools and positions.

The protocol documents also mention **Polygon burn-forwarders** and **veto governance**. Neither currently has a confirmed subgraph change: burn-route indexing depends on reporting needs, while veto lifecycle coverage needs assessment when its postponed rollout resumes. Neither is included in the current implementation plan.

## Affected subgraphs and squids

Chains below reflect confirmed hosting and planned migrations. Priority follows the protocol deployment order above.

| Priority / indexer | autonolas-subgraph-studio | autonolas-subgraph |
|---|---|---|
| **1 — Marketplace** | — | **Self-hosted subgraphs:** Ethereum, Gnosis, Optimism, Arbitrum, Celo. **Squids:** Robinhood; Base and Polygon planned this week. Base/Polygon consumers still use self-hosted subgraphs and must move to squids before the new protocol contracts are used. |
| **2 — Service registry** | Ethereum, Polygon, Optimism, Arbitrum, Celo | **Self-hosted subgraph:** Gnosis. **Squids:** Base, Robinhood. |
| **3 — Staking** | Ethereum, Gnosis, Polygon, Optimism, Arbitrum, Celo | **Squids:** Base, Robinhood. |
| **3 — Pearl transactions** | Gnosis, Optimism | **Squids:** Base, Polygon; Robinhood planned this week. |
| **4 — Tokenomics ETH** | Ethereum | — |
| **5 — Liquidity** | Ethereum, Gnosis, Base, Polygon, Optimism, Arbitrum, Celo | Robinhood squid is unchanged: no liquidity-manager migration is planned there. |

### Changes and acceptance checks

**Marketplace**

- Cover the updated Marketplace request/delivery methods and mech wrappers, not only factory additions. Test explicit nonces and deadlines, cap-and-actual pricing, emitted request IDs, actual charged fees and batch accounting. Keep advertised price/cap separate from the amount charged; count each request and delivery once, including mixed zero/nonzero batches.
- Regenerate Marketplace and OlasMech ABIs from the deployment source. Verify `getRequestIdWithNonce` and every new signed-delivery overload before using those ABIs for compatibility checks. Verify both retained legacy calls and the selected new call path; do not infer request IDs or charges from legacy calldata.
- Verify each new factory's actual creation event, arguments and payment type against its release artifact. Add its address, start block and handler/template/subscription; do not select a decoder from its name alone.
- **Release:** self-hosted Graph deployments can graft if compatible; squids can resume after compatible updates/migrations. Deploy before first affected activity. Base/Polygon also need initial squid indexing and consumer cutover. Full replay is needed only if history cannot be recovered through a suitable graft or backfill.
- **Consumers:** Marketplace discovery/deployment, mech-client, mech receivers/wrappers and analytics. Unknown factories or misdecoded deliveries can stop indexing or misreport requests and fees.

**Service registry / ServiceManager**

- Handle `AgentMultisigUpdated` to clear the indexed wallet. Preserve identity association and metadata. Linking a multisig does not authorize a wallet; authorization must follow the explicit wallet event.
- Test termination, same-Safe redeployment, different-Safe redeployment and subsequent wallet authorization. Assert wallet clearing, retained identity/metadata and the final authorized wallet in each applicable sequence.
- Compare all consumed registry/bridger event signatures and arguments with the ServiceManager release code. The supplied review identified no further registry event-signature change; this still needs release-code verification.
- **Release:** Studio full reindex; Gnosis self-hosted graft if compatible; Base/Robinhood squid update/migration. Repair any earlier missed wallet-clearing events before consumers rely on wallet authorization.

**Staking and Pearl transactions — separate deliveries**

- Continue monitoring existing instances alongside new v0.4 instances. Retain each version's decoder and implementation allowlist; add v0.4 factory/implementation discovery without replacing legacy coverage.
- Test `ServicesRebaselined` with an empty `Checkpoint`, `ServiceBaselineMissing` and `ServiceBaselineRecovered`. A rebaseline or recovery establishes a baseline; it must not create a reward for the preceding interval. Do not classify every empty checkpoint as a rebaseline.
- Test first-stake epoch numbering after refill, including the checkpoint's extra epoch increment.
- For Pearl v0.4 migration, test the existing one-argument `stake(serviceId)` call when the Master Safe is both service owner and operator: rewards can be paid directly to the Master Safe. Decode the actual reward-recipient and amount arrays; do not assume an Agent Safe destination or require an Agent-to-Master sweep.
- Cover multiple reward recipients, claims and normal unstakes. Reconcile reward events with ERC20 transfers so each reward and each wallet balance change is counted once. Retain and test legacy-instance reward-destination behavior.
- Run these acceptance checks on the primary staking indexer and the applicable Pearl history path. **Updating staking does not update Pearl transaction history.** Pearl/operate-app must also handle rebaseline/missing-baseline reward eligibility.
- **Release:** Studio full reindex; squids update/migrate and resume. Both old and new instance fixtures must pass before activation. Primary staking coverage blocks new programmes; Pearl history coverage must be ready before Pearl uses v0.4 proxies.

**Ethereum tokenomics / new Dispenser**

- Record the **new proxy address and deployment block**, then refresh the ABI and manifest. Both deployment values are still awaiting protocol handoff; an implementation address is not a substitute for the proxy source.
- Verify `ImplementationUpdated` in the new ABI. The reviewed source removes `TokenomicsUpdated` and `StakingParamsUpdated`; keep their handlers on the old source where applicable and do not expect them from the new source.
- Preserve old sources and history. Test claim-to-epoch attribution and entity uniqueness across old/new Dispensers, including multiple events in one transaction. Event identity must distinguish source and log position, with chain included wherever data is combined across chains.
- Test single and batch claims where previously withheld OLAS covers some or all of the incentive. Record the covered amount as returned staking inflation rather than fresh inflation.
- Test zero-total-weight epochs reached through claims and `retain()`, including claim-before-retain and retain-before-claim execution orders. Verify that each allocation is refunded exactly once.
- Test a zero `stakingFraction` epoch with carried nonzero `stakingIncentive`; carried incentives must still be indexed. Reconcile indexed claim and return amounts, including epoch attribution, with the emitted claim, `Retained` and `StakingRefunded` events.
- **Release:** Studio full reindex with both source eras. Validate historical continuity and new claims before switching consumers. Updating the indexer alone does not update Govern/Launch contract addresses or ABIs.

**Liquidity — later workstream**

- Retain the planned V3 pool/position and fee-accounting scope, preserving holdings and fee history. Confirm selected pools, positions and consuming reports before implementation.
- This workstream was **not investigated in the supplied follow-up review**. Its scope, compatibility checks and delivery dates need a separate review before approval. Studio requires full reindexing; Robinhood has no planned liquidity-manager migration.

For squids, compatible redeployment/migration preserves data. If events have already been missed, resume alone cannot recover them: backfill or replay from before the first missed event. Grafting also cannot correct state that was already wrong at the graft block.

## Catch-up estimates and target readiness

**Catch-up estimates cover indexing only.** They exclude implementation, tests, deployment validation and consumer migration. Grafts assume a recent block; squid updates assume no missed events. Full squid indexes assume production Portal access and a working archive RPC.

**Ready** means release ABIs/configuration are verified, acceptance tests pass, the deployment is caught up, and affected consumers pass checks and complete any required cutover. Each chain needs its own sign-off. No calendar readiness date is committed yet: deployment inputs, chain priorities, owner capacity and frontend dates remain unconfirmed. The table keeps that distinction explicit rather than treating catch-up time as total delivery time.

| Indexer | Chain (hosting) — indexing/catch-up ETA | Target readiness / owner |
|---|---|---|
| **Marketplace** | Ethereum (self-hosted subgraph) — **1–4 hours** [graft]<br>Gnosis (self-hosted subgraph) — **2–8 hours** [graft]<br>Optimism (self-hosted subgraph) — **1–4 hours** [graft]<br>Arbitrum (self-hosted subgraph) — **1–6 hours** [graft]<br>Celo (self-hosted subgraph) — **1–4 hours** [graft]<br>Base (squid) — **1–3 days** [initial index; consumer migration pending]<br>Polygon (squid) — **2–5 days** [initial index; consumer migration pending]<br>Robinhood (squid) — **15–60 minutes** [update/resume] | **Not scheduled for any listed affected chain.** Tanya — confirm implementation/deployment capacity; consumer owners must sign off. |
| **Service registry** | Ethereum (Studio subgraph) — **1–3 days**<br>Polygon (Studio subgraph) — **1–4 days**<br>Optimism (Studio subgraph) — **1–3 days**<br>Arbitrum (Studio subgraph) — **2–5 days**<br>Celo (Studio subgraph) — **1–3 days**<br>Gnosis (self-hosted subgraph) — **1–3 days** [graft]<br>Base (squid) — **15–60 minutes** [update/resume]<br>Robinhood (squid) — **15–60 minutes** [update/resume] | **Not scheduled for any listed affected chain.** Tanya — confirm implementation/deployment capacity; consumer owners must sign off. |
| **Staking** | Ethereum (Studio subgraph) — **1–2 days**<br>Gnosis (Studio subgraph) — **2–5 days**<br>Polygon (Studio subgraph) — **1–3 days**<br>Optimism (Studio subgraph) — **1–3 days**<br>Arbitrum (Studio subgraph) — **2–5 days**<br>Celo (Studio subgraph) — **1–2 days**<br>Base (squid) — **15–60 minutes** [update/resume]<br>Robinhood (squid) — **15–60 minutes** [update/resume] | **Not scheduled for any listed affected chain.** Tanya — confirm implementation/deployment capacity; consumer owners must sign off. |
| **Pearl transactions** | Gnosis (Studio subgraph) — **3–7 days**<br>Optimism (Studio subgraph) — **2–5 days**<br>Base (squid) — **15–60 minutes** [update/resume]<br>Polygon (squid) — **15–60 minutes** [update/resume]<br>Robinhood (squid) — **1–4 hours** [if initial index needed, but unlikely; otherwise 15–60 minutes] | **Not scheduled for any listed affected chain.** Tanya — confirm implementation/deployment capacity; consumer owners must sign off. |
| **Tokenomics ETH** | Ethereum (Studio subgraph) — **2–5 days** | **Not scheduled for any listed affected chain.** Tanya — confirm implementation/deployment capacity; consumer owners must sign off. |
| **Liquidity** | Ethereum (Studio subgraph) — **1–3 days**<br>Gnosis (Studio subgraph) — **1–3 days**<br>Base (Studio subgraph) — **1–4 days**<br>Polygon (Studio subgraph) — **1–4 days**<br>Optimism (Studio subgraph) — **1–3 days**<br>Arbitrum (Studio subgraph) — **2–5 days**<br>Celo (Studio subgraph) — **1–2 days**<br>Robinhood (squid) — **no change** | **Not scheduled for any listed affected chain.** Indexer and report owners to confirm after the separate review. |

Studio estimates assume full reindexing, because we can't apply grafting there. Self-hosted subgraph estimates assume grafting unless stated otherwise.

**Marketplace fallback:** update indexers before the new factories/mechs produce events. If activity starts earlier, we must recover the missed history. An earlier graft or squid backfill may suffice; if unavailable, plan a **full reindex: Gnosis 5–8 days; other self-hosted Marketplace chains 1–2 days each**. These fallback ranges come from recent subgraph deployments and do not replace the normal graft estimates above.

## Frontend and consumer release checks

These are consumer tasks, not indexer implementation. Owner roles below are proposed routing; named owners and calendar dates must be confirmed before approval. Chain scope follows the contracts each consumer actually uses; protocol must supply the activation matrix rather than assuming every supported chain upgrades together.

| Consumer / item | Required change and acceptance check | Owner | Target readiness / dependency |
|---|---|---|---|
| **Govern claims** | Handle bridge fees when a claim sends no message. A zero token transfer does not prove no message. Simulate the transaction; rebuild and re-simulate if concurrent claims change message/fee state. Test message/no-message and concurrent-claim cases. | Govern frontend maintainer — name to confirm | Date not set; before claims use the new Dispenser on any activated route. Needs proxy/bridge configuration. |
| **Govern and Launch** | Update Dispenser/VoteWeighting addresses and ABIs together. Validate claims, voting, nominations and nominee lists against the new stack, keeping any required old-history reads. | Govern/Launch frontend maintainers — names to confirm | Date not set; before new claims/voting/nominations are enabled. Needs both contracts' addresses, ABIs and activation order. |
| **Marketplace service deployment** | Refresh the ServiceManager ABI. Verify direct registration and unbond calls; offer only Safe wrappers permitted on each chain. Test service creation, registration, deployment, termination and unbond with the selected wrappers. | Marketplace frontend maintainer — name to confirm | Date not set; before the upgraded ServiceManager/wrapper workflow is offered on each chain. |
| **Marketplace Base/Polygon consumers** | Complete squid cutover and query-dialect/parity checks for each active consumer. Include website/KPI, Marketplace frontend, mech-client and agent/wrapper paths where they read these indexers. | Each consuming app/agent maintainer — names to confirm | Date not set; after each squid catches up and before new protocol activity. Track Base and Polygon cutovers separately. |
| **Pearl / operate-app** | Make displayed reward eligibility aware of v0.4 rebaseline and missing/recovered baseline states. Validate reward recipients/history against both staking and Pearl indexers, including direct Master Safe rewards from `stake(serviceId)`, multiple recipients and legacy instances. Reconcile reward events and ERC20 transfers without duplicate rewards or wallet balance changes. | Pearl/operate-app maintainer — name to confirm | Date not set; before Pearl uses v0.4 programmes on each supported chain. Needs both indexer releases. |
| **Website staking/APR** | Update current VoteWeighting reads and validate staking-indexer inputs. Preserve historical APR data across the address/indexer cutover; check old/new intervals and totals. | Website/APR maintainer — name to confirm | Date not set; before publishing post-activation staking/APR data. Needs VoteWeighting configuration and validated staking inputs. |
| **Build — Hire guide** | Validate the example mech and request flow against the release; update instructions if the supported workflow changes. | Build documentation / mech-client maintainer — names to confirm | Date not set; before recommending the upgraded workflow. Needs a validated mech and client/settlement combination. |
| **Build — Monetize guide** | Validate factory selection, tracker setup and Safe-wrapper permissions per chain. Update setup instructions where the supported deployment/delivery workflow changes. | Build documentation / mech-server maintainer — names to confirm | Date not set; before recommending new factories/wrappers. Needs release configuration and a successful end-to-end deployment. |

## Scheduling and approval inputs

Protocol must provide **deployment addresses, start blocks, chain priorities and activation order**, plus release commits/artifacts and deployment/activation dates. Include factory creation events, staking implementations and their versions, Dispenser proxy/implementation details, VoteWeighting and allowed Safe wrappers per chain.

For **each affected workstream and chain**, assign an owner and calendar dates for implementation/tests, deployment/catch-up and consumer validation/cutover. The final target readiness date is after all applicable stages; do not derive it from the catch-up ETA alone. Where multiple consumers depend on one indexer, record their individual owners/dates before signing off that chain.

Still required:

- Confirm named frontend owners and dates for every applicable row above; confirm Tanya's indexer capacity/dates.
- Confirm whether the planned Base/Polygon Marketplace and Robinhood Pearl deployments/cutovers have completed. “Planned this week” in the coverage table is a previously reported plan, not a verified current deployment.
- Supply the new Dispenser proxy address and deployment block; neither is available in this draft.
- Confirm selected liquidity pools/positions, affected reports and a separate review date.

## Review baseline and ABI status

The approval baseline is **each repository's `main`**, not a feature branch. Main heads checked on 5 November 2026:

| Repository | Main commit checked |
|---|---|
| [autonolas-subgraph](https://github.com/valory-xyz/autonolas-subgraph) | [`b1f0dedf45f91404b7d83a1ca6cc674ab1d8d5ce`](https://github.com/valory-xyz/autonolas-subgraph/commit/b1f0dedf45f91404b7d83a1ca6cc674ab1d8d5ce) |
| [autonolas-subgraph-studio](https://github.com/valory-xyz/autonolas-subgraph-studio) | [`41bf6dfca2e061a31ef098f388f84b5df164c230`](https://github.com/valory-xyz/autonolas-subgraph-studio/commit/41bf6dfca2e061a31ef098f388f84b5df164c230) |

The supplied protocol review checked registries `f5294da0117f71d8552a6ae2c0e6eec03fafbe40` and Marketplace `14f191ae8399d50701fb4ad4d8d02d12e7574329` on 22 October. These are historical review inputs, **not confirmation of the final deployment source**. Recheck against the protocol's release commits before implementation sign-off.

Checks against the indexer main baselines above:

- Infra `abis/MechMarketplaceV2.json` lacks `getRequestIdWithNonce` and contains only one `deliverMarketplaceWithSignatures` entry. It is not a final compatibility reference for the new overloads. Refresh it and the consumer Marketplace/OlasMech ABIs from release artifacts; the supplied review also reports missing OlasMech overloads. Those consumer ABIs were not independently rechecked in this document update.
- Existing Infra factory ABIs expose `CreateMechFixedPriceNative`, `CreateMechFixedPriceToken`, `CreateMechFixedPriceTokenUSDC` and `CreateMechNvmSubscriptionTokenUSDC` for the corresponding checked factories. These are historical coverage, not proof that replacement factories emit the same events. Check every released factory separately, including any other payment type deployed.
- Studio `abis/DispenserV2.json` still includes `TokenomicsUpdated` and `StakingParamsUpdated` and lacks `ImplementationUpdated`. Keep it for the old source; add a release-matched ABI/source for the new proxy.

**ABI release gate:** generated ABIs, consumed event signatures and encoded overloads must match the recorded release code. Record that commit/artifact and the verified indexer commit in each implementation PR. Do not describe the current main ABIs or this planning-only PR as final protocol compatibility approval.
