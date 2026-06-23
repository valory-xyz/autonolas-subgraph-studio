import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { DailyActivityMetric, DailyAgentActivity } from "../generated/schema"

const ONE_DAY = BigInt.fromI32(86400)

// Phase 2 stub. Records one swap-based "transaction" for a Basius service on the
// swap's UTC day, and counts the service toward DAA (once per day).
//
// PROVISIONAL: transactionCount counts LiFi swaps. The final definition of
// "transactions per day" (swaps vs Safe executions vs mech requests) is pending a
// product decision (Tatiana). Mech requests would require a NEW data source.
export function recordSwapActivity(serviceSafe: Bytes, timestamp: BigInt): void {
  let day = timestamp.div(ONE_DAY).times(ONE_DAY)
  let dayId = day.toString()

  let metric = DailyActivityMetric.load(dayId)
  if (metric == null) {
    metric = new DailyActivityMetric(dayId)
    metric.dayTimestamp = day
    metric.activeAgents = 0
    metric.transactionCount = 0
  }
  metric.transactionCount = metric.transactionCount + 1

  let activityId = dayId + "-" + serviceSafe.toHexString()
  if (DailyAgentActivity.load(activityId) == null) {
    let a = new DailyAgentActivity(activityId)
    a.save()
    metric.activeAgents = metric.activeAgents + 1
  }
  metric.save()
}
