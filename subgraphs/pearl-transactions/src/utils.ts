import {
  Address,
  BigInt,
  Bytes,
  dataSource,
  ethereum,
  log,
} from "@graphprotocol/graph-ts";
import {
  AgentBondAttributionGuard,
  AgentFundingEvent,
  AgentSafe,
  DailyServiceFunds,
  FundsMovement,
  MasterSafe,
  PendingBondCounter,
  PendingBondRow,
  PendingRegistration,
  Service,
  ServiceIndex,
  StakingContract,
  Token,
  TokenBalance,
  TrackedEOA,
  TrackedSafe,
} from "../generated/schema";
import { GnosisSafe } from "../generated/ServiceRegistryL2/GnosisSafe";
import { Safe as SafeTemplate } from "../generated/templates";
import {
  BOND_TYPE_AGENT_BOND,
  CATEGORY_OTHER,
  CATEGORY_SAFE_DEPLOYED,
  CATEGORY_SAFE_SETUP_TRANSFER,
  SERVICE_STATE_REGISTERED,
  SOURCE_SEMANTIC,
  getOlasAddress,
  getServiceRegistryAddress,
  getSrtuAddress,
  getStablecoinSymbol,
  getWrappedNativeAddress,
  getWrappedNativeSymbol,
} from "./constants";

// --- ID helpers ------------------------------------------------------

// Real event-derived IDs: txHash + logIndex. Matches the The-Graph
// canonical pattern used across the repo.
export function fundsMovementId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

// Synthetic-row IDs use a string-prefix Bytes so they cannot collide
// with real log-derived IDs (which are pure 32-byte-tx + 4-byte-logIndex
// concatenations). Both prefix and the appended Safe address are kept
// stable across replays.
export function safeDeployedId(masterSafe: Bytes): Bytes {
  return Bytes.fromUTF8("safe-deployed:").concat(masterSafe);
}

export function serviceIndexId(serviceId: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(serviceId));
}

export function pendingRegistrationId(serviceId: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(serviceId));
}

export function agentBondAttributionGuardId(
  txHash: Bytes,
  serviceId: BigInt
): Bytes {
  return txHash.concat(Bytes.fromByteArray(Bytes.fromBigInt(serviceId)));
}

export function pendingBondRowId(txHash: Bytes, slot: i32): Bytes {
  return txHash.concatI32(slot);
}

// --- Network ---------------------------------------------------------

export function currentNetwork(): string {
  return dataSource.network();
}

// --- MasterSafe ------------------------------------------------------

