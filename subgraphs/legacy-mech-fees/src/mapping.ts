import { BigInt, Address } from '@graphprotocol/graph-ts';
import {
  ExecCall as ExecCallLM,
  AgentMechLM as AgentMechLMContract,
} from '../generated/templates/LegacyMech/AgentMechLM';
import {
  ExecCall as ExecCallLMM,
  AgentMechLMM as AgentMechLMMContract,
} from '../generated/templates/LegacyMechMarketPlace/AgentMechLMM';
import { Request as RequestEvent } from '../generated/templates/LegacyMech/AgentMechLM';
import { PriceUpdated as PriceUpdatedLMEvent } from '../generated/templates/LegacyMech/AgentMechLM';
import { PriceUpdated as PriceUpdatedLMMEvent } from '../generated/templates/LegacyMechMarketPlace/AgentMechLMM';
import { CreateMech } from '../generated/LMFactory/Factory';
import { LegacyMech, LegacyMechMarketPlace } from '../generated/schema';
import {
  LegacyMech as LegacyMechTemplate,
  LegacyMechMarketPlace as LegacyMechMarketPlaceTemplate,
} from '../generated/templates';
import { MarketplaceRequest as MarketplaceRequestEvent } from '../generated/LegacyMarketPlace/LegacyMarketPlace';
import {
  updateGlobalFeesInLegacyMech,
  updateGlobalFeesInLegacyMechMarketPlace,
  updateGlobalFeesOutLegacyMech,
  updateGlobalFeesOutLegacyMechMarketPlace,
  getOrCreateDailyFees,
  updateMechDailyFeesInLegacyMech,
  updateMechDailyFeesOutLegacyMech,
  updateMechDailyFeesInLegacyMechMarketPlace,
  updateMechDailyFeesOutLegacyMechMarketPlace,
} from './utils';
import { BURN_ADDRESS_MECH_FEES_GNOSIS } from './constants';

const BURNER_ADDRESS = Address.fromString(BURN_ADDRESS_MECH_FEES_GNOSIS);

function getMechPrice(mechAddress: Address): BigInt {
  const lmmPrice = AgentMechLMMContract.bind(mechAddress).try_price();
  if (!lmmPrice.reverted) {
    return lmmPrice.value;
  }

  const lmPrice = AgentMechLMContract.bind(mechAddress).try_price();
  if (!lmPrice.reverted) {
    return lmPrice.value;
  }

  return BigInt.fromI32(0);
}

// Handler for standard Legacy Mechs
export function handleCreateMechLM(event: CreateMech): void {
  const mechAddress = event.params.mech;
  const agentId = event.params.agentId;
  const price = event.params.price;

  if (LegacyMech.load(mechAddress) != null) {
    return;
  }

  const mech = new LegacyMech(mechAddress);
  mech.totalFeesIn = BigInt.fromI32(0);
  mech.totalFeesOut = BigInt.fromI32(0);
  mech.agentId = agentId.toI32();
  mech.price = price;
  mech.save();

  LegacyMechTemplate.create(mechAddress);
}

// Handler for Legacy Market-Maker Mechs
export function handleCreateMechLMM(event: CreateMech): void {
  const mechAddress = event.params.mech;
  const agentId = event.params.agentId;
  const price = event.params.price;

  if (LegacyMechMarketPlace.load(mechAddress) != null) {
    return;
  }

  const mech = new LegacyMechMarketPlace(mechAddress);
  mech.totalFeesIn = BigInt.fromI32(0);
  mech.totalFeesOut = BigInt.fromI32(0);
  mech.agentId = agentId.toI32();
  mech.price = price;
  mech.save();

  LegacyMechMarketPlaceTemplate.create(mechAddress);
}

