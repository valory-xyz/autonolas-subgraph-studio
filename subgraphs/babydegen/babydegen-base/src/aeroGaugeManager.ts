import { GaugeCreated } from "../generated/AeroGaugeManager/AeroGaugeManager"
import { AeroGauge } from "../generated/schema"

// Builds the AeroGauge pool -> gauge map read by resolveV2Gauge (veloV2Shared.ts).
export function handleAeroGaugeCreated(event: GaugeCreated): void {
  let entry = AeroGauge.load(event.params._target)
  if (entry == null) {
    entry = new AeroGauge(event.params._target)
  }
  entry.gauge = event.params._gauge
  entry.createdAtBlock = event.block.number
  entry.save()
}