// getOrCreateMasterSafe — first-sighting derivation per plan §4.4 / §5.2.
//
// On creation:
//   1. eth_call GnosisSafe.getOwners() and GnosisSafe.getThreshold() to
//      populate masterEoa / owners / threshold.
//   2. Emit a SAFE_DEPLOYED FundsMovement row anchoring the consumer
//      wallet UI's "Setup complete" entry.
//
// Idempotent on subsequent calls: only lastActivityTimestamp is bumped.
export function getOrCreateMasterSafe(
  address: Address,
  event: ethereum.Event
): MasterSafe | null {
  let masterSafe = MasterSafe.load(address);
  if (masterSafe != null) {
    masterSafe.lastActivityTimestamp = event.block.timestamp;
    masterSafe.save();
    return masterSafe;
  }

  // Confirm `address` is actually a Gnosis Safe before treating it as a
  // Master Safe. The service NFT also lands on non-Safe recipients — a
  // staking proxy (when a service is staked), an EOA, etc. — none of
  // which are Master Safes. A real Safe always answers getOwners();
  // everything else reverts. On revert (or empty owners) we skip
  // entirely: no MasterSafe entity, no SAFE_DEPLOYED row, and the caller
  // leaves any existing service.masterSafe link untouched. (Phase 1b
  // replaces this probe with an explicit StakingContract allowlist.)
  const safeContract = GnosisSafe.bind(address);
  const ownersResult = safeContract.try_getOwners();
  if (ownersResult.reverted || ownersResult.value.length == 0) {
    log.info(
      "Skipping non-Safe NFT recipient {} (getOwners reverted/empty) (tx {})",
      [address.toHexString(), event.transaction.hash.toHexString()]
    );
    return null;
  }

  masterSafe = new MasterSafe(address);
  masterSafe.network = currentNetwork();
  masterSafe.firstSeenTimestamp = event.block.timestamp;
  masterSafe.firstSeenBlock = event.block.number;
  // Rev. 4 — historyFloor* mirror firstSeen* but are the consumer
  // UI's anchor for "History starts here" (§6.2). Separate fields so
  // the contract is explicit.
  masterSafe.historyFloorTimestamp = event.block.timestamp;
  masterSafe.historyFloorBlock = event.block.number;
  masterSafe.lastActivityTimestamp = event.block.timestamp;
  masterSafe.setupTransferSeen = false;

  // Pearl's flow guarantees owners[0] == Master EOA (1-of-2 with a
  // non-signing backup).
  const ownersAsBytes: Bytes[] = [];
  for (let i = 0; i < ownersResult.value.length; i++) {
    ownersAsBytes.push(ownersResult.value[i]);
  }
  masterSafe.owners = ownersAsBytes;
  masterSafe.masterEoa = ownersResult.value[0];

  const thresholdResult = safeContract.try_getThreshold();
  masterSafe.threshold = thresholdResult.reverted
    ? BigInt.zero()
    : thresholdResult.value;

  masterSafe.save();

  // Emit SAFE_DEPLOYED anchor row.
  emitSafeDeployedRow(masterSafe, event);

  // Phase 2a: track the Master Safe (role=MASTER) and Master EOA
  // (role=MASTER_EOA), and spawn the Safe template so we capture native
  // receipts + owner-list updates from this block onward.
  //
  // Per the AC #3 / Path A decision (plan Rev. 5, §6.2), the subgraph
  // does NOT emit opening-balance rows: opening balances are derived
  // frontend-side via archive RPC (balanceOf / eth_getBalance) at
  // historyFloorBlock. The first LIVE Master EOA → Master Safe inbound
  // hop is tagged SAFE_SETUP_TRANSFER by classifyTransfer (gated on
  // setupTransferSeen, set false above); subsequent hops are
  // MASTER_FUNDING_IN.
  upsertTrackedSafe(address, "MASTER", masterSafe.id, null);
  if (masterSafe.masterEoa.length > 0 && !masterSafe.masterEoa.equals(Address.zero())) {
    upsertTrackedEOA(
      Address.fromBytes(masterSafe.masterEoa),
      "MASTER_EOA",
      masterSafe.id,
      null,
      event.block.number
    );
  }
  SafeTemplate.create(address);

  return masterSafe;
}

function emitSafeDeployedRow(
  masterSafe: MasterSafe,
  event: ethereum.Event
): void {
  const row = new FundsMovement(safeDeployedId(masterSafe.id));
  row.masterSafe = masterSafe.id;
  row.category = CATEGORY_SAFE_DEPLOYED;
  row.source = SOURCE_SEMANTIC;
  row.amount = BigInt.zero();
  row.from = Address.zero();
  row.to = masterSafe.id;
  row.blockNumber = event.block.number;
  row.blockTimestamp = event.block.timestamp;
  row.transactionHash = event.transaction.hash;
  row.save();
}

// isStakingContract — true if `addr` corresponds to an indexed
// StakingContract entity. Used by handleServiceNftTransfer in Phase 1b
// to skip Master Safe derivation on the NFT → staking-proxy hop
// (avoids the getOwners() revert + warning log for proxy addresses).
export function isStakingContract(addr: Address): boolean {
  return StakingContract.load(addr) != null;
}

// --- AgentSafe -------------------------------------------------------

export function getOrCreateAgentSafe(
  address: Address,
  service: Service,
  event: ethereum.Event
): AgentSafe {
  let agentSafe = AgentSafe.load(address);
  if (agentSafe != null) {
    return agentSafe;
  }
  agentSafe = new AgentSafe(address);
  agentSafe.service = service.id;
  if (service.masterSafe !== null) {
    agentSafe.masterSafe = service.masterSafe;
  }
  agentSafe.createdTimestamp = event.block.timestamp;
  agentSafe.save();

  // Phase 2a: track as TrackedSafe (role=AGENT), spawn Safe template,
  // and add any operators recorded on the Service so far as
  // TrackedEOAs (role=AGENT_EOA). Additional operators registered
  // later are picked up incrementally in handleRegisterInstance.
  if (service.masterSafe !== null) {
    upsertTrackedSafe(
      address,
      "AGENT",
      service.masterSafe!,
      service.id
    );
  }
  SafeTemplate.create(address);
  const operators = service.operators;
  for (let i = 0; i < operators.length; i++) {
    upsertTrackedEOA(
      Address.fromBytes(operators[i]),
      "AGENT_EOA",
      service.masterSafe,
      service.id,
      event.block.number
    );
  }
  return agentSafe;
}

