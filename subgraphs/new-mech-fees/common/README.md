# Common Utilities

Shared code for all payment model handlers in the new-mech-fees subgraph.

## Raw Unit Semantics

The `totalFeesInRaw` / `totalFeesOutRaw` and `amountRaw` fields store values in **payment-model-specific units** that are NOT comparable across models:

| Model | Raw Unit | Precision |
| ----- | -------- | --------- |
| `native` | wei (xDAI on Gnosis, ETH on Base) | 10^18 |
| `token` | OLAS wei | 10^18 |
| `nvm` | Credits (from `deliveryRate`) | Dimensionless |

Use `MechModel` entity to get per-model raw totals. The aggregate `Mech.totalFeesInRaw` mixes incompatible units if the mech participates in multiple models.

## NVM Credit Conversion

NVM fees use abstract "credits" internally. The credit→USD conversion differs by network:

**Gnosis (xDAI settlement):**
```
USD = credits × TOKEN_RATIO_GNOSIS / (1e18 × 1e18)
    = credits × 990000000000000000000000000000 / 1e36
```

**Base (USDC settlement):**
```
USD = credits × TOKEN_RATIO_BASE / (1e18 × 1e6)
    = credits × 990000000000000000 / 1e24
```

The ratios encode the token price assumption (0.99 USD per credit unit after platform fee).

## Fee-Out Credit Reconstruction

For NVM `FEE_OUT` (withdrawals), the raw amount stores reconstructed credits, not settlement token wei. This maintains credit-level consistency:

```typescript
// Gnosis: xDAI wei → credits
credits = xdai_wei × 1e18 × 1e18 / TOKEN_RATIO_GNOSIS

// Base: USDC → credits
credits = usdc × 1e18 × 1e6 / TOKEN_RATIO_BASE
```

This allows `totalFeesInRaw - totalFeesOutRaw` to yield a meaningful credit balance within the NVM model.

## Daily Aggregation Zero-Check Logic

Daily aggregation functions use different skip conditions based on the fields they track:

**DailyTotals** (global totals across all mechs):
- Tracks: USD only
- Skip condition: `amountUsd <= 0`
- Rationale: Since only USD is tracked, skip if USD has no value

**MechDaily** (per-mech totals):
- Tracks: Both USD and raw values
- Skip condition: `amountUsd <= 0 AND amountRaw <= 0`
- Rationale: Update if either metric has value, since both are tracked independently

This allows MechDaily to record transactions where USD conversion fails (returns 0) but raw amount exists, preserving raw-value continuity for debugging.

## USD Conversion Functions

| Function | Network | Input | Output |
| -------- | ------- | ----- | ------ |
| `convertGnosisNativeWeiToUsd` | Gnosis | xDAI wei | USD (1:1) |
| `convertBaseNativeWeiToUsd` | Base | ETH wei + Chainlink price | USD |
| `calculateGnosisNvmFeesIn` | Gnosis | Credits | USD via token ratio |
| `calculateBaseNvmFeesIn` | Base | Credits | USD (via USDC, assuming 1:1 parity) |
| `calculateBaseNvmFeesInUsd` | Base | Credits + Chainlink price | USD |
| `calculateOlasInUsd` | Both | OLAS wei | USD via Balancer pool |
