import { GaugeCreated } from "../generated/AeroGaugeManager/AeroGaugeManager"
import { AeroGauge } from "../generated/schema"

// Aero v2 pools expose no gauge() and the Aero Voter has no gauges(pool), so the
// pool -> gauge map is built from the GaugeManager's GaugeCreated events and read by
// the aero-v2 branch of resolveV2Gauge (veloV2Shared.ts). CL pools get a row too,
// unused: the CL path keeps reading pool.gauge().
export function handleAeroGaugeCreated(event: GaugeCreated): void {
  let entry = AeroGauge.load(event.params._target)
  if (entry == null) {
    entry = new AeroGauge(event.params._target)
  }
  entry.gauge = event.params._gauge
  entry.createdAtBlock = event.block.number
  entry.save()
}