// --- Service ---------------------------------------------------------

export function getOrCreateService(
  serviceId: BigInt,
  event: ethereum.Event
): Service {
  const id = serviceId.toString();
  let service = Service.load(id);
  if (service != null) {
    return service;
  }
  service = new Service(id);
  service.serviceId = serviceId;
  service.agentIds = [];
  service.operators = [];
  service.state = SERVICE_STATE_REGISTERED;
  service.totalOlasRewardsClaimed = BigInt.zero();
  service.registeredTimestamp = event.block.timestamp;
  service.updatedTimestamp = event.block.timestamp;
  service.save();
  return service;
}

// Append agentId + operator into a Service's deduped lists.
export function appendServiceRegistration(
  service: Service,
  agentId: i32,
  operator: Bytes
): void {
  const agentIds = service.agentIds;
  let agentSeen = false;
  for (let i = 0; i < agentIds.length; i++) {
    if (agentIds[i] == agentId) {
      agentSeen = true;
      break;
    }
  }
  if (!agentSeen) {
    agentIds.push(agentId);
    service.agentIds = agentIds;
  }

  const operators = service.operators;
  let opSeen = false;
  for (let i = 0; i < operators.length; i++) {
    if (operators[i].equals(operator)) {
      opSeen = true;
      break;
    }
  }
  if (!opSeen) {
    operators.push(operator);
    service.operators = operators;
  }
}

// --- PendingRegistration (RegisterInstance-before-CreateMultisig drain)

export function bufferPendingRegistration(
  serviceId: BigInt,
  agentId: i32,
  operator: Bytes
): void {
  const id = pendingRegistrationId(serviceId);
  let pending = PendingRegistration.load(id);
  if (pending == null) {
    pending = new PendingRegistration(id);
    pending.agentIds = [];
    pending.operators = [];
  }

  const agentIds = pending.agentIds;
  let agentSeen = false;
  for (let i = 0; i < agentIds.length; i++) {
    if (agentIds[i] == agentId) {
      agentSeen = true;
      break;
    }
  }
  if (!agentSeen) {
    agentIds.push(agentId);
    pending.agentIds = agentIds;
  }

  const operators = pending.operators;
  let opSeen = false;
  for (let i = 0; i < operators.length; i++) {
    if (operators[i].equals(operator)) {
      opSeen = true;
      break;
    }
  }
  if (!opSeen) {
    operators.push(operator);
    pending.operators = operators;
  }

  pending.save();
}

// drainPendingRegistration — merge a Service's buffered agentIds and
// operators into the Service's own deduped lists. The two arrays are
// independent (an operator can register multiple agents; an agent ID
// can have multiple operators), so they're deduped separately.
export function drainPendingRegistration(
  service: Service,
  serviceId: BigInt
): void {
  const id = pendingRegistrationId(serviceId);
  const pending = PendingRegistration.load(id);
  if (pending == null) return;

  const mergedAgentIds = service.agentIds;
  const pendingAgentIds = pending.agentIds;
  for (let i = 0; i < pendingAgentIds.length; i++) {
    const aid = pendingAgentIds[i];
    let seen = false;
    for (let j = 0; j < mergedAgentIds.length; j++) {
      if (mergedAgentIds[j] == aid) {
        seen = true;
        break;
      }
    }
    if (!seen) mergedAgentIds.push(aid);
  }
  service.agentIds = mergedAgentIds;

  const mergedOps = service.operators;
  const pendingOps = pending.operators;
  for (let i = 0; i < pendingOps.length; i++) {
    const op = pendingOps[i];
    let seen = false;
    for (let j = 0; j < mergedOps.length; j++) {
      if (mergedOps[j].equals(op)) {
        seen = true;
        break;
      }
    }
    if (!seen) mergedOps.push(op);
  }
  service.operators = mergedOps;
}

