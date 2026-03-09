# Contributing to `autonolas-subgraph-studio`

First off, thank you for taking the time to contribute! This document describes how to propose changes, report issues,
and participate in the development of this repository.

For repository structure, development setup, multi-network patterns, and how to add a new subgraph, please refer to the [README](README.md).

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Security & Responsible Disclosure](#security--responsible-disclosure)
  - [Pull Requests](#pull-requests)
- [Testing Guidelines](#testing-guidelines)
- [Commit Messages & Branching](#commit-messages--branching)
- [Deployment](#deployment)
- [License](#license)
- [Contact](#contact)

---

## Code of Conduct

This project adheres to the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to **security@valory.xyz**.

---

## How Can I Contribute?

### Reporting Bugs

1. **Search existing issues** to avoid duplicates.
2. **Open a new issue** with a clear title and description.
3. Include the affected subgraph, network, and any relevant entity IDs or transaction hashes.

### Suggesting Enhancements

- Explain the motivation and expected impact.
- Specify which subgraph(s) and network(s) are affected.
- Consider compatibility with existing indexed data and entity schemas.

### Security & Responsible Disclosure

**Do not** open public GitHub issues for security vulnerabilities. Instead:

- Email **security@valory.xyz** with a detailed report.
- Include the affected subgraph, potential impact, and steps to reproduce.

We aim to acknowledge receipt within 72 hours.

### Pull Requests

1. Fork the repo and create your branch from `main`.
2. If you've added or changed handler logic, add tests.
3. Ensure the subgraph builds for all affected networks and tests pass.
4. Open a PR with a clear description of the change and reasoning.

**PR Checklist:**

- [ ] Self-reviewed, no debug logs or dead code.
- [ ] Build passes for all affected network manifests.
- [ ] `yarn test` passes (if Matchstick tests exist for the subgraph).
- [ ] Schema changes are backward-compatible or migration is documented.
- [ ] New ABIs added to root `abis/` directory and referenced in manifests.
- [ ] Subgraph `package.json` includes `codegen`, `build`, and `test` scripts.

---

## Testing Guidelines

Tests use the [Matchstick](https://thegraph.com/docs/en/developing/unit-testing-framework/) framework (AssemblyScript-based).

- Place test files in your subgraph's `tests/` directory with `.test.ts` extension.
- Use `clearStore()` in `afterEach` to reset entity state between tests.
- Use `dataSourceMock.setNetwork()` to set the network context.
- Use `createMockedFunction()` to mock on-chain contract calls.
- Assert entity state with `assert.fieldEquals()` and `assert.entityCount()`.

---

## Commit Messages & Branching

- Use **Conventional Commits**:
  - `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`
- Branch names:
  - `feat/<short-topic>`, `fix/<short-topic>`, `docs/<short-topic>`
- Reference issues/PRs in the body (e.g., `Closes #123`).

---

## Deployment

Deployment is handled via **CI/CD**. Each subgraph is built and deployed automatically from its own directory. See the [README](README.md) for the development workflow.

---

## License

This project is licensed under the **Apache License 2.0**. See `LICENSE`.

---

## Contact

- General questions: **info@valory.xyz**
- Security: **security@valory.xyz**

Thank you for contributing!
