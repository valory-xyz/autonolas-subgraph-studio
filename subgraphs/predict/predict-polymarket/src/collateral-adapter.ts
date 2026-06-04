import { PositionsRedeemed as PositionsRedeemedEvent } from "../generated/CtfCollateralAdapter/CtfCollateralAdapter";
import { processRedemption } from "./utils";
import { PAYOUT_SOURCE_COLLATERAL_ADAPTER } from "./constants";

// Post-v2 cutover, agents redeem via CtfCollateralAdapter (standard markets) or
// NegRiskCtfCollateralAdapter (neg-risk markets). Both wrap USDC.e → pUSD inside
// the redeem tx, so the legacy `PayoutRedemption` events from CTF / NegRiskAdapter
// fire with `redeemer = adapter`, not the agent — and our existing handlers
// silently early-return at the `TraderAgent.load(redeemer) == null` check.
//
// `PositionsRedeemed` is the adapter-side event whose `initiator` is the Safe and
// whose `payout` is the actual pUSD paid out. Both adapters emit the same event
// signature, so all four dataSources (old/new × standard/neg-risk) share this
// handler.
export function handlePositionsRedeemed(
  event: PositionsRedeemedEvent,
): void {
  processRedemption(
    event.params.initiator,
    event.params.conditionId,
    event.params.payout,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    event.logIndex.toI32(),
    PAYOUT_SOURCE_COLLATERAL_ADAPTER,
  );
}