// --- ServiceIndex ----------------------------------------------------

export function setServiceIndex(serviceId: BigInt, multisig: Bytes): void {
  const id = serviceIndexId(serviceId);
  let idx = ServiceIndex.load(id);
  if (idx == null) {
    idx = new ServiceIndex(id);
  }
  idx.multisig = multisig;
  idx.save();
}

// --- Bond attribution queue (per-tx) ---------------------------------
//
// On-chain the SRTU event (TokenDeposit / TokenRefund) always fires
// *before* its ServiceRegistryL2 counterpart (ServiceManager calls the
// *TokenDeposit / *TokenRefund function before the registry function in
// every path: activateRegistration, registerAgents, terminate, unbond).
// So the SRTU handler is the PRODUCER — it creates the FundsMovement row
// and enqueues its id — and the ServiceRegistryL2 handler is the
// CONSUMER, dequeuing the oldest pending row and backfilling serviceId +
// bondType.

function getOrCreatePendingBondCounter(txHash: Bytes): PendingBondCounter {
  let counter = PendingBondCounter.load(txHash);
  if (counter == null) {
    counter = new PendingBondCounter(txHash);
    counter.nextEnqueueSlot = 0;
    counter.nextDequeueSlot = 0;
    counter.save();
  }
  return counter;
}

// enqueuePendingBondRow — append a FundsMovement row id to the per-tx
// queue. Called by SRTU handlers (handleTokenDeposit / handleTokenRefund)
// right after they create the (as-yet unattributed) row.
export function enqueuePendingBondRow(
  txHash: Bytes,
  fundsMovementId: Bytes
): void {
  const counter = getOrCreatePendingBondCounter(txHash);
  const slot = counter.nextEnqueueSlot;

  const ptr = new PendingBondRow(pendingBondRowId(txHash, slot));
  ptr.fundsMovement = fundsMovementId;
  ptr.attributed = false;
  ptr.save();

  counter.nextEnqueueSlot = slot + 1;
  counter.save();
}

// dequeueAndAttribute — pop the oldest not-yet-attributed row from the
// per-tx queue and backfill its serviceId + bondType. No-op if the queue
// is empty (a ServiceRegistryL2 event fired without a matching prior
// TokenDeposit / TokenRefund — e.g. a native-secured service that never
// touches SRTU; the row simply doesn't exist, nothing to attribute).
export function dequeueAndAttribute(
  txHash: Bytes,
  serviceId: BigInt,
  bondType: string
): void {
  const counter = PendingBondCounter.load(txHash);
  if (counter == null) return;

  let slot = counter.nextDequeueSlot;
  while (slot < counter.nextEnqueueSlot) {
    const ptr = PendingBondRow.load(pendingBondRowId(txHash, slot));
    if (ptr != null && !ptr.attributed) {
      ptr.attributed = true;
      ptr.save();
      counter.nextDequeueSlot = slot + 1;
      counter.save();

      const movement = FundsMovement.load(ptr.fundsMovement);
      if (movement != null) {
        movement.service = serviceId.toString();
        movement.bondType = bondType;
        // Backfill the agent link so the wallet can render the agent
        // name on stake / unstake rows. The Service carries agentIds
        // (set at RegisterInstance) for the display name regardless; the
        // agentSafe multisig only exists post-CreateMultisigWithAgents,
        // so it resolves on refunds and any re-stake but is null on the
        // very first deposit (the name still resolves via service.agentIds).
        // masterSafe is normally stamped by the SRTU producer; fall back
        // to the Service link here for services discovered out of order.
        const service = Service.load(serviceId.toString());
        if (service != null) {
          if (movement.masterSafe === null && service.masterSafe !== null) {
            movement.masterSafe = service.masterSafe;
          }
          if (service.agentSafe !== null) {
            movement.agentSafe = service.agentSafe;
          }
        }
        movement.save();
      }
      return;
    }
    slot += 1;
  }
}