// Handler for outgoing transfers for LMs
export function handleExecLM(call: ExecCallLM): void {
  const destination = call.inputs.to;
  const amount = call.inputs.value;

  if (destination.equals(BURNER_ADDRESS) || amount.equals(BigInt.fromI32(0))) {
    return;
  }

  const mechAddress = call.to;

  const lm = LegacyMech.load(mechAddress);
  if (lm == null) {
    return;
  }

  lm.totalFeesOut = lm.totalFeesOut.plus(amount);
  lm.save();
  updateGlobalFeesOutLegacyMech(amount);

  // Update daily fees
  const dailyFees = getOrCreateDailyFees(call.block.timestamp);
  dailyFees.totalFeesOutLegacyMech =
    dailyFees.totalFeesOutLegacyMech.plus(amount);
  dailyFees.save();

  // Update mech daily fees
  updateMechDailyFeesOutLegacyMech(
    mechAddress,
    lm.agentId,
    amount,
    call.block.timestamp
  );
}

// Handler for price updates for LMs
export function handlePriceUpdateLM(event: PriceUpdatedLMEvent): void {
  const mechAddress = event.address;
  const mech = LegacyMech.load(mechAddress);
  if (mech == null) {
    return;
  }

  mech.price = event.params.price;
  mech.save();
}

// Handler for outgoing transfers for LMMs
export function handleExecLMM(call: ExecCallLMM): void {
  const destination = call.inputs.to;
  const amount = call.inputs.value;

  if (destination.equals(BURNER_ADDRESS) || amount.equals(BigInt.fromI32(0))) {
    return;
  }

  const mechAddress = call.to;
  const lmm = LegacyMechMarketPlace.load(mechAddress);
  if (lmm == null) {
    return;
  }

  lmm.totalFeesOut = lmm.totalFeesOut.plus(amount);
  lmm.save();
  updateGlobalFeesOutLegacyMechMarketPlace(amount);

  // Update daily fees
  const dailyFees = getOrCreateDailyFees(call.block.timestamp);
  dailyFees.totalFeesOutLegacyMechMarketPlace =
    dailyFees.totalFeesOutLegacyMechMarketPlace.plus(amount);
  dailyFees.save();

  // Update mech daily fees
  updateMechDailyFeesOutLegacyMechMarketPlace(
    mechAddress,
    lmm.agentId,
    amount,
    call.block.timestamp
  );
}

// Handler for price updates for LMMs
export function handlePriceUpdateLMM(event: PriceUpdatedLMMEvent): void {
  const mechAddress = event.address;
  const mech = LegacyMechMarketPlace.load(mechAddress);
  if (mech == null) {
    return;
  }

  mech.price = event.params.price;
  mech.save();
}

// Event handler for direct requests to standard LMs
export function handleRequest(event: RequestEvent): void {
  const mechAddress = event.address;
  const mech = LegacyMech.load(mechAddress);
  if (mech == null) {
    return;
  }

  const fee = mech.price;
  mech.totalFeesIn = mech.totalFeesIn.plus(fee);
  mech.save();

  updateGlobalFeesInLegacyMech(fee);

  // Update daily fees
  const dailyFees = getOrCreateDailyFees(event.block.timestamp);
  dailyFees.totalFeesInLegacyMech = dailyFees.totalFeesInLegacyMech.plus(fee);
  dailyFees.save();

  // Update mech daily fees
  updateMechDailyFeesInLegacyMech(
    mechAddress,
    mech.agentId,
    fee,
    event.block.timestamp
  );
}

// Event handler for requests routed through the marketplace to LMMs
export function handleMarketplaceRequest(
  event: MarketplaceRequestEvent
): void {
  const mechAddress = event.params.requestedMech;
  const fee = getMechPrice(mechAddress);

  if (fee.le(BigInt.fromI32(0))) {
    return;
  }

  const mech = LegacyMechMarketPlace.load(mechAddress);
  if (mech != null) {
    mech.totalFeesIn = mech.totalFeesIn.plus(fee);
    mech.save();

    updateMechDailyFeesInLegacyMechMarketPlace(
      mechAddress,
      mech.agentId,
      fee,
      event.block.timestamp
    );
  }

  updateGlobalFeesInLegacyMechMarketPlace(fee);

  const dailyFees = getOrCreateDailyFees(event.block.timestamp);
  dailyFees.totalFeesInLegacyMechMarketPlace =
    dailyFees.totalFeesInLegacyMechMarketPlace.plus(fee);
  dailyFees.save();
}
