# Legacy Mech Fees - Source

## Handler Architecture

The subgraph tracks two distinct mech types with separate but parallel handler chains:

**Legacy Mechs (LM)** - Direct user-to-mech interactions:
- `handleCreateMechLM` → Creates entity, instantiates LegacyMech template
- `handleRequest` → Tracks fee-in using mech's current price
- `handleExecLM` → Tracks fee-out (excluding burns)
- `handlePriceUpdateLM` → Updates mech price

**Legacy Marketplace Mechs (LMM)** - Marketplace-mediated interactions:
- `handleCreateMechLMM` → Creates entity, instantiates LegacyMechMarketPlace template
- `handleMarketplaceRequest` → Tracks fee-in via marketplace event
- `handleExecLMM` → Tracks fee-out (excluding burns)
- `handlePriceUpdateLMM` → Updates mech price

## Burn Address Filtering

Outgoing transfers to `0x153196110040a0c729227c603db3a6c6d91851b2` are excluded from fee-out totals. This prevents artificial inflation of outgoing fee statistics from burn operations.

Both `handleExecLM` and `handleExecLMM` check destination address and skip if it matches the burn address or amount is zero.

## Fee-In Calculation

Fee-in amount is determined by the mech's current price at the time of request:
- **LM mechs**: `handleRequest` reads `mech.price` directly from entity
- **LMM mechs**: `handleMarketplaceRequest` calls `getMechPrice()` which binds to the contract and reads current price

## Aggregation Layers

Each fee event updates three aggregation levels:
1. **Entity level** - `totalFeesIn`/`totalFeesOut` on individual mech
2. **Global level** - System-wide totals with type breakdown
3. **Daily level** - Both global (`DailyFees`) and per-mech (`MechDaily`)

Daily IDs use Unix timestamp truncated to day boundaries (86400 seconds).

## Price Lookup Fallback

`getMechPrice()` tries LMM contract binding first, falls back to LM binding. This handles marketplace requests that could target either mech type, though in practice marketplace requests target LMM mechs.

## Known Behaviors

### Silent Price Lookup Failure

`getMechPrice()` returns `0` when both contract bindings fail (both `try_price()` calls revert). In `handleMarketplaceRequest`, fees ≤ 0 trigger an early return with no logging:

```typescript
const fee = getMechPrice(mechAddress);
if (fee.le(BigInt.fromI32(0))) {
  return;  // Silent exit - no warning logged
}
```

**Impact**: If a marketplace request targets an address where price cannot be retrieved (wrong contract type, destroyed contract, RPC failure during sync), the entire request is dropped from indexed data without any trace.

**When this can happen**:
- Marketplace routes request to non-mech address
- Contract upgraded or self-destructed between creation and request
- Temporary RPC issues during subgraph indexing

### Asymmetric Null Mech Handling

The two fee-in handlers behave differently when the mech entity doesn't exist:

**LM handler (`handleRequest`)**:
```typescript
if (mech == null) {
  log.warning('Request received for unknown LegacyMech...');
  return;  // Early exit - NO global/daily updates
}
```

**LMM handler (`handleMarketplaceRequest`)**:
```typescript
if (mech != null) {
  // Update mech...
} else {
  log.warning('Marketplace request received for unknown LegacyMechMarketPlace...');
}
// CONTINUES regardless - updates Global and DailyFees
updateGlobalFeesInLegacyMechMarketPlace(fee);
```

**Impact**: For unknown LMM mechs, fees are counted in `Global.totalFeesInLegacyMechMarketPlace` and `DailyFees.totalFeesInLegacyMechMarketPlace` but not in any individual mech's `totalFeesIn`. This creates "orphaned fees" where:

```
Sum of all LegacyMechMarketPlace.totalFeesIn ≠ Global.totalFeesInLegacyMechMarketPlace
```

This asymmetry is intentional - marketplace requests are recorded at the global level even when the specific mech isn't tracked, ensuring fee totals reflect actual blockchain activity.
