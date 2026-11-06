# Supply chain security

This document describes the supply-chain threat model for `autonolas-subgraph-studio`, the controls in place, and how to respond when something breaks.

## 1. Why this repo's supply chain matters

The deliverables here are not user-facing apps — they are **The Graph** subgraphs deployed to Subgraph Studio that index on-chain data for the Olas ecosystem. **Every Olas dashboard, frontend app, and analytics view that queries an `OPERATE_SUBGRAPH_URL`-style endpoint depends on the data shipped from this repo.** A compromised deployment can serve manipulated on-chain data to every downstream consumer; the blast radius is org-wide, not repo-local.

The supply-chain surface is:
- The CI runner that builds (`graph codegen` + `graph build`) and pushes (`graph deploy`).
- The dependency tree that runs at install + build time on dev machines and CI (where install scripts execute).
- The deploy auth secret (`SUBGRAPH_STUDIO_KEY`).
- The `@graphprotocol/graph-cli` toolchain that compiles AssemblyScript mappings to WASM.

Because the deliverable is data, not a downloadable artifact, there is no Docker image to scan, no CSP to write, no end-user bundle to pin. Hardening is concentrated in CI/secrets/dep-pinning rather than container or runtime defenses.

## 2. Threat model

| # | Threat | Concrete example | Control |
|---|---|---|---|
| T1 | Supply-chain compromise via a transitive dep of `@graphprotocol/graph-cli` | `event-stream` (2018), `xz-utils` (2024), repeated nx/sourcemap CDN incidents (2024-2025) | Audit gate (§5), install-hook gate (§7), lockfile-lint (§6), SHA-pinned actions, **Dependabot alerts in repo Settings (§4)** |
| T2 | Stolen `SUBGRAPH_STUDIO_KEY` | Phished maintainer, leaked CI log, exfiltration via compromised dep with install hook | Quarterly key rotation (§3), gitleaks scan over full history (§8), least-privilege workflow `permissions: contents: read` |
| T3 | GitHub Action tag-mutation | `tj-actions/changed-files` (March 2025) — maintainer's PAT compromised, every action tag rewrites to dump CI secrets | All actions SHA-pinned to commit hash, not tag |
| T4 | Compromised maintainer account → `workflow_dispatch` shell injection | `folder` / `name` / `manifest` interpolated into shell commands | Regex validation on every dispatch input + `permissions: contents: read` |
| T5 | Historical secret leak in git or CI logs | `SUBGRAPH_STUDIO_KEY` was historically passed as a positional cmdline arg to `graph auth`; redaction is best-effort | Gitleaks scans every PR + full history; rotate key on incident |

## 3. Secrets inventory

| Name | Used by | Location | Rotation cadence | How to rotate |
|---|---|---|---|---|
| `SUBGRAPH_STUDIO_KEY` | `.github/workflows/deploy-subgraph.yaml` | GitHub repo secrets | **Quarterly** | Subgraph Studio → Account → Deploy Key → Regenerate. Update the GitHub repo secret. Re-trigger deployments. |

There are no other secrets currently in use. If the repo gains additional secrets (oracle keys, RPC endpoints, monitoring tokens), update this table and add a control for each.

### `SUBGRAPH_STUDIO_KEY` cmdline residual exposure (current state)

`graph-cli` 0.97 / 0.98 accepts the deploy key only as a positional CLI argument — there is no `--access-token` flag, no env-var support, no stdin reading. The key is therefore passed as `yarn graph auth ${{ secrets.SUBGRAPH_STUDIO_KEY }}`. GitHub Actions auto-redacts secret literals in logs (`***`), so the practical exposure is limited to `/proc/<pid>/cmdline` on the runner during the brief auth step. Hosted runners isolate that surface from other tenants.

When `graph-cli` adds env-var support upstream, switch the deploy workflow to that and remove the cmdline path. Until then, the quarterly rotation cadence is the mitigation.

