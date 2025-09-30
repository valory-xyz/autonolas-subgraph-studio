import { Transfer } from "../../../../generated/USDC_Native/ERC20"
import { log } from "@graphprotocol/graph-ts"
import { handleERC20Transfer } from "./tokenBalances"

// NOTE: This subgraph is configured to track USDC Native and ETH transfers for funding balance calculations.
// Other ERC20 token outflows are tracked for token balance purposes but do not affect funding metrics.
// All token handling is now centralized in handleERC20Transfer in tokenBalances.ts

// Re-export handleERC20Transfer from tokenBalances
export { handleERC20Transfer } from "./tokenBalances"

// USDC Transfer handler - redirects to handleERC20Transfer to centralize processing
export function handleUSDC(ev: Transfer): void {
  // Log that we're processing via the centralized handler
  log.debug("FUNDING: Handling USDC transfer via handleERC20Transfer - from: {}, to: {}, value: {}", [
    ev.params.from.toHexString(),
    ev.params.to.toHexString(),
    ev.params.value.toString()
  ])
  
  // Call the main handler to ensure consistent processing
  handleERC20Transfer(ev)
}