// attributeAgentBondOncePerService — same as dequeueAndAttribute but
// dedupes via AgentBondAttributionGuard so multiple RegisterInstance
// events (one per agent instance) only attribute the single AGENT_BOND
// row once per (txHash, serviceId). registerAgentsTokenDeposit emits one
// TokenDeposit for the combined agent bond, so only one row is enqueued.
export function attributeAgentBondOncePerService(
  txHash: Bytes,
  serviceId: BigInt,
  bondType: string
): void {
  const guardId = agentBondAttributionGuardId(txHash, serviceId);
  if (AgentBondAttributionGuard.load(guardId) != null) {
    return;
  }
  const guard = new AgentBondAttributionGuard(guardId);
  guard.save();
  dequeueAndAttribute(txHash, serviceId, bondType);
}

// --- DailyServiceFunds (Phase 1b) ------------------------------------

const ONE_DAY: i64 = 86400;

export function dayTimestamp(timestamp: BigInt): BigInt {
  const t = timestamp.toI64();
  const day = (t / ONE_DAY) * ONE_DAY;
  return BigInt.fromI64(day);
}

// addDailyOlasReward — bump both the daily-bucket counter and the
// per-service cumulative counter for an OLAS reward outflow
// (RewardClaimed or *Unstaked reward). Idempotent on entity-creation;
// just adds the amount.
export function addDailyOlasReward(
  service: Service,
  amount: BigInt,
  blockTimestamp: BigInt
): void {
  const day = dayTimestamp(blockTimestamp);
  const id = service.id + "-" + day.toString();
  let daily = DailyServiceFunds.load(id);
  if (daily == null) {
    daily = new DailyServiceFunds(id);
    daily.service = service.id;
    daily.dayTimestamp = day;
    daily.olasRewardsClaimed = BigInt.zero();
    daily.cumulativeOlasRewardsClaimed = service.totalOlasRewardsClaimed;
  }
  daily.olasRewardsClaimed = daily.olasRewardsClaimed.plus(amount);
  daily.cumulativeOlasRewardsClaimed = service.totalOlasRewardsClaimed.plus(
    amount
  );
  daily.save();

  service.totalOlasRewardsClaimed = service.totalOlasRewardsClaimed.plus(
    amount
  );
}

// --- StakingContract -------------------------------------------------

export function getOrCreateStakingContract(
  proxyAddress: Address,
  implementation: Bytes,
  minStakingDeposit: BigInt,
  numAgentInstances: BigInt,
  event: ethereum.Event
): StakingContract {
  let sc = StakingContract.load(proxyAddress);
  if (sc != null) return sc;
  sc = new StakingContract(proxyAddress);
  sc.implementation = implementation;
  sc.minStakingDeposit = minStakingDeposit;
  sc.numAgentInstances = numAgentInstances;
  sc.createdBlock = event.block.number;
  sc.createdTimestamp = event.block.timestamp;
  sc.save();
  return sc;
}

// --- Phase 2a — TrackedSafe / TrackedEOA / Token / TokenBalance ------

// upsertTrackedSafe — idempotent. Called when a Master Safe or Agent
// Safe is first created. `service` is null for Master Safes (one
// Master Safe owns many services).
export function upsertTrackedSafe(
  address: Address,
  role: string,
  masterSafeId: Bytes,
  serviceId: string | null
): void {
  let tracked = TrackedSafe.load(address);
  if (tracked != null) return;
  tracked = new TrackedSafe(address);
  tracked.role = role;
  tracked.masterSafe = masterSafeId;
  if (serviceId !== null) tracked.service = serviceId;
  tracked.save();
}

// upsertTrackedEOA — idempotent. Called for Master EOAs (via
// getOrCreateMasterSafe) and agent EOAs (via RegisterInstance /
// agent-safe creation).
export function upsertTrackedEOA(
  address: Address,
  role: string,
  masterSafeId: Bytes | null,
  serviceId: string | null,
  blockNumber: BigInt
): void {
  let tracked = TrackedEOA.load(address);
  if (tracked != null) return;
  tracked = new TrackedEOA(address);
  tracked.role = role;
  if (masterSafeId !== null) tracked.masterSafe = masterSafeId;
  if (serviceId !== null) tracked.service = serviceId;
  tracked.firstTrackedBlock = blockNumber;
  tracked.save();
}

