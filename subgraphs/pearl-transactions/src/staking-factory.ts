import { log } from "@graphprotocol/graph-ts";
import { InstanceCreated as InstanceCreatedEvent } from "../generated/StakingFactory/StakingFactory";
import { StakingProxy as StakingProxyTemplate } from "../generated/templates";
import { StakingProxy as StakingProxyContract } from "../generated/templates/StakingProxy/StakingProxy";
import { isAllowedImplementation } from "./constants";
import { getOrCreateStakingContract, upsertTrackedAddress } from "./utils";

// handleInstanceCreated — fires on every StakingFactory.InstanceCreated.
//
// We only spawn the StakingProxy template (and create a StakingContract
// entity) for proxies whose implementation appears on the per-network
// allow-list (see constants.ts isAllowedImplementation). Unknown
// implementations are skipped silently — they may have incompatible
// event ABIs that would crash the indexer.
//
// Config snapshot (minStakingDeposit, numAgentInstances) is captured
// via eth_call at creation time. The values are immutable post-deploy
// per the Olas staking-contract pattern, so we don't need to track
// updates.
export function handleInstanceCreated(event: InstanceCreatedEvent): void {
  const implementation = event.params.implementation;
  if (!isAllowedImplementation(implementation)) {
    return;
  }

  const proxyAddress = event.params.instance;

  // Bind to the proxy and read the snapshot config. The fields are
  // delegated to the implementation, so we call on the proxy address.
  const proxy = StakingProxyContract.bind(proxyAddress);
  const minStakingDepositResult = proxy.try_minStakingDeposit();
  const numAgentInstancesResult = proxy.try_numAgentInstances();

  if (minStakingDepositResult.reverted || numAgentInstancesResult.reverted) {
    log.warning(
      "StakingProxy {} config call reverted (impl={}, tx={}); skipping",
      [
        proxyAddress.toHexString(),
        implementation.toHexString(),
        event.transaction.hash.toHexString(),
      ]
    );
    return;
  }

  getOrCreateStakingContract(
    proxyAddress,
    implementation,
    minStakingDepositResult.value,
    numAgentInstancesResult.value,
    event
  );

  // Register the proxy as a TrackedAddress(STAKING) so classifyTransfer's hot
  // path recognises staking-reward sends via the single tracked-address load
  // (StakingContract stays as the config entity / NFT-guard lookup).
  upsertTrackedAddress(
    proxyAddress,
    "STAKING",
    null,
    null,
    event.block.number
  );

  StakingProxyTemplate.create(proxyAddress);
}
