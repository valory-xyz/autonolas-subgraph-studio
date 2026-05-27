import {
  TokenDeposit as TokenDepositEvent,
  TokenRefund as TokenRefundEvent,
} from "../generated/ServiceRegistryTokenUtility/ServiceRegistryTokenUtility";
import { FundsMovement } from "../generated/schema";
import {
  CATEGORY_SERVICE_BOND_DEPOSIT,
  CATEGORY_SERVICE_BOND_REFUND,
  SOURCE_SEMANTIC,
} from "./constants";
import { consumeBondAttribution, fundsMovementId } from "./utils";

// handleTokenDeposit — fires once per
// activateRegistrationTokenDeposit (security deposit) and once per
// registerAgentsTokenDeposit (agent bond) within a stake-cycle
// multicall. The two share an event signature; serviceId and bondType
// are reconstructed via the per-tx attribution queue populated by
// ServiceRegistryL2 handlers (ActivateRegistration / RegisterInstance).
export function handleTokenDeposit(event: TokenDepositEvent): void {
  const account = event.params.account;
  const token = event.params.token;
  const amount = event.params.amount;

  const attribution = consumeBondAttribution(event.transaction.hash);

  const row = new FundsMovement(fundsMovementId(event));
  if (attribution !== null) {
    row.service = attribution.serviceId.toString();
    row.bondType = attribution.bondType;
  }
  row.category = CATEGORY_SERVICE_BOND_DEPOSIT;
  row.source = SOURCE_SEMANTIC;
  row.token = token;
  row.amount = amount;
  row.from = account;
  row.to = event.address;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();
}

// handleTokenRefund — mirror of handleTokenDeposit for the
// unstake-cycle. Attribution comes from TerminateService (SECURITY_DEPOSIT)
// and OperatorUnbond (AGENT_BOND) ServiceRegistryL2 events fired
// earlier in the same tx.
export function handleTokenRefund(event: TokenRefundEvent): void {
  const account = event.params.account;
  const token = event.params.token;
  const amount = event.params.amount;

  const attribution = consumeBondAttribution(event.transaction.hash);

  const row = new FundsMovement(fundsMovementId(event));
  if (attribution !== null) {
    row.service = attribution.serviceId.toString();
    row.bondType = attribution.bondType;
  }
  row.category = CATEGORY_SERVICE_BOND_REFUND;
  row.source = SOURCE_SEMANTIC;
  row.token = token;
  row.amount = amount;
  row.from = event.address;
  row.to = account;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();
}