// getOrCreateToken — resolves token metadata for the indexed token set.
// Metadata is hardcoded (not queried) because the ERC20Detailed ABI in
// this repo doesn't include symbol()/decimals() and Pearl's token set is
// small + known:
//   - OLAS — 18 decimals (per-chain address via getOlasAddress).
//   - wrapped native — 18 decimals (symbol per getWrappedNativeSymbol).
//   - stablecoins — USDC / USDC.e / pUSD, all 6 decimals, resolved per
//     chain via getStablecoinSymbol (the set varies per chain — see
//     networks.json `erc20Tokens`).
// First write wins (early return on an existing Token), so a wrong
// decimals value would persist forever — hence the log.critical guard.
export function getOrCreateToken(tokenAddress: Address): Token {
  let token = Token.load(tokenAddress);
  if (token != null) return token;
  token = new Token(tokenAddress);
  const network = currentNetwork();
  if (tokenAddress.equals(getOlasAddress(network))) {
    token.symbol = "OLAS";
    token.decimals = 18;
  } else if (tokenAddress.equals(getWrappedNativeAddress(network))) {
    token.symbol = getWrappedNativeSymbol(network);
    token.decimals = 18;
  } else {
    const stablecoin = getStablecoinSymbol(network, tokenAddress);
    if (stablecoin !== null) {
      // Per-chain stablecoin (USDC / USDC.e / pUSD) — all 6 decimals.
      token.symbol = stablecoin;
      token.decimals = 6;
    } else {
      // Reached here only via a tracked Transfer, so this is an indexed
      // token with no metadata resolver — almost certainly an
      // `erc20Tokens` entry in networks.json without a matching
      // getStablecoinSymbol branch. Every such indexed token (OLAS and
      // wrapped-native are handled above) is a stablecoin, so default to
      // 6 decimals — NOT 18: an 18-decimal fallback would silently
      // misformat the amount by 10^12 in every consumer, and first-write-
      // wins makes it permanent. log.critical is loud on purpose (drift
      // canary), but we must not rely on it aborting — graph-node may
      // continue — so the persisted value has to be safe by itself.
      log.critical(
        "getOrCreateToken: no symbol/decimals resolver for indexed token {} on {} — add a getStablecoinSymbol branch (networks.json `erc20Tokens` and the resolver are out of sync). Defaulting to UNKNOWN/6.",
        [tokenAddress.toHexString(), network]
      );
      token.symbol = "UNKNOWN";
      token.decimals = 6;
    }
  }
  token.save();
  return token;
}

// upsertTokenBalance — maintain per-(safe, token) running balance.
// isDelta = true → balance += amount (signed); false → balance = amount
// (absolute, e.g. baseline initialization).
export function upsertTokenBalance(
  safe: Address,
  tokenAddress: Address,
  amount: BigInt,
  event: ethereum.Event,
  isDelta: boolean
): void {
  const id = safe.concat(tokenAddress);
  let bal = TokenBalance.load(id);
  if (bal == null) {
    bal = new TokenBalance(id);
    bal.safe = safe;
    bal.token = getOrCreateToken(tokenAddress).id;
    // First sighting: the initial balance is `amount` whether it's the
    // first signed delta or an absolute baseline write.
    bal.balance = amount;
  } else {
    bal.balance = isDelta ? bal.balance.plus(amount) : amount;
  }
  bal.lastUpdatedTimestamp = event.block.timestamp;
  bal.lastUpdatedBlock = event.block.number;
  bal.save();
}

// --- Phase 2a — classifyTransfer + AgentFundingEvent -----------------

// ClassifyResult — output of classifyTransfer. Carries category +
// resolved service/masterSafe/agentSafe IDs so the OLAS handler
// doesn't repeat the lookup.
export class ClassifyResult {
  category: string;
  service: string | null;
  masterSafeId: Bytes | null;
  agentSafeId: Bytes | null;
  constructor(
    category: string,
    service: string | null,
    masterSafeId: Bytes | null,
    agentSafeId: Bytes | null
  ) {
    this.category = category;
    this.service = service;
    this.masterSafeId = masterSafeId;
    this.agentSafeId = agentSafeId;
  }
}

