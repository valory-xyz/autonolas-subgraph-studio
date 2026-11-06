import { GaugeCreated } from "../generated/AeroGaugeManager/AeroGaugeManager"
import { AeroGauge } from "../generated/schema"

export function handleAeroGaugeCreated(event: GaugeCreated): void {
  let entry = AeroGauge.load(event.params._target)
  if (entry == null) {
    entry = new AeroGauge(event.params._target)
  }
  entry.gauge = event.params._gauge
  entry.createdAtBlock = event.block.number
  entry.save()
}
