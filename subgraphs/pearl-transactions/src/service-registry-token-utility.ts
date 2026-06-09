import { Address } from "@graphprotocol/graph-ts";
import {
  TokenDeposit as TokenDepositEvent,
  TokenRefund as TokenRefundEvent,
} from "../generated/ServiceRegistryTokenUtility/ServiceRegistryTokenUtility";
import { FundsMovement, TrackedSafe } from "../generated/schema";
import {
  CATEGORY_SERVICE_BOND_DEPOSIT,
  CATEGORY_SERVICE_BOND_REFUND,
  SOURCE_SEMANTIC,
} from "./constants";
import { enqueuePendingBondRow, fundsMovementId } from "./utils";

// linkBondMasterSafe — the SRTU `account` is the bond payer, which in
// Pearl is the Master Safe. Stamp it onto the SEMANTIC bond row so the
// wallet (which filters FundsMovement by masterSafe) surfaces this row
// directly — the RAW_TRANSFER duplicate that used to carry the link is
// now suppressed in classifyTransfer. Guarded to addresses already
// tracked as MASTER so non-Pearl bonds stay unlinked.
function linkBondMasterSafe(row: FundsMovement, account: Address): void {
  const tracked = TrackedSafe.load(account);
  if (tracked != null && tracked.role == "MASTER") {
    row.masterSafe = tracked.masterSafe;
  }
}

// handleTokenDeposit — fires once per activateRegistrationTokenDeposit
// (security deposit) and once per registerAgentsTokenDeposit (agent
// bond). The two share an event signature and carry no serviceId, so we
// create the row here (we own the amount + logIndex id) without
// serviceId/bondType, and enqueue it; the immediately-following
// ServiceRegistryL2 event (ActivateRegistration / RegisterInstance)
// backfills serviceId + bondType via dequeueAndAttribute. If no such
// event follows, the row stays attribution-less (amount preserved).
export function handleTokenDeposit(event: TokenDepositEvent): void {
  const row = new FundsMovement(fundsMovementId(event));
  row.category = CATEGORY_SERVICE_BOND_DEPOSIT;
  row.source = SOURCE_SEMANTIC;
  row.token = event.params.token;
  row.amount = event.params.amount;
  row.from = event.params.account;
  row.to = event.address;
  linkBondMasterSafe(row, event.params.account);
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
  const row = new FundsMovement(fundsMovementId(event));
  row.category = CATEGORY_SERVICE_BOND_REFUND;
  row.source = SOURCE_SEMANTIC;
  row.token = event.params.token;
  row.amount = event.params.amount;
  row.from = event.address;
  row.to = event.params.account;
  linkBondMasterSafe(row, event.params.account);
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();

  enqueuePendingBondRow(event.transaction.hash, row.id);
}
