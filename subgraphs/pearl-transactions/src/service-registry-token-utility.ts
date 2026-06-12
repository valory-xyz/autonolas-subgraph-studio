import { Address } from "@graphprotocol/graph-ts";
import {
  TokenDeposit as TokenDepositEvent,
  TokenRefund as TokenRefundEvent,
} from "../generated/ServiceRegistryTokenUtility/ServiceRegistryTokenUtility";
import { BondMovement, TrackedAddress } from "../generated/schema";
import {
  CATEGORY_SERVICE_BOND_DEPOSIT,
  CATEGORY_SERVICE_BOND_REFUND,
  ROLE_MASTER,
  SOURCE_SEMANTIC,
} from "./constants";
import {
  enqueuePendingBondRow,
  fundsMovementId,
  upsertTokenBalance,
} from "./utils";

// isTrackedMaster — the SRTU `account` is the bond payer, which in Pearl
// is the Master Safe. Guarded to addresses already tracked as MASTER so
// non-Pearl bonds stay unlinked (and don't touch TokenBalance).
function isTrackedMaster(account: Address): TrackedAddress | null {
  const tracked = TrackedAddress.load(account);
  if (tracked != null && tracked.role == ROLE_MASTER) {
    return tracked;
  }
  return null;
}

// handleTokenDeposit — fires once per activateRegistrationTokenDeposit
// (security deposit) and once per registerAgentsTokenDeposit (agent
// bond). The two share an event signature and carry no serviceId, so we
// create the row here (we own the amount + logIndex id) without
// serviceId/bondType, and enqueue it; the immediately-following
// ServiceRegistryL2 event (ActivateRegistration / RegisterInstance)
// backfills serviceId + bondType via dequeueAndAttribute. If no such
// event follows, the row stays attribution-less (amount preserved).
//
// TokenBalance: the raw Master Safe ↔ SRTU Transfer is suppressed in
// classifyTransfer (deduped against this SEMANTIC row), so the bond's
// balance effect is booked HERE, exactly once — otherwise the Master
// Safe's balance would overstate by the bonded amount for the whole
// staking period.
export function handleTokenDeposit(event: TokenDepositEvent): void {
  const row = new BondMovement(fundsMovementId(event));
  row.category = CATEGORY_SERVICE_BOND_DEPOSIT;
  row.source = SOURCE_SEMANTIC;
  row.token = event.params.token;
  row.amount = event.params.amount;
  row.from = event.params.account;
  row.to = event.address;
  const master = isTrackedMaster(event.params.account);
  if (master != null) {
    row.masterSafe = master.masterSafe;
    // Bond leaves the Master Safe → debit.
    upsertTokenBalance(
      event.params.account,
      Address.fromBytes(event.params.token),
      event.params.amount.neg(),
      event,
      /* isDelta = */ true
    );
  }
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();

  enqueuePendingBondRow(event.transaction.hash, row.id);
}

// handleTokenRefund — mirror of handleTokenDeposit for the unstake
// cycle. Backfilled by the following TerminateService (SECURITY_DEPOSIT)
// or OperatorUnbond (AGENT_BOND) ServiceRegistryL2 event in the same tx.
export function handleTokenRefund(event: TokenRefundEvent): void {
  const row = new BondMovement(fundsMovementId(event));
  row.category = CATEGORY_SERVICE_BOND_REFUND;
  row.source = SOURCE_SEMANTIC;
  row.token = event.params.token;
  row.amount = event.params.amount;
  row.from = event.address;
  row.to = event.params.account;
  const master = isTrackedMaster(event.params.account);
  if (master != null) {
    row.masterSafe = master.masterSafe;
    // Bond returns to the Master Safe → credit (mirror of the deposit debit).
    upsertTokenBalance(
      event.params.account,
      Address.fromBytes(event.params.token),
      event.params.amount,
      event,
      /* isDelta = */ true
    );
  }
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();

  enqueuePendingBondRow(event.transaction.hash, row.id);
}