// classifyTransfer — route an ERC-20 / native Transfer's (from, to) to
// a FundsCategory. Returns null only if NEITHER side is a tracked
// address (TrackedSafe / TrackedEOA / StakingContract / SRTU). If one
// side is tracked but no specific pattern matches, returns OTHER so
// the row is recorded for forensic view (plan §10 explicit
// requirement: "Master EOA → unrelated EOA classified OTHER, not
// silently dropped").
export function classifyTransfer(
  from: Address,
  to: Address
): ClassifyResult | null {
  const fromMaster = TrackedSafe.load(from);
  const toMaster = TrackedSafe.load(to);
  const fromEOA = TrackedEOA.load(from);
  const toEOA = TrackedEOA.load(to);
  const fromIsStaking = StakingContract.load(from) != null;
  const toIsStaking = StakingContract.load(to) != null;
  const srtuAddr = getSrtuAddress(currentNetwork());
  const fromIsSrtu = from.equals(srtuAddr);
  const toIsSrtu = to.equals(srtuAddr);
  const registryAddr = getServiceRegistryAddress(currentNetwork());

  // Most-specific patterns first.

  // Master Safe ↔ SRTU OLAS transfers are the on-chain bond movement.
  // The SRTU handler (handleTokenDeposit / handleTokenRefund) already
  // books the canonical SEMANTIC bond row and the consumer backfills
  // serviceId + bondType + masterSafe + agentSafe onto it, so that one
  // row is the complete record. Emitting a second RAW_TRANSFER row here
  // would double-count the bond in any masterSafe-filtered wallet query,
  // so we drop it (return null). The OLAS TokenBalance delta is updated
  // separately in handleErc20Transfer and is unaffected.
  if (
    fromMaster != null &&
    fromMaster.role == "MASTER" &&
    toIsSrtu
  ) {
    return null;
  }
  if (
    fromIsSrtu &&
    toMaster != null &&
    toMaster.role == "MASTER"
  ) {
    return null;
  }

  // Master Safe → Agent Safe / Agent EOA → MASTER_TO_AGENT (grouped).
  if (
    fromMaster != null &&
    fromMaster.role == "MASTER" &&
    ((toMaster != null && toMaster.role == "AGENT") ||
      (toEOA != null && toEOA.role == "AGENT_EOA"))
  ) {
    let serviceId: string | null = null;
    if (toMaster != null) serviceId = toMaster.service;
    else if (toEOA != null) serviceId = toEOA.service;
    return new ClassifyResult(
      "MASTER_TO_AGENT",
      serviceId,
      fromMaster.masterSafe,
      toMaster != null ? toMaster.id : null
    );
  }

  // Agent Safe → Master Safe → AGENT_TO_MASTER. The OLAS leg (reward sweeps +
  // manual OLAS returns) is re-tagged AGENT_OLAS_TO_MASTER in
  // handleErc20Transfer after classification (the token isn't visible here);
  // native / non-OLAS stays AGENT_TO_MASTER.
  if (
    fromMaster != null &&
    fromMaster.role == "AGENT" &&
    toMaster != null &&
    toMaster.role == "MASTER"
  ) {
    return new ClassifyResult(
      "AGENT_TO_MASTER",
      fromMaster.service,
      toMaster.id,
      fromMaster.id
    );
  }

  // Staking proxy → Agent Safe — already booked semantically in
  // Phase 1b (STAKING_REWARD_CLAIM). The raw OLAS Transfer is
  // reconciled with source=RAW_TRANSFER.
  if (
    fromIsStaking &&
    toMaster != null &&
    toMaster.role == "AGENT"
  ) {
    return new ClassifyResult(
      "STAKING_REWARD_CLAIM",
      toMaster.service,
      toMaster.masterSafe,
      toMaster.id
    );
  }

  // EOA (Master EOA / other) → Master Safe.
  if (toMaster != null && toMaster.role == "MASTER") {
    // The ServiceRegistryL2 contract itself sends tiny native dust to the
    // Master Safe during terminate / unbond (observed: 1-wei xDAI refunds
    // sharing a tx with SERVICE_BOND_REFUND). That is protocol
    // bookkeeping, not a user deposit, so classify it OTHER (kept for the
    // forensic view, hidden from the wallet) rather than MASTER_FUNDING_IN.
    if (from.equals(registryAddr)) {
      return new ClassifyResult(CATEGORY_OTHER, null, toMaster.masterSafe, null);
    }
    const ms = MasterSafe.load(toMaster.masterSafe);
    if (ms != null && !ms.setupTransferSeen && fromEOA != null && fromEOA.role == "MASTER_EOA") {
      // First Master EOA → Master Safe hop after creation.
      return new ClassifyResult(
        "SAFE_SETUP_TRANSFER",
        null,
        toMaster.masterSafe,
        null
      );
    }
    return new ClassifyResult(
      "MASTER_FUNDING_IN",
      null,
      toMaster.masterSafe,
      null
    );
  }

  // Master Safe → EOA.
  if (fromMaster != null && fromMaster.role == "MASTER") {
    return new ClassifyResult(
      "MASTER_WITHDRAWAL",
      null,
      fromMaster.masterSafe,
      null
    );
  }

  // Agent Safe ↔ unknown (treated as app-contract interactions).
  if (fromMaster != null && fromMaster.role == "AGENT") {
    return new ClassifyResult(
      "AGENT_TO_APP",
      fromMaster.service,
      fromMaster.masterSafe,
      fromMaster.id
    );
  }
  if (toMaster != null && toMaster.role == "AGENT") {
    return new ClassifyResult(
      "APP_TO_AGENT",
      toMaster.service,
      toMaster.masterSafe,
      toMaster.id
    );
  }

  // Fallback: if ANY side is a tracked address (EOA or staking
  // proxy that didn't match a more-specific pattern), tag as OTHER.
  // The classifier returns null only when neither side is tracked
  // at all (chain-wide OLAS noise).
  const fromIsTracked =
    fromMaster != null || fromEOA != null || fromIsStaking || fromIsSrtu;
  const toIsTracked =
    toMaster != null || toEOA != null || toIsStaking || toIsSrtu;
  if (fromIsTracked || toIsTracked) {
    // Pick whichever tracked-side EOA can carry the masterSafe ref.
    let masterRef: Bytes | null = null;
    if (fromEOA != null && fromEOA.masterSafe !== null) {
      masterRef = fromEOA.masterSafe;
    } else if (toEOA != null && toEOA.masterSafe !== null) {
      masterRef = toEOA.masterSafe;
    }
    return new ClassifyResult(CATEGORY_OTHER, null, masterRef, null);
  }

  return null;
}

