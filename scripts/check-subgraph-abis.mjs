#!/usr/bin/env node
/**
 * check-subgraph-abis.mjs — manifest ABI-coverage triage for all subgraphs.
 *
 * WHY THIS EXISTS
 * ---------------
 * A subgraph handler can only `.bind()` a contract whose ABI is declared in the
 * *same data source's* `abis:` list. If a handler (or any helper it calls)
 * binds a contract that isn't declared there, indexing fails at runtime with:
 *
 *     Could not find ABI for contract "X" ... in handler `h`
 *
 * `graph build` does NOT catch this — ABIs are resolved at index time, not
 * compile time — and Matchstick can't catch it either (it mocks calls by
 * address+signature regardless of the manifest). So a real Basius service
 * action can crash a freshly-deployed subgraph that built and tested clean.
 * That is exactly how babydegen-base broke (ServiceRegistryL2 →
 * handleCreateMultisigWithAgents → getEthUsd → AggregatorV3Interface.bind,
 * with the feed ABI undeclared).
 *
 * WHAT IT DOES
 * ------------
 * For every data source / template in every subgraph manifest, it walks the
 * function-level call graph from the declared handler functions (following
 * local `./` imports) and collects every generated contract class that gets
 * `.bind()`-ed along the way. Anything bound but not declared is reported.
 *
 * KNOWN LIMITATION — OVER-APPROXIMATION
 * -------------------------------------
 * The walk does not model runtime guards. In babydegen the heavy position
 * refresh (`refreshAllActivePositions`, which binds the pool/gauge contracts)
 * runs only under `calculatePortfolioMetrics(..., takeSnapshot = true)`, and
 * only the PortfolioScheduler block handler passes `true`. The checker can't
 * see that boolean, so it reports pool/gauge ABIs as "missing" on token /
 * funding / Safe / LiFi data sources that reach `calculatePortfolioMetrics`
 * with the default `false` and therefore never actually bind them. Those are
 * false positives (confirmed: babydegen-optimism has run in production with
 * the same shape). Treat the output as a *candidate list to review against the
 * code's guards*, not a definitive bug list.
 *
 * Because of that, this is REPORT-ONLY by default (always exits 0). Pass
 * `--strict` to exit non-zero when anything is reported (useful once a project
 * has driven the candidate list down / added suppressions).
 *
 * Usage:  node scripts/check-subgraph-abis.mjs [repoRoot] [--strict]
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const STRICT = argv.includes("--strict");
const ROOT = resolve(argv.find((a) => !a.startsWith("--")) || process.cwd());

// ---- source sanitizer: blank comments + string contents so brace/`(` scanning
//      isn't fooled by punctuation inside literals. (Imports are parsed from the
//      RAW source instead, since this would destroy `from "./path"` specs.) ----
function sanitize(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      out += '""'; continue;
    }
    out += c;
  }
  return out;
}

const fileCache = new Map();

function analyzeFile(absPath) {
  if (fileCache.has(absPath)) return fileCache.get(absPath);
  let raw;
  try { raw = readFileSync(absPath, "utf8"); }
  catch { const e = { importMap: new Map(), funcs: new Map() }; fileCache.set(absPath, e); return e; }
  const dir = dirname(absPath);

  // imports from RAW source (sanitize() would blank the path strings)
  const importMap = new Map();
  const importRe = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  let m;
  while ((m = importRe.exec(raw))) {
    const spec = m[2];
    const idents = m[1].split(",").map((s) => {
      const parts = s.trim().split(/\s+as\s+/);
      return { orig: parts[0].trim(), local: (parts[1] || parts[0]).trim() };
    }).filter((x) => x.orig);
    if (spec.includes("generated/")) {
      // Key by local alias, keep the ORIGINAL generated class name — that's the
      // contract name the runtime resolves against `abis:` (handles aliases like
      // `import { StakingProxy as StakingProxyContract }`).
      idents.forEach((x) => importMap.set(x.local, { kind: "generated", name: x.orig }));
    } else if (spec.startsWith(".")) {
      const rf = resolveImport(dir, spec);
      idents.forEach((x) => importMap.set(x.local, { kind: "local", file: rf, orig: x.orig }));
    }
  }

  const src = sanitize(raw);
  const funcs = new Map();
  const fnRe = /(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = fnRe.exec(src))) {
    const name = m[1];
    let i = fnRe.lastIndex, depthParen = 1;
    while (i < src.length && depthParen > 0) { if (src[i] === "(") depthParen++; else if (src[i] === ")") depthParen--; i++; }
    while (i < src.length && src[i] !== "{") i++;
    if (src[i] !== "{") continue;
    let depth = 0, start = i;
    for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
    const body = src.slice(start, i);
    const bound = new Set();
    let b; const bindRe = /([A-Za-z_$][\w$]*)\s*\.\s*bind\s*\(/g;
    while ((b = bindRe.exec(body))) bound.add(b[1]);
    const calls = new Set();
    let c; const callRe = /([A-Za-z_$][\w$]*)\s*\(/g;
    while ((c = callRe.exec(body))) calls.add(c[1]);
    funcs.set(name, { bound, calls });
  }

  const entry = { importMap, funcs };
  fileCache.set(absPath, entry);
  return entry;
}

function resolveImport(fromDir, spec) {
  const base = resolve(fromDir, spec);
  for (const cand of [base, base + ".ts", join(base, "index.ts")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function reachableBinds(entryAbs, entryFuncNames) {
  const bound = new Set();
  const seen = new Set();
  const stack = entryFuncNames.map((fn) => `${entryAbs}::${fn}`);
  while (stack.length) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const sep = key.lastIndexOf("::");
    const file = key.slice(0, sep), fn = key.slice(sep + 2);
    const info = analyzeFile(file);
    const def = info.funcs.get(fn);
    if (!def) continue;
    for (const bnd of def.bound) {
      const im = info.importMap.get(bnd);
      if (im && im.kind === "generated") bound.add(im.name || bnd);
    }
    for (const callee of def.calls) {
      if (info.funcs.has(callee)) { stack.push(`${file}::${callee}`); continue; }
      const im = info.importMap.get(callee);
      if (im && im.kind === "local" && im.file) stack.push(`${im.file}::${im.orig}`);
    }
  }
  return bound;
}

function parseManifest(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const sections = [];
  let cur = null, inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(dataSources|templates):\s*$/.test(line)) { inBlock = true; continue; }
    if (/^[a-zA-Z]/.test(line) && !/^(dataSources|templates):/.test(line)) inBlock = false;
    if (!inBlock) continue;
    if (/^ {2}- (kind|name):/.test(line)) { if (cur) sections.push(cur); cur = { name: null, file: null, abis: [], handlers: [] }; }
    if (!cur) continue;
    const nameM = line.match(/^ {4}name:\s*(\S+)/); if (nameM && !cur.name) cur.name = nameM[1];
    const fileM = line.match(/^ {6}file:\s*(\S+)/); if (fileM) cur.file = fileM[1];
    const abiM = line.match(/^ {8,}- name:\s*(\S+)/); if (abiM) cur.abis.push(abiM[1]);
    const hM = line.match(/^ {8,}handler:\s*(\S+)/); if (hM) cur.handlers.push(hM[1]);
  }
  if (cur) sections.push(cur);
  return sections.filter((s) => s.file && s.handlers.length);
}

function findManifests(root) {
  const out = [];
  const subRoot = join(root, "subgraphs");
  if (!existsSync(subRoot)) return out;
  for (const entry of readdirSync(subRoot)) {
    const p = join(subRoot, entry);
    if (!statSync(p).isDirectory()) continue;
    const candidates = [p, ...readdirSync(p).map((c) => join(p, c)).filter((c) => { try { return statSync(c).isDirectory(); } catch { return false; } })];
    for (const c of candidates) {
      const tpl = join(c, "subgraph.template.yaml");
      const plain = join(c, "subgraph.yaml");
      if (existsSync(tpl)) out.push(tpl);
      else if (existsSync(plain)) out.push(plain);
      else { const pn = readdirSync(c).filter((f) => /^subgraph\..+\.yaml$/.test(f)).sort()[0]; if (pn) out.push(join(c, pn)); }
    }
  }
  return out;
}

let candidates = 0;
for (const manifest of findManifests(ROOT)) {
  const dir = dirname(manifest);
  for (const s of parseManifest(manifest)) {
    const entryAbs = resolve(dir, s.file);
    if (!existsSync(entryAbs)) continue;
    const needed = reachableBinds(entryAbs, s.handlers);
    const declared = new Set(s.abis);
    const missing = [...needed].filter((n) => !declared.has(n));
    if (missing.length) {
      candidates++;
      console.log(`\n• ${manifest.replace(ROOT + "/", "")}  [${s.name}]  ${s.file}`);
      console.log(`    handlers:        ${s.handlers.join(", ")}`);
      console.log(`    not declared:    ${missing.join(", ")}`);
    }
  }
}

if (candidates) {
  console.log(`\n${candidates} data source(s) bind a contract not in their abis: list (review against runtime guards).`);
  console.log("NOTE: over-approximates — branch-guarded binds (e.g. snapshot-only refresh) show up here but may never execute.");
} else {
  console.log("\nNo undeclared reachable contract binds found. ✓");
}
process.exit(STRICT && candidates ? 1 : 0);
