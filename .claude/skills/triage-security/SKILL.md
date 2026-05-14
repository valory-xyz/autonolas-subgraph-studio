---
name: triage-security
description: Triage open Dependabot security alerts on this repo (npm ecosystem). For each alert, decide whether the vulnerable package is actually reachable from the deployed WASM artifact (`subgraphs/*/src/**/*.ts`) given AssemblyScript's narrow runtime surface, then act — applicable findings get a tracking issue, not-applicable findings get dismissed with the appropriate reason, allowlisted advisories are skipped (already accepted by the maintainer). Repo-specific to autonolas-subgraph-studio.
argument-hint: "[--limit N] [--rerun-dismissed]  # --limit caps alerts processed; --rerun-dismissed walks already-dismissed alerts and reports verdict drift (no mutations)"
disable-model-invocation: true
---

# Triage Dependabot security alerts (npm / AssemblyScript)

Walk every open Dependabot alert (`/repos/{owner}/{repo}/dependabot/alerts?state=open`). For each alert, classify by whether the vulnerable package is **reachable from the deployed WASM artifact** (`subgraphs/*/src/**/*.ts`) and, if so, whether the CVE's threat-model preconditions are satisfied by this codebase's actual usage. Then act in one pass.

Key facts that shape this skill:

- **Ecosystem**: npm only. Skip non-npm Dependabot alerts.
- **Deployed runtime**: a `.wasm` produced by `graph build` from `subgraphs/*/src/**/*.ts`. The AssemblyScript compiler accepts only a strict subset of JS/TS — in practice the only npm package whose code reaches WASM is `@graphprotocol/graph-ts`. Everything else (graph-cli, axios, lodash, semver, …) is build-tooling that runs on developer/CI machines and **never ships**.
- **Archetype**: fixed at `subgraph-indexer` — narrow exploit-surface posture. CVEs requiring browser sessions, untrusted-remote HTTP inputs, long-lived listeners, fs races, shell injection do NOT apply by default. The CVE must show a concrete chain that fits the AS / event-handler call shape to count as applicable.
- **Audit-allowlist integration**: `.supply-chain/audit-allowlist.json` already documents maintainer-accepted advisories. If an alert's GHSA appears there, the skill skips it (no dismiss, no issue) — the maintainer has the call.

## Decision matrix

| Classification | Confidence | Action |
| --- | --- | --- |
| Allowlisted in `.supply-chain/audit-allowlist.json` (by GHSA) | n/a | **SKIP.** Already accepted by maintainer; the skill must not override. |
| Not reachable from `subgraphs/*/src/` (Signal C: 0 PROD imports) | n/a | Dismiss with `not_used` + audit-trail issue. |
| Reachable from `subgraphs/*/src/`, CVE preconditions absent | **high** | Dismiss with `inaccurate` + audit-trail issue. |
| Reachable from `subgraphs/*/src/`, CVE preconditions absent | moderate / low | Open issue + `needs-human-review`. Do NOT dismiss. |
| Reachable from `subgraphs/*/src/`, CVE preconditions satisfied | any | Open tracking issue. Leave Dependabot alert open as canonical record. |
| Unclassifiable (no signals decisive) | n/a | Skip + stderr line. Never dismiss without evidence. |
| Ecosystem != npm (Docker / GitHub Actions / pip) | n/a | Skip as `non-npm-ecosystem` (informational, no exit-code impact). |

Conservative defaults: **when uncertain, open the issue.** A false-positive issue is one `gh issue close` away; a false-negative dismissal hides a real vuln. **`tolerable_risk` is never set by the skill** — that's a maintainer call (and the existing `.supply-chain/audit-allowlist.json` is where it should land).

Every dismissal opens a closed audit-trail issue (§3.1c) labelled `security-audit`. `gh issue list --state closed --label security-audit` returns every dismissal the skill has ever performed.

This skill runs fully autonomously on invocation — it mutates GitHub state (dismisses alerts, opens issues). Do not invoke from conversational context; require explicit `/triage-security`.

---

## Phase 0 — Ground truth

```bash
set -euo pipefail

# 0.0 Platform check. Linux + macOS only. Native PowerShell / cmd.exe not supported.
case "$(uname -s 2>/dev/null)" in
  Linux*|Darwin*) ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "WARN: running under $(uname -s) — Git Bash / MSYS path is untested." >&2 ;;
  *)
    echo "WARN: unrecognized platform $(uname -s). Skill is bash-only and may fail on this OS." >&2 ;;
esac

# 0.1 Required CLIs — fail fast.
for cmd in gh jq node grep find sed tr printf mktemp; do
  command -v "$cmd" >/dev/null 2>&1 \
    || { echo "ERROR: required CLI not found on PATH: $cmd"; exit 1; }
done

# 0.2 Confirm we're in a GitHub repo.
gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"' > /tmp/ts_repo.txt 2>/dev/null \
  || { echo "ERROR: not in a GitHub repo (gh repo view failed)"; exit 1; }
REPO=$(cat /tmp/ts_repo.txt)
echo "operating on $REPO"

# 0.3 Confirm this is the npm monorepo (root package.json + subgraphs tree).
test -f package.json \
  || { echo "ERROR: no root package.json — skill targets autonolas-subgraph-studio's npm layout"; exit 1; }
test -d subgraphs \
  || { echo "ERROR: no subgraphs/ directory — wrong repo or wrong working dir"; exit 1; }

# 0.4 Confirm Dependabot alerts API is reachable.
# Query with state=open explicitly so the check exercises the same code path
# Phase 1 will use. Returns 0 entries on a repo with no open alerts, which
# is fine — the call succeeding is what matters.
gh api "repos/$REPO/dependabot/alerts?state=open&per_page=1" --jq 'length' > /dev/null 2>&1 \
  || { echo "ERROR: Dependabot alerts API unreachable on $REPO (token scope? repo permissions?)"; exit 1; }

# 0.4b Node engine version. The repo's package.json declares engine "node": "24.x".
# yarn run / yarn audit:* enforce this. If your local node is older, every yarn-
# wrapped command in this skill (yarn why, yarn audit:install-hooks:update,
# yarn audit:prod) fails with "incompatible engine". Fallbacks:
#   - yarn why $PKG               →  npm ls $PKG  (or yarn install --ignore-engines)
#   - yarn audit:install-hooks    →  node scripts/audit-install-hooks.mjs [--update]
#   - yarn audit:prod             →  node scripts/audit.mjs
# Direct node-script invocation bypasses yarn's engine gate. The scripts
# themselves only need node ≥ 18 (they use stdlib + node: builtins).
NODE_VER=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [[ "$NODE_VER" -lt 24 ]]; then
  echo "WARN: node $NODE_VER detected; repo declares engine 24.x." >&2
  echo "      yarn-wrapped commands will fail; use direct node-script invocations." >&2
  echo "      See §0.4b in this skill for the per-command fallback map." >&2
fi
```

### 0.5 Archetype (fixed for this repo)

The whole monorepo has a single archetype: **`subgraph-indexer`**. Rationale:

- The deployed artifact is a `.wasm` compiled by `graph build` from `subgraphs/<name>/src/**/*.ts` (AssemblyScript). The AS compiler accepts only a strict subset of TS — most npm packages cannot even compile, let alone ship.
- The WASM runs inside Graph Node, which sandboxes it: no fs, no shell, no network egress, no HTTP listener. Inputs are blockchain events validated on-chain.
- No session state, no auth tokens, no cookies, no user-controlled URLs, no untrusted deserialization.

**Exploit-surface posture: narrow.** CVEs requiring any of the following do NOT apply by default:

- Browser sessions / cookies / CSRF
- Long-lived HTTP listener / server-side state
- Attacker-controlled HTTP fetch destinations
- Shell injection / subprocess spawn
- Filesystem races / path traversal at runtime
- Network-byte deserialization (RLP-decoded chain events are already validated)
- Memory-DoS unless triggerable by an event payload AND uptime is contractual

When in doubt, fall through to §2.5's per-advisory reasoning rather than relying on the archetype alone.

### 0.6 Load `.supply-chain/audit-allowlist.json`

Maintainer-accepted advisories live in `.supply-chain/audit-allowlist.json`. The skill must not override these — if a GHSA is allowlisted there, treat the Dependabot alert as already-triaged and skip.

```bash
ALLOWLIST_FILE=".supply-chain/audit-allowlist.json"
if [[ -f "$ALLOWLIST_FILE" ]]; then
  # Build a newline-separated list of allowlisted GHSA IDs into a file so the
  # per-alert loop can do an O(1) grep against it without re-parsing JSON.
  jq -r '.entries[]?.ghsa // empty' "$ALLOWLIST_FILE" > /tmp/ts_allowlisted_ghsas.txt
  ALLOWLIST_COUNT=$(wc -l < /tmp/ts_allowlisted_ghsas.txt | tr -d ' ')
  echo "loaded $ALLOWLIST_COUNT allowlisted GHSAs from $ALLOWLIST_FILE"
else
  : > /tmp/ts_allowlisted_ghsas.txt
  ALLOWLIST_COUNT=0
  echo "no $ALLOWLIST_FILE — skipping allowlist cross-reference"
fi
```

---

## Phase 1 — Fetch alerts

```bash
TMP=$(mktemp -d)

# 1.0 Parse argv.
#   --limit N         cap on alerts processed
#   --rerun-dismissed read-only verdict-drift report against state=dismissed alerts
LIMIT=""
MODE="live"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2 ;;
    --limit=*) LIMIT="${1#*=}"; shift ;;
    --rerun-dismissed) MODE="rerun-dismissed"; shift ;;
    *) shift ;;
  esac
done
[[ -n "$LIMIT" ]] && [[ ! "$LIMIT" =~ ^[0-9]+$ ]] \
  && { echo "ERROR: --limit must be a non-negative integer, got: $LIMIT"; exit 1; }

if [[ "$MODE" == "rerun-dismissed" ]]; then
  STATE_FILTER="state=dismissed"
  echo "MODE=rerun-dismissed — read-only verdict-drift report"
else
  STATE_FILTER="state=open"
fi

# 1.1 Fetch.
gh api "repos/$REPO/dependabot/alerts?${STATE_FILTER}&per_page=100" --paginate \
  > "$TMP/alerts.json" \
  || { echo "ERROR: failed to list Dependabot alerts"; exit 1; }
jq -e 'type == "array"' "$TMP/alerts.json" > /dev/null \
  || { echo "ERROR: Dependabot response not a JSON array"; head -20 "$TMP/alerts.json"; exit 1; }

N_ALERTS=$(jq 'length' "$TMP/alerts.json")
if [[ -n "$LIMIT" && "$LIMIT" -lt "$N_ALERTS" ]]; then
  echo "found $N_ALERTS open alerts; processing first $LIMIT per --limit"
  N_PROCESS="$LIMIT"
else
  echo "found $N_ALERTS open alerts"
  N_PROCESS="$N_ALERTS"
fi
```

### 1.2 Alert fields used

| Field | Path |
| ----- | ---- |
| Alert number | `.number` |
| Alert URL | `.html_url` |
| Severity | `.security_advisory.severity` |
| GHSA / CVE | `.security_advisory.ghsa_id`, `.security_advisory.cve_id` |
| Summary | `.security_advisory.summary` |
| Package name | `.security_vulnerability.package.name` |
| Ecosystem | `.security_vulnerability.package.ecosystem` (skip if `≠ npm`) |
| Vulnerable range | `.security_vulnerability.vulnerable_version_range` |
| First patched | `.security_vulnerability.first_patched_version.identifier` |
| Manifest | `.dependency.manifest_path` (the yarn.lock the alert came from) |
| Scope | `.dependency.scope` (typically `runtime` for everything since alerts come from yarn.lock — see §2.2 note) |

**Skip immediately** any alert where:

- `ecosystem != "npm"` — bucket as `non-npm-ecosystem` (informational, no exit-code impact). The skill is npm-only.
- `state != "open"` in live mode (defensive against pagination races).
- `auto_dismissed_at != null` (already auto-dismissed by GitHub).
- `.security_advisory.ghsa_id` appears in `/tmp/ts_allowlisted_ghsas.txt` — bucket as `allowlisted` (the maintainer's `.supply-chain/audit-allowlist.json` already documents the decision).

---

## Phase 2 — Classify each alert

### 2.1 PROD vs DEV path sets — AssemblyScript narrowing

**The single most important narrowing in this skill.** What ships to The Graph Studio is a WASM compiled from `subgraphs/<name>/src/**/*.ts`. Nothing else does. Everything outside that surface — scripts/, tests/, generate-manifests.js, root tooling, audit/, docs/, even subgraphs/<name>/build/ — is build/dev tooling that runs on developer/CI machines and never reaches a runtime user.

```bash
# PROD = AssemblyScript source files that compile to WASM. Use a `find` because
# subgraphs live under variable nesting (subgraphs/predict/predict-omen/src/ vs
# subgraphs/staking/src/).
# Use `while IFS= read` not `mapfile` — macOS bash 3.2 compat.
PROD_DIRS=()
while IFS= read -r _d; do
  PROD_DIRS+=("$_d")
done < <(find subgraphs -type d -name src -not -path '*/node_modules/*' -not -path '*/build/*' 2>/dev/null)

# DEV = everything else that imports npm packages: build tooling, scripts, tests.
DEV_DIRS=(scripts shared)
DEV_DIRS=($(for d in "${DEV_DIRS[@]}"; do [[ -d "$d" ]] && echo "$d"; done))

# Per-subgraph test dirs.
PKG_TEST_DIRS=()
while IFS= read -r _d; do
  PKG_TEST_DIRS+=("$_d")
done < <(find subgraphs -type d -name tests -not -path '*/node_modules/*' 2>/dev/null)

# Per-subgraph scripts dirs (each subgraph has its own scripts/).
PKG_SCRIPT_DIRS=()
while IFS= read -r _d; do
  PKG_SCRIPT_DIRS+=("$_d")
done < <(find subgraphs -type d -name scripts -not -path '*/node_modules/*' 2>/dev/null)

export PROD_DIRS DEV_DIRS PKG_TEST_DIRS PKG_SCRIPT_DIRS
echo "PROD_DIRS (AS source): ${#PROD_DIRS[@]} dirs (${PROD_DIRS[*]:0:3} …)"
echo "DEV_DIRS:              ${DEV_DIRS[*]}"
echo "PKG_TEST_DIRS:         ${#PKG_TEST_DIRS[@]} per-subgraph tests/ dirs"
echo "PKG_SCRIPT_DIRS:       ${#PKG_SCRIPT_DIRS[@]} per-subgraph scripts/ dirs"
```

**Critical**: every grep call that uses these sets MUST expand the array with `"${arr[@]}"` (quoted-each-element). The unquoted `$ARR` form collapses on subshell boundaries and silently returns zero hits — the kind of bug that produces a false "no production imports anywhere" verdict for a dep that's clearly imported.

### 2.2 Signal A — `dependency.scope` (note: unreliable in this repo)

```bash
SCOPE=$(jq -r ".[$i].dependency.scope // \"unknown\"" "$TMP/alerts.json")
```

In this repo, **almost every alert reports `scope=runtime`** because Dependabot infers scope from yarn.lock, and yarn.lock doesn't distinguish build-tooling deps from real runtime deps the way pyproject.toml does. Treat Signal A as a weak prior at best — Signal C (import-graph) is the decisive signal.

### 2.3 Signal B — manifest membership

The alert's `.dependency.manifest_path` identifies which `package.json` / `yarn.lock` the pkg came from. For monorepo alerts, also check the in-package `package.json` to see whether the pkg is a `dependencies` or `devDependencies` entry there.

```bash
PKG=$(jq -r ".[$i].security_vulnerability.package.name" "$TMP/alerts.json")
MANIFEST_PATH=$(jq -r ".[$i].dependency.manifest_path" "$TMP/alerts.json")

# If the manifest is a yarn.lock, look at the sibling package.json.
SIBLING_PKG_JSON="${MANIFEST_PATH%yarn.lock}package.json"
[[ -f "$SIBLING_PKG_JSON" ]] || SIBLING_PKG_JSON=""

PYPROJECT_GROUP="transitive"  # default for npm
if [[ -n "$SIBLING_PKG_JSON" ]]; then
  # node -e is more reliable than jq for arbitrary package.json shapes.
  PYPROJECT_GROUP=$(node -e "
    const p = require('./$SIBLING_PKG_JSON');
    const pkg = process.argv[1];
    if ((p.dependencies||{})[pkg]) console.log('prod');
    else if ((p.devDependencies||{})[pkg]) console.log('dev');
    else if ((p.peerDependencies||{})[pkg]) console.log('peer');
    else if ((p.optionalDependencies||{})[pkg]) console.log('optional');
    else console.log('transitive');
  " "$PKG" 2>/dev/null || echo "transitive")
fi
echo "Signal B: $PKG declared as '$PYPROJECT_GROUP' in $SIBLING_PKG_JSON"
```

For this repo the only direct deps in any package.json are `@graphprotocol/graph-cli`, `@graphprotocol/graph-ts`, and `matchstick-as`. **Every other alert is transitive.** Signal B will report `transitive` for 99% of alerts; the import-graph scan in §2.4 is what actually decides.

### 2.4 Signal C — import-graph scan (decisive)

```bash
# Step 1 — derive the import token(s) to grep for.
#
# npm-vs-Python ergonomics: distribution name and import name are almost always
# identical (`axios` is imported as `axios`). Scoped packages keep the scope
# (`@graphprotocol/graph-ts` is imported as `@graphprotocol/graph-ts`).
#
# The one structural variation: `@types/X` is a TypeScript types-only package
# (no runtime), so a CVE in @types/X is a non-issue — short-circuit to DEV.
# OPERATOR: when this branch fires, skip the rest of Signal C and jump
# directly to Phase 3.1 (dismiss as not_used). The PROD_HIT_FILES /
# DEV_HIT_FILES vars are set to empty so §3.1's comment-template
# branches handle the "pure transitive of build-tooling" case cleanly.
if [[ "$PKG" == @types/* ]]; then
  VERDICT="DEV"
  CLASSIFICATION_REASON="@types/* is TypeScript-types-only — no runtime code ships"
  PROD_HIT_FILES=""
  DEV_HIT_FILES=""
  # In the reference loop, this corresponds to: continue after invoking
  # the §3.1 not_used path. The pseudo-marker below is a docstring, not
  # executable bash — the operator routes to Phase 3.1 here.
  : "→ Phase 3.1 (not_used) — @types/* short-circuit"
fi

# Build a regex that matches both single- and double-quoted imports of the
# package, including deep subpaths (`axios/dist/foo` still attributes to axios)
# but anchored at a word boundary so `axios-mock-adapter` doesn't match `axios`.
PKG_RE=$(printf '%s' "$PKG" | sed 's/[][\\/.*^$+?{}()|]/\\&/g')

# Match: import x from 'pkg' | import 'pkg' | import x from 'pkg/sub' |
#        require('pkg') | require('pkg/sub') | import('pkg')
IMPORT_RE="(import[[:space:]]+([^;'\"]*[[:space:]]+from[[:space:]]+)?['\"]${PKG_RE}(/[^'\"]*)?['\"]|require\\([[:space:]]*['\"]${PKG_RE}(/[^'\"]*)?['\"]|import\\([[:space:]]*['\"]${PKG_RE}(/[^'\"]*)?['\"])"
```

Step 2 — grep prod (AS source) vs dev (everything else):

```bash
# PROD — subgraphs/*/src/ AS sources. These are what actually ships to WASM.
PROD_HIT_FILES=""
if [[ ${#PROD_DIRS[@]} -gt 0 ]]; then
  PROD_HIT_FILES=$(grep -rlnE "$IMPORT_RE" "${PROD_DIRS[@]}" \
    --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "/generated/" | grep -v "/build/" || true)
fi
PROD_HITS=$(printf '%s\n' "$PROD_HIT_FILES" | grep -c . || echo 0)

# DEV — root scripts/, shared/, per-subgraph tests/, per-subgraph scripts/, and
# the root-level tooling files (scripts/audit.mjs etc.). Include .js/.mjs/.cjs/.ts.
DEV_HIT_FILES=""
ALL_DEV_DIRS=("${DEV_DIRS[@]}" "${PKG_TEST_DIRS[@]}" "${PKG_SCRIPT_DIRS[@]}")
if [[ ${#ALL_DEV_DIRS[@]} -gt 0 ]]; then
  DEV_HIT_FILES=$(grep -rlnE "$IMPORT_RE" "${ALL_DEV_DIRS[@]}" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.cjs" \
    2>/dev/null | grep -v "/node_modules/" | grep -v "/build/" || true)
fi
DEV_HITS=$(printf '%s\n' "$DEV_HIT_FILES" | grep -c . || echo 0)

echo "Signal C: PROD_HITS=$PROD_HITS DEV_HITS=$DEV_HITS"
```

Step 3 — classify. **For this repo's `subgraph-indexer` archetype, the import graph is the entire signal**: package.json `scope=runtime` is misleading (alerts come from yarn.lock), and graph-cli being in `dependencies` is a packaging artefact, not a deployment claim.

| `PROD_HITS` | `DEV_HITS` | Verdict |
| ----------- | ---------- | ------- |
| `> 0` | any | **PROD** — pkg is imported from AS source; continue to §2.5 |
| `0` | `> 0` | **DEV** — pkg lives only in build/dev/test tooling; dismiss `not_used` |
| `0` | `0` | **DEV** — pure transitive in yarn.lock, never directly imported anywhere; dismiss `not_used` (the build chain pulls it in but nothing in this repo invokes it) |

The third row is critical: a naive classifier might fall back to `scope=runtime → PROD` when both hit-counts are zero. **For this repo that fallback is wrong** — `scope=runtime` is the yarn.lock default for every transitive of graph-cli, and graph-cli itself doesn't ship. The rule: zero imports anywhere means it's transitive-of-build-tooling, mark DEV.

If you ever start importing more npm packages from `subgraphs/*/src/*.ts`, revisit this rule. (You can't import most of them anyway — AssemblyScript will reject them at compile time.)

### 2.5 Exploit-surface analysis — only triggered for PROD alerts

Only runs when Signal C returned `PROD_HITS > 0`. For this repo that's the rare case where an npm package's CVE applies to code that actually compiles into WASM — currently only `@graphprotocol/graph-ts` qualifies.

The §2.5 mechanics, in summary:

- **§2.5.1** Fetch GHSA description: `gh api "/advisories/$GHSA_ID" --jq '{summary, description, severity, cwe_ids: [.cwe_ids[]?.cwe_id]}'`.
- **§2.5.1b** Optional MITRE CWE supplementation (`curl https://cwe.mitre.org/data/definitions/${N}.json`) for sparse advisories.
- **§2.5.2** Derive a per-advisory precondition checklist (Q1, Q2, …) directly from the description text. **Not** from a static CWE → questions table. Use the table below only as a sanity check that you covered the standard preconditions for the bug class:

  | CWE | Bug class | Typical Q shape |
  | --- | --- | --- |
  | CWE-200/201/209 | Information / header / token leak | Does the calling AS code carry sensitive state? (Note: subgraphs hold no auth tokens, no cookies — likely absent.) |
  | CWE-22/23 | Path traversal | Does the AS code pass attacker-controlled paths? (Subgraph runtime has no fs — likely absent.) |
  | CWE-78/77/88 | Command injection | Does the AS code spawn subprocess / shell? (No — WASM sandbox.) |
  | CWE-94/502/915 | Code injection / deserialization RCE | Does the AS code eval / deserialize external bytes? (Chain events are RLP-decoded and validated on-chain.) |
  | CWE-295/297/345 | TLS / cert bypass | Does the AS code make outbound TLS? (No — sandbox has no network egress.) |
  | CWE-400/770/1333 | DoS — memory / regex / compression | Does the AS code accept attacker-controlled bytes of unbounded length? (Event payloads are bounded by chain protocol; usually absent.) |
  | CWE-918 | SSRF | Does the AS code fetch URLs with external hosts? (No — no network IO from WASM.) |

  Most CVE classes have at least one precondition that is structurally impossible in a subgraph-indexer (no network, no fs, no shell). Spell out which precondition fails for each Q.

  **Caveat: "usually absent" is the EXPLOITABILITY answer, not the recommended ACTION.** Even when a CVE is structurally unreachable in the subgraph runtime, prefer to **fix via yarn resolution** over dismissing it, when all of the following hold:
  - Upstream has published a patched version
  - The fix is a one-line resolution (single or path-scoped — see §3.2)
  - No major-version conflicts in the tree (verify with `yarn why $PKG`)

  The cost of carrying a "structurally unreachable but still on the alert list" advisory grows over time: dashboard noise, audit-allowlist creep, the burden of re-justifying the dismissal at every review date. A one-line yarn resolution + lockfile-wipe is cheaper. The lodash.trim ReDoS (GHSA-29mw-wpgm-hmr9, cleared by PR #126 via the fresh-lockfile cascade to `lodash.trim@4.18.0`) is a worked example — the CVE was structurally unreachable in subgraph-indexer (no attacker-controlled strings ever reach `trim`), but the fix-cost was zero so we patched rather than allowlisted.

  Dismissal as `inaccurate` is reserved for cases where there's no patch available, OR the upstream patch breaks something, OR the resolution would force unacceptable cross-major churn.

- **§2.5.3** Mark each Q `reachable` / `absent` / `unknown` against the calling AS code (read the actual `.ts` files in `PROD_HIT_FILES`).
- **§2.5.4** Vulnerable-symbol grep: extract code-like tokens from the GHSA description (functions, class.method, kwargs / option keys, CLI flags); grep `PROD_DIRS` for each. Note that AS code uses different idioms than JS — kwargs become object literals (`{ option: value }`), and "CLI flags" rarely apply at all.
- **§2.5.5** Archetype multiplier: this repo is **subgraph-indexer (narrow, cli-tool-like)** — strict by default. The CVE must show a concrete chain that fits the AS / event-handler call shape to count as applicable.
- **§2.5.6** Confidence tier (`high` / `moderate` / `low`). Only `high` permits autonomous `inaccurate` dismissal. Sparse-advisory cap: ≤1 derivable Q ⇒ moderate ceiling.
- **§2.5.6b** Structural-impossibility check — **NOT APPLICABLE** to this archetype. §2.5.6b is for `framework` / `scaffold` archetypes where consumer-context unknowability matters; `subgraph-indexer` is itself the deployed code, so the cli-tool-like rule applies directly.
- **§2.5.7** Action matrix:

  | Preconditions | Confidence | Verdict | Action |
  | --- | --- | --- | --- |
  | All `reachable` | any | PROD-APPLICABLE | Open issue. If confidence != high, additionally label `needs-human-review`. |
  | Any `absent` | high | NOT-APPLICABLE | Dismiss with `inaccurate` (Phase 3.1b). |
  | Any `absent` | moderate / low | NOT-APPLICABLE (low-conf) | Open issue + `needs-human-review`. Do NOT dismiss. |
  | Any `unknown` | any | PROD-APPLICABLE | Open issue + `needs-human-review`. |

- **§2.5.8** PoC harness explicitly out-of-scope. If a `moderate` / `low` dismissal is challenged by the maintainer, PoC verification is the documented escalation path.

### 2.6 Transitive reverse-resolve

For pkgs that appear in yarn.lock but nowhere else, figure out which **direct** dep pulled them in:

```bash
# Walk from the manifest's directory (subgraphs/<name>/ or root).
MANIFEST_DIR=$(dirname "$MANIFEST_PATH")
(cd "$MANIFEST_DIR" && yarn why "$PKG" 2>/dev/null | head -30) > "$TMP/yarn_why_${PKG}.txt"
REVERSE_DEP_ROOT=$(grep -E "Found|Reasons|Hoisted from" "$TMP/yarn_why_${PKG}.txt" | head -3 | tr '\n' '; ')
```

If the reverse-dep root is `@graphprotocol/graph-cli` or any of its transitives, it's build-tooling. If it's `@graphprotocol/graph-ts`, it could ship to WASM and Signal C should have caught it as a PROD import; the absence of a PROD import in that case means graph-ts pulls the pkg in only for non-AS-compatible code paths (still safe to dismiss).

---

## Phase 3 — Act

For each alert, take exactly one action: **skip**, **dismiss**, or **open issue**. Build a per-alert audit record so Phase 4 summary is honest.

When `MODE=rerun-dismissed`, **Phase 3.0 runs instead of 3.1 / 3.1b / 3.2 / 3.3**.

### 3.0 Rerun-dismissed report mode (read-only)

```bash
# Run §2.4 (Signal C) + §2.5 (if PROD) for the alert, producing $VERDICT and
# $NEW_REASON. Compare to recorded dismissed_reason.
RECORDED_REASON=$(jq -r ".[$i].dismissed_reason" "$TMP/alerts.json")

if [[ "$VERDICT" == "DEV" ]]; then
  NEW_REASON="not_used"
elif [[ "$VERDICT" == "NOT-APPLICABLE" && "$CONFIDENCE" == "high" ]]; then
  NEW_REASON="inaccurate"
else
  NEW_REASON="open-issue"
fi

case "${RECORDED_REASON}:${NEW_REASON}" in
  "${RECORDED_REASON}:${RECORDED_REASON}")
    AGREE+=("$ALERT_NUM $PKG $GHSA_ID ($RECORDED_REASON)") ;;
  "not_used:inaccurate" | "inaccurate:not_used")
    REFINE+=("$ALERT_NUM $PKG $GHSA_ID (was=$RECORDED_REASON now=$NEW_REASON)") ;;
  *":open-issue")
    DRIFT+=("$ALERT_NUM $PKG $GHSA_ID (was=$RECORDED_REASON now=open-issue)") ;;
  *)
    OTHER+=("$ALERT_NUM $PKG $GHSA_ID (was=$RECORDED_REASON now=$NEW_REASON)") ;;
esac
```

End-of-run: print agree/refine/drift/other counts. Never auto-reopen a dismissed alert — surface drift only. Exit `0` if `DRIFT` is empty, `1` otherwise.

### 3.1 Dismiss a DEV-only alert (`not_used`)

```bash
# Step 1 — open the closed audit-trail issue (§3.1c). Symmetric with §3.1b:
# every dismissal — `not_used` or `inaccurate` — gets a closed audit issue.
DISMISSAL_REASON="not_used"
AUDIT_URL=$(create_audit_issue)
[[ -n "$AUDIT_URL" ]] || {
  echo "ERROR: audit issue creation failed for #$ALERT_NUM — abort dismissal"
  SKIPPED+=("$ALERT_NUM:audit-create-error"); continue;
}

# Step 2 — terse 280-char comment with audit-issue URL pointer.
DISMISS_COMMENT="\`$PKG\` not imported from \`subgraphs/*/src/*.ts\` (AS / WASM runtime). Build-tooling only. Full analysis: $AUDIT_URL"
if [[ -z "$DEV_HIT_FILES" ]]; then
  DISMISS_COMMENT="\`$PKG\` not imported anywhere in repo. Transitive of build-tooling. Full analysis: $AUDIT_URL"
fi
[[ ${#DISMISS_COMMENT} -gt 280 ]] && DISMISS_COMMENT="${DISMISS_COMMENT:0:277}..."

# Step 3 — dismiss.
gh api -X PATCH "repos/$REPO/dependabot/alerts/$ALERT_NUM" \
  -f state="dismissed" \
  -f dismissed_reason="not_used" \
  -f dismissed_comment="$DISMISS_COMMENT" \
  --jq '.state' \
  || { echo "ERROR: failed to dismiss alert #$ALERT_NUM"; SKIPPED+=("$ALERT_NUM:dismiss-api-error:$AUDIT_URL"); continue; }

DISMISSED+=("$ALERT_NUM $PKG $GHSA_ID (not_used)")
```

The GitHub-documented `dismissed_reason` enum is `fix_started`, `inaccurate`, `no_bandwidth`, `not_used`, `tolerable_risk`. The skill uses **two**: `not_used` (this section) and `inaccurate` (§3.1b). Never use `tolerable_risk` — that's the maintainer's risk-accept call (and `.supply-chain/audit-allowlist.json` is where it lives in this repo). Never use `fix_started` / `no_bandwidth` — neither describes the skill's reasoning.

### 3.1b Dismiss a NOT-APPLICABLE alert (`inaccurate`, high-confidence only)

Reached only when Signal C found PROD imports AND §2.5.7 returned NOT-APPLICABLE at high confidence.

```bash
# Guards.
[[ "$VERDICT" == "NOT-APPLICABLE" ]] \
  || { echo "guard: only NOT-APPLICABLE reaches 3.1b"; continue; }
[[ "$CONFIDENCE" == "high" ]] \
  || { echo "guard: 3.1b requires high confidence — route to 3.2 with needs-human-review"; continue; }

DISMISSAL_REASON="inaccurate"
AUDIT_URL=$(create_audit_issue)
[[ -n "$AUDIT_URL" ]] || {
  echo "ERROR: audit issue creation failed for #$ALERT_NUM — abort dismissal"
  SKIPPED+=("$ALERT_NUM:audit-create-error"); continue;
}

DISMISS_COMMENT="\`$PKG\` CVE not applicable to subgraph-indexer runtime (high-conf, AS sandbox). Full analysis: $AUDIT_URL"
[[ ${#DISMISS_COMMENT} -gt 280 ]] && DISMISS_COMMENT="${DISMISS_COMMENT:0:277}..."

gh api -X PATCH "repos/$REPO/dependabot/alerts/$ALERT_NUM" \
  -f state="dismissed" \
  -f dismissed_reason="inaccurate" \
  -f dismissed_comment="$DISMISS_COMMENT" \
  --jq '.state' \
  || {
    echo "ERROR: failed to dismiss alert #$ALERT_NUM (audit issue $AUDIT_URL was already created)"
    SKIPPED+=("$ALERT_NUM:dismiss-api-error:$AUDIT_URL"); continue;
  }

DISMISSED+=("$ALERT_NUM $PKG $GHSA_ID (inaccurate, high-conf)")
```

If the API call fails after the audit issue was created, the audit issue is an orphan — operator should retry the dismissal or close the audit issue manually. The `SKIPPED` entry carries the audit URL so it can be cleaned up.

### 3.1c Open a closed audit-trail issue (every dismissal)

Long-form audit record. Created closed (gh issue create then immediate gh issue close) so it doesn't appear in default "open issues" views but is searchable via `gh issue list --state closed --label security-audit`.

```bash
# called as: AUDIT_URL=$(create_audit_issue)
create_audit_issue() {
  local audit_title audit_body audit_url body_analysis

  audit_title="[Security-audit][closed] ${PKG} #${ALERT_NUM} (${GHSA_ID}) — ${DISMISSAL_REASON}"
  [[ ${#audit_title} -gt 70 ]] && audit_title="${audit_title:0:67}..."

  case "$DISMISSAL_REASON" in
    not_used)
      body_analysis=$(cat <<EOF
## Classification: not reachable from deployed WASM (Signal C)

The package is not reachable from \`subgraphs/*/src/**/*.ts\` (the AssemblyScript code that compiles to the deployed WASM artifact). Phase 2.5 (exploit-surface analysis) was NOT run — the verdict is mechanical: zero PROD imports means the package's code never executes inside The Graph Studio's Graph Node runtime.

**Signal C scan results:**
- PROD imports found (under \`subgraphs/*/src/\`): 0
- DEV imports found at: ${DEV_HIT_FILES:-none (pure transitive of build-tooling)}
- Manifest: \`${MANIFEST_PATH}\`
- Sibling package.json group: ${PYPROJECT_GROUP}
- Reverse-dep root: ${REVERSE_DEP_ROOT:-N/A}

**Why this is a safe dismissal:** the deployed artifact is a WASM compiled by \`graph build\` from the AssemblyScript sources in \`subgraphs/*/src/\`. The AssemblyScript compiler accepts only a strict subset of TS — most npm packages cannot compile at all, and none of them are reachable from the AS source. Build-tooling (graph-cli, axios, lodash, etc.) runs only on developer/CI machines and never ships.

**Re-evaluate if:** any AS file under \`subgraphs/*/src/\` adds an import of \`${PKG}\`, or the deployed-runtime model changes (e.g. graph-node starts accepting JS handlers).
EOF
)
      ;;
    inaccurate)
      body_analysis=$(cat <<EOF
## Advisory summary (§2.5.1)

${ADVISORY_SUMMARY}

## Derived precondition checklist (§2.5.2)

Each Q below is derived per-advisory from the GHSA description (and optionally §2.5.1b MITRE supplement), then answered against this codebase in §2.5.3.

${CWE_CHECKLIST_ANSWERS}

## Vulnerable-symbol trace (§2.5.4)

${SYMBOL_TRACE_RESULT}

## Decisive reasoning

${APPLICABILITY_REASONING}

## Why this is a safe dismissal

The package IS imported from AS source (Signal C: ${PROD_HIT_FILES}), but the CVE's preconditions are not satisfied in this repo. The \`subgraph-indexer\` archetype (Graph Node WASM sandbox) eliminates most classes of exploit — no fs, no shell, no network egress, no untrusted HTTP inputs, no session state, no deserialization of attacker-controlled bytes.

**Re-evaluate if:** the AS code adds usage of the vulnerable symbol(s), or graph-node introduces a runtime feature that changes the sandbox model.
EOF
)
      ;;
    *)
      body_analysis="(unknown dismissal reason: $DISMISSAL_REASON — please review)"
      ;;
  esac

  audit_body=$(cat <<EOF
**Dismissed Dependabot alert:** #${ALERT_NUM} — ${ALERT_URL}
**Package:** \`${PKG}\` (npm)
**Severity:** ${SEVERITY}
**GHSA / CVE:** ${GHSA_ID} / ${CVE_ID}
**CWE(s):** ${CWE_IDS}
**Vulnerable range:** \`${VULN_RANGE}\` — first patched in \`${FIRST_PATCHED}\`
**Manifest:** \`${MANIFEST_PATH}\`
**Archetype:** subgraph-indexer
**Skill confidence:** ${CONFIDENCE:-n/a (not_used path)}
**Dismissal reason:** \`${DISMISSAL_REASON}\` (this audit issue is auto-closed)

${body_analysis}

## How to challenge this dismissal

If you (the maintainer) judge any answer wrong:
1. Reopen the Dependabot alert via the GitHub Security tab.
2. Reopen this audit issue and comment with the corrected analysis + evidence.
3. If the corrected analysis shows the CVE is applicable, fix as a normal bump.

Skill: \`.claude/skills/triage-security/SKILL.md\` — see commit log for version.
EOF
)

  audit_url=$(gh issue create --repo "$REPO" \
    --title "$audit_title" \
    --label "security,dependabot,triage-security,security-audit" \
    --body "$audit_body") || return 1

  gh issue close "$audit_url" --repo "$REPO" \
    --comment "Auto-closed — see alert ${ALERT_URL} for the live state." >/dev/null 2>&1 || true

  echo "$audit_url"
}
```

The `security-audit` label and the other four labels MUST be pre-created idempotently before the per-alert loop runs (see §3.2).

### 3.2 Open a tracking issue for an APPLICABLE alert

```bash
# Dedupe by GHSA ID — search both title and body.
EXISTING=$(gh issue list --repo "$REPO" --state open --search "\"$GHSA_ID\" in:title,body" --json number,url --jq '.[0].url // ""')
if [[ -n "$EXISTING" ]]; then
  echo "skip: existing issue for $GHSA_ID at $EXISTING"
  SKIPPED+=("$ALERT_NUM:existing-issue:$EXISTING")
  continue
fi

# Pre-create labels idempotently. `gh issue create --label X` errors with
# "could not add label: 'X' not found" if the label doesn't already exist.
# Run once before the per-alert loop (NOT per alert):
gh label create security             --color B60205 --description "Security vulnerability" --repo "$REPO" 2>/dev/null || true
gh label create dependabot           --color 0366D6 --description "Dependabot-reported" --repo "$REPO" 2>/dev/null || true
gh label create triage-security      --color 5319E7 --description "Opened by triage-security skill" --repo "$REPO" 2>/dev/null || true
gh label create needs-human-review   --color FBCA04 --description "Skill confidence below threshold — maintainer call required" --repo "$REPO" 2>/dev/null || true
gh label create security-audit       --color C2E0C6 --description "Permanent audit record for a triage-security dismissal (auto-closed)" --repo "$REPO" 2>/dev/null || true
```

Build the title accounting for three real-world wrinkles in advisory summaries — case mismatch between advisory pkg capitalisation and `.package.name`, summaries without a colon, trailing periods:

```bash
PKG_LOWER=$(tr '[:upper:]' '[:lower:]' <<<"$PKG")
SUM_LOWER=$(tr '[:upper:]' '[:lower:]' <<<"$SUMMARY")
RAW="$SUMMARY"
if [[ "$SUM_LOWER" == "${PKG_LOWER}: "* ]]; then
  RAW="${SUMMARY:$((${#PKG}+2))}"
elif [[ "$SUM_LOWER" == "${PKG_LOWER} "* ]]; then
  RAW="${SUMMARY:$((${#PKG}+1))}"
fi
RAW="${RAW%.}"
RAW="$(tr '[:lower:]' '[:upper:]' <<<"${RAW:0:1}")${RAW:1}"
PREFIX="[Security][${SEVERITY}] ${PKG}: "
BUDGET=$((70 - ${#PREFIX}))
if [[ ${#RAW} -gt $BUDGET ]]; then
  SUMMARY_SHORT="${RAW:0:$((BUDGET-1))}…"
else
  SUMMARY_SHORT="$RAW"
fi
TITLE="${PREFIX}${SUMMARY_SHORT}"

LABELS="security,dependabot,triage-security"
[[ "$NEEDS_REVIEW" == "true" ]] && LABELS="$LABELS,needs-human-review"

ISSUE_URL=$(gh issue create --repo "$REPO" \
  --title "$TITLE" \
  --label "$LABELS" \
  --body "$(cat <<EOF
## Dependabot alert

- Alert: $ALERT_URL
- Package: \`$PKG\` (npm)
- Severity: **$SEVERITY**
- GHSA: $GHSA_ID
- CVE: $CVE_ID
- CWE(s): $CWE_IDS
- Vulnerable range: \`$VULN_RANGE\`
- First patched: \`$FIRST_PATCHED\`
- Manifest: \`$MANIFEST_PATH\`

## Summary

$ADVISORY_SUMMARY

## AS-runtime reachability

The vulnerable package is imported from the following \`subgraphs/*/src/\` (AssemblyScript) files:

$PROD_HIT_FILES_BULLETED

(Scan covered every subgraph's \`src/\` tree. DEV / test / build-tooling paths excluded.)

## Exploit-surface analysis

**Archetype:** subgraph-indexer (Graph Node WASM sandbox)
**Skill verdict:** $VERDICT
**Skill confidence:** $CONFIDENCE

**CWE checklist (§2.5.2):**
$CWE_CHECKLIST_ANSWERS

**Vulnerable-symbol trace (§2.5.4):**
$SYMBOL_TRACE_RESULT

**Reasoning:** $APPLICABILITY_REASONING

If this issue carries the \`needs-human-review\` label, the skill's confidence was below the threshold for autonomous dismissal. Maintainer decision: either (a) bump the dep (probably via a yarn resolution in root \`package.json\` — mirror it into every \`subgraphs/*/package.json\` per the repo's resolution-mirroring convention), or (b) dismiss the linked Dependabot alert with reason \`inaccurate\` + a comment naming the missing precondition.

## Suggested fix

Two resolution-scoping forms in Yarn 1, **both verified working** in this repo:

1. **Unscoped** \`"pkg": "^X"\` — forces a single version of pkg across every instance in the tree. Safe ONLY when pkg is single-major in the tree.
2. **Path-scoped** \`"**/parent/pkg": "^X"\` — forces pkg ONLY when it's nested under parent. Required for multi-major cases. **The \`**/\` prefix is mandatory** — Yarn 1 silently ignores bare \`"parent/pkg"\` for transitively-nested instances.

For multi-major packages in this tree (picomatch 2.x+4.x, minimatch 3.x+5.x+9.x+10.x, glob 7.x+11.x), use form 2.

**Apply across every package.json** (root + 12 subgraphs — the repo enforces resolution parity per CLAUDE.md "Yarn 1 gotcha").

For direct deps (only \`@graphprotocol/graph-cli\`, \`@graphprotocol/graph-ts\`, \`matchstick-as\` qualify): bump the dependency pin in every package.json that declares it.

After any resolution change, **delete every yarn.lock** (root + all subgraphs) and run \`yarn install\` fresh. The lockfile is sticky; without wiping it, yarn won't re-resolve even when the resolution is correct. A fresh install also auto-bumps every transitive to its latest semver-compatible patch — often clearing several other CVEs in the same PR without explicit resolutions for them.

\`\`\`bash
# Apply the resolution edits to all 13 package.json (root + 12 subgraphs), then:
rm yarn.lock subgraphs/*/yarn.lock subgraphs/*/*/yarn.lock
yarn install
for d in subgraphs/*/ subgraphs/*/*/; do
  [ -f "$d/package.json" ] && (cd "$d" && yarn install)
done
yarn audit:install-hooks:update
yarn audit:prod   # any "no longer in the production tree" warnings indicate audit-allowlist entries that can now be removed
git add .supply-chain/install-hooks.allowlist .supply-chain/audit-allowlist.json
\`\`\`

## Why this issue exists

Triaged by the \`triage-security\` skill. The Dependabot alert remains open as the source of truth; this issue tracks the in-repo work.
EOF
)")

echo "opened: $ISSUE_URL for $GHSA_ID"
OPENED+=("$ALERT_NUM $PKG $GHSA_ID $ISSUE_URL")
```

The Dependabot alert is **not** dismissed for PROD-applicable cases — it stays open and is the canonical record.

### 3.3 Skip (unclassifiable / allowlisted / non-npm)

```bash
# Allowlisted (in .supply-chain/audit-allowlist.json): no action, just count.
if grep -qxF "$GHSA_ID" /tmp/ts_allowlisted_ghsas.txt 2>/dev/null; then
  ALLOWLISTED+=("$ALERT_NUM $PKG $GHSA_ID (already in audit-allowlist.json)")
  echo "SKIP #$ALERT_NUM: $PKG ($GHSA_ID) — allowlisted in .supply-chain/audit-allowlist.json"
  continue
fi

# Non-npm ecosystem.
if [[ "$ECOSYSTEM" != "npm" ]]; then
  SKIPPED_ECOSYSTEM+=("$ALERT_NUM:$ECOSYSTEM")
  echo "SKIP #$ALERT_NUM: ecosystem=$ECOSYSTEM (skill is npm-only)" >&2
  continue
fi

# Truly unclassifiable — no decisive signal. Should be rare given §2.4's
# always-classify rule for subgraph-indexer archetype, but kept as a safety
# valve for unexpected alert shapes.
echo "SKIP #$ALERT_NUM: $PKG ($GHSA_ID) — unclassifiable. Manual review: $ALERT_URL" >&2
SKIPPED_UNCLASS+=("$ALERT_NUM $PKG $GHSA_ID")
```

---

## Phase 4 — Summary

**Live mode only** — `--rerun-dismissed` produces its own report (§3.0).

```
=== triage-security summary for $REPO ===
Alerts seen:        $N_ALERTS
Processed:          $N_PROCESS (respects --limit)

Dismissed (DEV-only, not_used):         $N_DISMISSED_DEV
Dismissed (PROD-not-applic, inaccurate): $N_DISMISSED_INACCURATE
Issue opened (PROD-applicable):          $N_OPENED_APPLICABLE
Issue opened (needs-human-review):       $N_OPENED_REVIEW

Audit-trail issues opened (closed):      $N_AUDIT_ISSUES
Allowlisted (in .supply-chain/audit-allowlist.json): $N_ALLOWLISTED

Skipped (non-npm ecosystem):             $N_SKIPPED_ECOSYSTEM    (informational)
Skipped (unclassifiable):                $N_SKIPPED_UNCLASS      (exits 1 if > 0)

Dismissed alerts:
  #532 axios     GHSA-m7pr-hjqh-92cm (not_used — only in build-tooling)
  ...

Opened issues:
  #N  …/issues/N  GHSA-…  @graphprotocol/graph-ts  (high-conf applicable)
  ...

Allowlisted (already accepted by maintainer — no action taken):
  #M  GHSA-c2c7-rcm5-vvqj  picomatch
  ...
```

The `needs-human-review` bucket is the primary calibration signal: if it grows over time, refine the §2.5.2 checklist derivation logic.

**Exit codes:**
- `0` if `N_SKIPPED_UNCLASS == 0` AND not in rerun-dismissed mode (or rerun mode had empty DRIFT).
- `1` if `N_SKIPPED_UNCLASS > 0` OR (rerun-dismissed mode AND DRIFT is non-empty).
- `non-npm-ecosystem` and `allowlisted` skips never affect exit code.

---

## Reference: full per-alert loop

```bash
set -euo pipefail
TMP=$(mktemp -d)
REPO=$(gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"')

# … Phase 0 (CLI checks, repo gates, allowlist load) …
# … Phase 1 (fetch alerts.json + argv) …

# Path arrays — see §2.1 critical-note on quoted-each-element expansion.
PROD_DIRS=()
while IFS= read -r _d; do PROD_DIRS+=("$_d"); done \
  < <(find subgraphs -type d -name src -not -path '*/node_modules/*' -not -path '*/build/*' 2>/dev/null)

DEV_DIRS=(scripts shared)
DEV_DIRS=($(for d in "${DEV_DIRS[@]}"; do [[ -d "$d" ]] && echo "$d"; done))

PKG_TEST_DIRS=()
while IFS= read -r _d; do PKG_TEST_DIRS+=("$_d"); done \
  < <(find subgraphs -type d -name tests -not -path '*/node_modules/*' 2>/dev/null)

PKG_SCRIPT_DIRS=()
while IFS= read -r _d; do PKG_SCRIPT_DIRS+=("$_d"); done \
  < <(find subgraphs -type d -name scripts -not -path '*/node_modules/*' 2>/dev/null)

export PROD_DIRS DEV_DIRS PKG_TEST_DIRS PKG_SCRIPT_DIRS

# Pre-create labels once (idempotent).
for label_spec in \
  "security:B60205:Security vulnerability" \
  "dependabot:0366D6:Dependabot-reported" \
  "triage-security:5319E7:Opened by triage-security skill" \
  "needs-human-review:FBCA04:Skill confidence below threshold" \
  "security-audit:C2E0C6:Permanent audit record for a triage-security dismissal"; do
  IFS=":" read -r lname lcolor ldesc <<<"$label_spec"
  gh label create "$lname" --color "$lcolor" --description "$ldesc" --repo "$REPO" 2>/dev/null || true
done

DISMISSED=(); OPENED=(); SKIPPED_ECOSYSTEM=(); SKIPPED_UNCLASS=(); ALLOWLISTED=()
AGREE=(); REFINE=(); DRIFT=(); OTHER=()

for i in $(seq 0 $((N_PROCESS-1))); do
  ALERT=$(jq ".[$i]" "$TMP/alerts.json")
  ALERT_NUM=$(jq -r '.number' <<<"$ALERT")
  ALERT_URL=$(jq -r '.html_url' <<<"$ALERT")
  ECOSYSTEM=$(jq -r '.security_vulnerability.package.ecosystem' <<<"$ALERT")
  PKG=$(jq -r '.security_vulnerability.package.name' <<<"$ALERT")
  SEVERITY=$(jq -r '.security_advisory.severity' <<<"$ALERT")
  GHSA_ID=$(jq -r '.security_advisory.ghsa_id' <<<"$ALERT")
  CVE_ID=$(jq -r '.security_advisory.cve_id // "n/a"' <<<"$ALERT")
  SUMMARY=$(jq -r '.security_advisory.summary' <<<"$ALERT")
  VULN_RANGE=$(jq -r '.security_vulnerability.vulnerable_version_range' <<<"$ALERT")
  FIRST_PATCHED=$(jq -r '.security_vulnerability.first_patched_version.identifier // "unknown"' <<<"$ALERT")
  MANIFEST_PATH=$(jq -r '.dependency.manifest_path' <<<"$ALERT")

  # Filter 1: ecosystem
  if [[ "$ECOSYSTEM" != "npm" ]]; then
    SKIPPED_ECOSYSTEM+=("$ALERT_NUM:$ECOSYSTEM")
    continue
  fi

  # Filter 2: allowlist
  if grep -qxF "$GHSA_ID" /tmp/ts_allowlisted_ghsas.txt 2>/dev/null; then
    ALLOWLISTED+=("$ALERT_NUM $PKG $GHSA_ID")
    continue
  fi

  # … Signal A/B/C classification per Phase 2 …
  # … if PROD: Phase 2.5 exploit-surface analysis …
  # … take action per Phase 3 …
done

# … print Phase 4 summary …
```

---

## Hard rules

1. **Only act on `state=open` alerts** in live mode. `--rerun-dismissed` is strictly read-only.
2. **Skip non-npm ecosystems.** Docker / GitHub Actions / pip alerts can appear — log and skip with no exit-code impact.
3. **Skip allowlisted GHSAs** from `.supply-chain/audit-allowlist.json`. The maintainer's risk-accept calls are authoritative — the skill must not override.
4. **Conservative default: when uncertain, open an issue.** A false-positive issue is one `gh issue close` away; a false-negative dismissal hides a real vuln.
5. **Two dismissal reasons, strict criteria.** Both share a uniform audit-trail requirement.
   - **`not_used`** — Signal C proved the package is not reachable from `subgraphs/*/src/**/*.ts`. Comment names the DEV paths (or "transitive of build-tooling" for the no-imports-anywhere case).
   - **`inaccurate`** — §2.5 proved CVE preconditions absent AND §2.5.6 returned `high` confidence. Comment names which Q failed.

   **Required side-effect for both: open a closed audit-trail issue (§3.1c) BEFORE the dismissal, embed the audit URL in `dismissed_comment`.** The 280-char comment alone is never a complete audit trail.

   **Never use `tolerable_risk`, `fix_started`, `no_bandwidth`.** Risk-accept is the maintainer's call (and lives in `.supply-chain/audit-allowlist.json`).
6. **Dedupe before opening.** Search existing open issues by GHSA ID; never spam duplicates on repeat runs.
7. **Don't dismiss with no evidence.** Skip + log if signals are inconclusive.
8. **Print stderr lines for skips.** The summary table is for the actor; per-alert skip lines are for the paginating human reviewer.
9. **Exit non-zero only if `unclassifiable` skips happened OR rerun-dismissed mode found DRIFT.** `non-npm-ecosystem` and `allowlisted` skips are expected — exiting on them would fire on every run, breaking any cron wrapper.
10. **Rerun-dismissed mode is strictly read-only.** No `gh api -X PATCH`, no `gh issue create`. Verdict-drift report to stdout only.

---

## Files / state mutated

| Surface | What changes |
| --- | --- |
| (rerun-dismissed mode) | Nothing — read-only report to stdout |
| Dependabot alerts — DEV-only (Signal C) | `state=dismissed`; `dismissed_reason=not_used`; comment = one-line summary + audit-issue URL |
| Dependabot alerts — PROD-but-not-applicable + high confidence | `state=dismissed`; `dismissed_reason=inaccurate`; comment = one-line summary + audit-issue URL |
| Closed audit-trail issues — one per dismissal | New issues opened **and immediately closed** with title `[Security-audit][closed] …`, labels `security,dependabot,triage-security,security-audit`. Searchable via `gh issue list --state closed --label security-audit`. |
| Repo issues — PROD-applicable | New issue, title `[Security][<sev>] <pkg>: <summary>`, labels `security,dependabot,triage-security`. Body carries the AS-reachability scan, §2.5 analysis, and a fix recipe that respects the repo's resolution-mirroring + audit-allowlist conventions. |
| Repo issues — PROD-not-applicable but autonomous-dismissal gate not met (moderate/low confidence) | Same as above, **additionally labeled `needs-human-review`**. Underlying Dependabot alert NOT dismissed. |
| Existing issues (dedupe match) | Skipped (no edit) |
| Labels | First-run idempotent creation of `security`, `dependabot`, `triage-security`, `needs-human-review`, `security-audit` |
| Working tree | Nothing — the skill only mutates GitHub state, not files. |

---

## When NOT to run this skill

- Wrong repo — the skill hard-fails Phase 0 unless `package.json` AND `subgraphs/` both exist.
- A dependency bump PR is in flight — the Signal C + Signal B logic reads the current working tree; mid-bump state could misclassify. Land the bump first, then triage.
- You're about to refresh `.supply-chain/audit-allowlist.json` — do that first so the skill sees the new allowlist entries and skips them. Order is: edit allowlist → run skill → review summary.
- Token doesn't have `security_events` (or admin) scope on the repo — Dependabot dismissals require it. `gh auth status` should show the right scope; otherwise the PATCH calls 403.
- You want non-npm alerts triaged — current scope is npm-only. If this repo ever adds Python / Docker workflows producing Dependabot alerts, Phase 2 would need parallel signal sets per ecosystem.

---

## Design notes

Key design decisions for this skill, with rationale:

| Decision | Choice | Why |
| --- | --- | --- |
| Sources | Dependabot only | Code Scanning is not enabled on this repo. The skill can be extended later if it is. |
| Archetype | Fixed at `subgraph-indexer` — narrow exploit-surface posture | The whole repo has one deployment model (WASM in Graph Node sandbox). No heuristic detection needed. |
| PROD path definition | Only `subgraphs/*/src/**/*.ts` (AssemblyScript sources) | These are the only files that compile into the deployed WASM. The AS compiler enforces this — most npm packages cannot even compile. Everything else is build-tooling that never ships. |
| Signal A weight | Low (treat as weak prior) | yarn.lock universally reports `scope=runtime` for transitives. Signal C (import-graph) is the decisive signal here. |
| Module resolution | Distribution name ≈ import name; scoped packages preserved as-is; `@types/*` short-circuited to DEV | npm naming is uniform enough that no special resolution is needed. `@types/*` is types-only — never reaches runtime. |
| `§2.5.6b` structural-impossibility check | Not used (N/A for this archetype) | The `subgraph-indexer` archetype is itself the deployed code, not a framework with unknowable consumers. Direct dismissal at high-conf is the right rule. |
| Audit-allowlist integration | Skip GHSAs already in `.supply-chain/audit-allowlist.json` | The maintainer's risk-accept calls are authoritative. The skill must not override them. |
| Fix recipe in opened issues | yarn `resolutions` (path-scoped if multi-major), mirrored across every `subgraphs/*/package.json` | Matches the repo's existing resolution-mirroring convention (CLAUDE.md "Yarn 1 gotcha"). |

The dismissal model — closed audit-trail issue + 280-char comment + uniform `security-audit` label — is source-language-agnostic and the same audit trail works for both `not_used` and `inaccurate` paths.

### What this skill learned (vs. its starting assumptions)

The skill was originally built on the assumption that Yarn 1 selective resolutions can't safely target multi-major trees — that's what the existing `.supply-chain/audit-allowlist.json` entries documented as their blocker. **PR #126 verified that assumption was wrong:**

- **`**/parent/child` path-scoped resolutions DO work** for multi-major trees, IF the `**/` prefix is included. Without it, Yarn 1 silently ignores the resolution for transitively-nested instances (adds the requested version to yarn.lock as an orphan entry, but doesn't rewire consumers).
- **Lockfile must be wiped** before reinstall. Yarn 1's lockfile is sticky — it won't re-resolve a previously-pinned version even when the resolution is correct. Recipe: `rm yarn.lock subgraphs/*/yarn.lock subgraphs/*/*/yarn.lock` then run `yarn install` in root + each subgraph.
- **Fresh-lockfile cascade clears more than you'd think.** A clean reinstall with both the path-scoped resolution AND yarn.lock removal will additionally bump every other transitive to its latest semver-compatible patch — minimatch, brace-expansion, yaml, even lodash.trim 4.5.1 → 4.18.0. One PR cleared 11 unique GHSAs (192 alerts) this way.

Operationally this means: **most "structurally unreachable but unfixable" allowlist entries are actually fixable**. Default to attempting a fix-PR before adding to the allowlist. The lookahead-cost (5 minutes of `yarn install` + `yarn audit:prod`) is much cheaper than the deferred-review cost.

---