// markSetupTransferSeen — flip the MasterSafe flag after the first
// live Master EOA → Master Safe inbound hop is tagged
// SAFE_SETUP_TRANSFER, so subsequent inbound hops are MASTER_FUNDING_IN.
export function markSetupTransferSeen(masterSafeId: Bytes): void {
  const ms = MasterSafe.load(masterSafeId);
  if (ms == null || ms.setupTransferSeen) return;
  ms.setupTransferSeen = true;
  ms.save();
}

// --- AgentFundingEvent aggregation -----------------------------------

export function agentFundingEventId(
  txHash: Bytes,
  masterSafeId: Bytes,
  serviceId: string
): Bytes {
  return txHash
    .concat(masterSafeId)
    .concat(Bytes.fromUTF8(serviceId));
}

// getOrCreateAgentFundingEvent — one per (txHash, masterSafe,
// service). Initial totals are zero; `addToAgentFundingEvent` bumps.
export function getOrCreateAgentFundingEvent(
  txHash: Bytes,
  masterSafeId: Bytes,
  serviceId: string,
  event: ethereum.Event
): AgentFundingEvent {
  const id = agentFundingEventId(txHash, masterSafeId, serviceId);
  let afe = AgentFundingEvent.load(id);
  if (afe != null) return afe;
  afe = new AgentFundingEvent(id);
  afe.service = serviceId;
  afe.masterSafe = masterSafeId;
  afe.txHash = txHash;
  afe.blockTimestamp = event.block.timestamp;
  afe.totalNativeAmount = BigInt.zero();
  afe.totalOlasAmount = BigInt.zero();
  afe.save();
  return afe;
}

// addToAgentFundingEvent — bump the OLAS or native total. The OLAS
// handler passes isNative=false; the Safe-template native handler
// passes isNative=true.
export function addToAgentFundingEvent(
  afe: AgentFundingEvent,
  amount: BigInt,
  isNative: boolean
): void {
  if (isNative) {
    afe.totalNativeAmount = afe.totalNativeAmount.plus(amount);
  } else {
    afe.totalOlasAmount = afe.totalOlasAmount.plus(amount);
  }
  afe.save();
}