## 4. Dependabot alerts (one-time setup)

This repo uses **Dependabot alerts only** — no automated PR raising for routine version bumps.

To enable:

1. Repo Settings → Code security and analysis → **Dependabot alerts** → Enable.
2. (Optional, recommended) Same page → **Dependabot security updates** → Enable. This will open PRs *only* for known-vulnerability fixes — not for routine version bumps. Expect a small initial wave (~10-15 PRs in the first weeks for the existing High advisories), then steady-state of a handful per month based on advisory cadence.

We deliberately **do NOT add `.github/dependabot.yml`** for `package-ecosystem: npm` version updates — that would generate routine PR noise on every dep release. If your team later wants opt-in version updates, add a minimal `dependabot.yml` then.

## 5. Audit gate (`yarn audit:prod`)

Yarn 1.x `yarn audit` exits with a *severity bitmask*, not a threshold, and has no suppression mechanism — a single unfixable transitive advisory blocks every PR. To work around this, [`scripts/audit.mjs`](scripts/audit.mjs) wraps `yarn audit --json` and:

1. Fails on any **high** or **critical** advisory not listed in [`.supply-chain/audit-allowlist.json`](.supply-chain/audit-allowlist.json).
2. Surfaces allowlist entries whose `review` date has passed as a **CI warning** (does not fail; review and renew or remove).
3. Surfaces allowlist entries that no longer match a current advisory as a **CI warning** (drift — remove from the allowlist).

**Critical naming detail**: the script is exposed as `yarn audit:prod`, NOT `yarn audit`. Yarn 1.x's built-in `yarn audit` shadows same-named scripts in `package.json`, so naming the script `audit` would silently invoke the built-in instead.

Allowlist policy: every entry needs `id`, `reason`, `added`, `review` (all required), plus optional `ghsa`, `package`, `severity` for human readability. An expired entry prints a warning but does not block CI — the team is expected to refresh or remove on review.

## 6. Lockfile lint

[`.github/workflows/supply-chain.yml`](.github/workflows/supply-chain.yml) runs `lockfile-lint` on every `yarn.lock`:

```
npx --yes lockfile-lint --path yarn.lock --type yarn --validate-https \
  --allowed-hosts yarn npm --empty-hostname false
```

Catches non-registry deps (e.g., `codeload.github.com` URLs from forked-and-patched packages), HTTP-only sources, and missing integrity hashes. A new GitHub-source dep should be allowlisted explicitly with a comment naming the package — never blanket-allow.

## 7. Install-hook gate

[`scripts/audit-install-hooks.mjs`](scripts/audit-install-hooks.mjs) enumerates every package in `node_modules` that declares a non-trivial `preinstall` / `install` / `postinstall` script and diffs the list against [`.supply-chain/install-hooks.allowlist`](.supply-chain/install-hooks.allowlist). Drift in either direction (new hook OR removed hook) fails the job — the latter catches stale allowlist entries.

A new package with an install hook NOT in the allowlist requires an explicit decision: vet what the hook does, then run `yarn audit:install-hooks:update` to add it (with an inline comment describing what the hook does). Anything you can't justify in a sentence shouldn't go in.

The Graph CLI's transitive tree includes `node-gyp-build` and similar legitimate native-binding bootstrappers; those are expected and allowlisted. Anything else is suspicious.

## 8. Secret scanning (gitleaks)

[`.github/workflows/gitleaks.yml`](.github/workflows/gitleaks.yml) runs gitleaks on every push + PR. Configuration notes:

- The gitleaks binary is downloaded with a **pinned version + checksum-verified** SHA-256 (otherwise an unverified `wget` in the gate that's checking for compromise is itself a hole).
- PR runs scan only the diff against the base branch (fast).
- `push` runs to `main` scan the latest commit.
- A one-time **full-history scan** (`gitleaks detect --log-opts="--all"`) should be run before the gate becomes blocking; surface any historical leaks before they get re-discovered later.

When bumping `GITLEAKS_VERSION`, fetch the upstream `gitleaks_${VERSION}_checksums.txt` from the GitHub release and update `GITLEAKS_SHA256` in the same commit. Reviewers should re-fetch and confirm.

## 9. CI control summary

| Workflow | Triggers | Required (branch protection)? | Failure mode |
|---|---|---|---|
| [`test.yaml`](.github/workflows/test.yaml) | PR + push to main | Yes (assumed) | Blocks merge |
| [`deploy-subgraph.yaml`](.github/workflows/deploy-subgraph.yaml) | `workflow_dispatch` only, main branch only | n/a (manual) | Validates inputs, then deploys |
| [`supply-chain.yml`](.github/workflows/supply-chain.yml) | PR + push to main | **Advisory at first; promote when team is ready** | Currently does not block merge |
| [`gitleaks.yml`](.github/workflows/gitleaks.yml) | PR + push | **Advisory at first; promote when team is ready** | Currently does not block merge |

To promote `supply-chain.yml` and `gitleaks.yml` to required: Settings → Branches → main → Branch protection rules → Require status checks → add `All checks passed` (the supply-chain.yml aggregator) **and** `Gitleaks / scan` (cross-workflow `needs:` is not supported — both must be listed separately).

## 10. Response playbook

If a critical advisory is reported against a published subgraph, OR `SUBGRAPH_STUDIO_KEY` is suspected leaked, OR a malicious dep is detected:

1. **Rotate `SUBGRAPH_STUDIO_KEY`** immediately (Subgraph Studio UI). Update GitHub repo secret. **This stops further malicious deploys but does NOT undeploy what has already been published.**
2. **Identify the affected subgraphs** — review recent deploy history in Subgraph Studio for unexpected publish events.
3. **Re-deploy known-good versions** of every affected subgraph. The previous-known-good version label is in the deploy history; trigger `workflow_dispatch` for each subgraph + network combination. Document the exact `yarn graph deploy` invocation in this PR description for the affected subgraphs.
4. **Open an incident issue** referencing this playbook, with timeline + scope.
5. **Notify downstream consumers** — Olas dashboards, frontends, and analytics teams should know to re-validate their cached data.

The metric for response readiness: could the team re-deploy all 12 subgraphs to known-good versions in **under an hour**? If not, drill the playbook quarterly.

## 11. Repo-specific watches

These dependencies and patterns deserve special attention because of the repo's shape:

- **`@graphprotocol/graph-cli`** — the largest dep tree by transitive footprint. Track upstream releases at [graph-tooling/releases](https://github.com/graphprotocol/graph-tooling/releases). Quarterly: check for security patches and prioritize the bump.
- **`SUBGRAPH_STUDIO_KEY`** — the only secret with org-wide blast radius. The cmdline-arg residual exposure is tracked in §3.
- **Service-registry template/manifest setup** — currently brittle (running `yarn generate-manifests` for `service-registry` overwrites hand-crafted mainnet/matic/optimism manifests with broken or lossy template output). Out of scope for a supply-chain PR but tracked here as it intersects with deploy correctness.
- **AssemblyScript runtime version** carried by `@graphprotocol/graph-ts` — a runtime change can produce subtly-different WASM output. Bumps require a staging deploy + cross-query against prod.
- **`graph-cli` HTTP transitive bumps (`undici`, `axios`)** — these sit on the `graph deploy` upload path and are NOT exercised by CI (which only runs `codegen` + `test` + `build`). Any PR that resolves or bumps these packages requires a `workflow_dispatch` staging deploy of one subgraph (smallest: `legacy-mech-fees`) from the merge commit BEFORE any production deploy. If the staging deploy succeeds, the bump is operationally validated. Same gate as the AssemblyScript runtime bump above.

## Contact

Security disclosures: **info@valory.xyz** (see [SECURITY.md](SECURITY.md)).
