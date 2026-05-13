# Security Policy

This repository hosts subgraphs that are deployed to The Graph Studio and consumed by Olas dashboards, frontends, and analytics across the wider Autonolas ecosystem. A vulnerability in code shipped from this repo can affect every downstream consumer of an Olas subgraph endpoint.

## Reporting a Vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Instead, email **info@valory.xyz** with:

- The affected subgraph (e.g., `subgraphs/tokenomics-eth`).
- The affected network (e.g., Ethereum mainnet, Gnosis).
- A clear description of the vulnerability and its potential impact.
- Steps to reproduce, ideally including the relevant transaction hash, block number, or entity ID.
- Any proof-of-concept exploit you have, kept private.

We aim to acknowledge receipt within **72 hours** and work with you on triage, fix, and disclosure timelines.

## Scope

In scope:

- Mapping logic that produces incorrect indexed data or could be tricked into doing so.
- Build / deployment workflows ([`.github/workflows/`](.github/workflows/)) that could exfiltrate secrets or publish unauthorized subgraph versions.
- Dependency-chain compromises in `@graphprotocol/graph-cli`, `@graphprotocol/graph-ts`, `matchstick-as`, or any transitive dep that runs at install or build time.
- Misconfiguration of contract addresses, start blocks, or ABIs that could cause indexing of attacker-controlled data.
- Leakage of `SUBGRAPH_STUDIO_KEY` or any other deploy-auth credential.

Out of scope:

- Vulnerabilities in The Graph's hosted service itself (Subgraph Studio, Hosted Service, or Decentralized Network) — please report those to The Graph directly.
- Vulnerabilities in upstream smart contracts (`Tokenomics`, `Depository`, `ServiceRegistry`, etc.) — these are tracked in their respective repositories.
- Vulnerabilities in third-party dashboards or frontends that consume our subgraphs.
- Best-practice or defense-in-depth suggestions that do not correspond to a concrete attack scenario.
- Theoretical issues with no practical impact on indexed data, build artifacts, or deploy authentication.

## Supported Versions

Subgraph deployments are versioned per subgraph through The Graph Studio. Security fixes are applied on top of the currently-deployed version of each subgraph and re-published. We do not maintain backports for older deployed versions.

## Acknowledgements

We're grateful for responsible disclosure. Reporters who follow this policy will be credited in the relevant fix's release notes (with permission), unless they prefer to remain anonymous.
