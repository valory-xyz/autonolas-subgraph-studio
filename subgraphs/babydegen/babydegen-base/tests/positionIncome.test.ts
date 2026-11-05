import { assert, describe, test, clearStore, afterEach, beforeEach, createMockedFunction } from "matchstick-as/assembly/index"
import { Address, BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { newMockEvent } from "matchstick-as/assembly/index"
import { ClaimableRewardBeforeBlock, ProtocolPosition } from "../generated/schema"
import { Collect, DecreaseLiquidity } from "../generated/VeloNFTManager/VelodromePositionNFTManager"
import { handleCollect, handleDecreaseLiquidity } from "../src/veloNFTManager"
import { processERC20Transfer } from "../src/tokenBalances"
import { attributeRewardTransfer, recordClaimableRewardBeforeBlock } from "../src/positionIncome"
import { calculateActualROI } from "../src/roiCalculation"
import { calculatePortfolioMetrics } from "../src/helpers"
import { USDC_NATIVE, BOLD, AERO, AERO_PROTOCOL_AERO, VELO_MANAGER, PROTOCOL_VELODROME_V3, PROTOCOL_VELODROME_V2, PROTOCOL_AERO_CL, AERO_NFT_MANAGER } from "../src/constants"
import { newLog, newReceipt, newTransfer, mockEthUsd, seedService, seedAddressType, seedTokenPrice, seedPosition, seededAddressType } from "./fixtures"
import { OPERATOR_SAFE, AGENT_INSTANCE, SERVICE_SAFE, BLOCK_NUMBER, BLOCK_TIMESTAMP } from "./test-helpers"

const OTHER = Address.fromString("0x00000000000000000000000000000000000000e3")

function positionField(p: ProtocolPosition, field: string, value: string): void {
  assert.fieldEquals("ProtocolPosition", p.id.toHexString(), field, value)
}

function closeAt(p: ProtocolPosition, exitUSD: string): void {
  p.isActive = false
  p.exitAmountUSD = BigDecimal.fromString(exitUSD)
  p.save()
}

function newCollect(tokenId: BigInt, recipient: Address, amount0: BigInt, amount1: BigInt, manager: Address = VELO_MANAGER): Collect {
  let event = changetype<Collect>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam("tokenId", ethereum.Value.fromUnsignedBigInt(tokenId)))
  event.parameters.push(new ethereum.EventParam("recipient", ethereum.Value.fromAddress(recipient)))
  event.parameters.push(new ethereum.EventParam("amount0", ethereum.Value.fromUnsignedBigInt(amount0)))
  event.parameters.push(new ethereum.EventParam("amount1", ethereum.Value.fromUnsignedBigInt(amount1)))
  event.address = manager
  event.block.number = BLOCK_NUMBER
  event.block.timestamp = BLOCK_TIMESTAMP
  return event
}

const USDC_50 = BigInt.fromI64(50000000)
const BOLD_50 = BigInt.fromString("50000000000000000000")

function newDecrease(tokenId: BigInt, amount0: BigInt, amount1: BigInt, manager: Address = VELO_MANAGER): DecreaseLiquidity {
  let event = changetype<DecreaseLiquidity>(newMockEvent())
  event.address = manager
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam("tokenId", ethereum.Value.fromUnsignedBigInt(tokenId)))
  event.parameters.push(new ethereum.EventParam("liquidity", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))))
  event.parameters.push(new ethereum.EventParam("amount0", ethereum.Value.fromUnsignedBigInt(amount0)))
  event.parameters.push(new ethereum.EventParam("amount1", ethereum.Value.fromUnsignedBigInt(amount1)))
  return event
}

describe("collected fees", () => {
  beforeEach(() => {
    mockEthUsd()
    seedTokenPrice(USDC_NATIVE, "USDC", 6, "1")
    seedTokenPrice(BOLD, "BOLD", 18, "1")
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
  })
  afterEach(() => {
    clearStore()
  })

  test("Collect finds the legacy Slipstream (aerodrome-cl) position and records only the fee part", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, BOLD, null, BigInt.zero(), "0")
    closeAt(p, "100")
    // positions() reverting stops the refresh after the principal is recorded
    createMockedFunction(VELO_MANAGER, "positions", "positions(uint256):(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))])
      .reverts()
    handleDecreaseLiquidity(newDecrease(BigInt.fromI32(7), USDC_50, BOLD_50))

    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(51000000), BigInt.fromString("50500000000000000000")))

    positionField(p, "collectedFees0", "1")
    positionField(p, "collectedFees1", "0.5")
    positionField(p, "collectedFeesUSD", "1.5")
    positionField(p, "exitAmountUSD", "100")
    positionField(p, "netGainUSD", "1.5")
    positionField(p, "positionROI", "1.5")
  })

  test("a fee on a closed position with no recorded investment is still saved", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(8), USDC_NATIVE, BOLD, null, BigInt.zero(), "0")
    p.entryAmountUSD = BigDecimal.zero()
    p.investmentUSD = BigDecimal.zero()
    p.save()
    closeAt(p, "0")

    handleCollect(newCollect(BigInt.fromI32(8), SERVICE_SAFE, BigInt.fromI64(2000000), BigInt.zero()))

    positionField(p, "collectedFeesUSD", "2")
  })

  test("a Collect smaller than the owed principal books no fee and leaves the rest owed", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, BOLD, null, BigInt.zero(), "0")
    closeAt(p, "100")
    createMockedFunction(VELO_MANAGER, "positions", "positions(uint256):(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))])
      .reverts()
    handleDecreaseLiquidity(newDecrease(BigInt.fromI32(7), USDC_50, BigInt.zero()))

    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(20000000), BigInt.zero()))
    positionField(p, "collectedFees0", "0")

    // 30 of principal is still owed, so 31 is 1 of fee
    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(31000000), BigInt.zero()))
    positionField(p, "collectedFees0", "1")
    positionField(p, "collectedFeesUSD", "1")
  })

  test("the portfolio's gross gain adds closed positions' fees and rewards to their exit", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, BOLD, null, BigInt.zero(), "0")
    closeAt(p, "100")
    p.collectedFeesUSD = BigDecimal.fromString("2")
    p.claimedRewardsUSD = BigDecimal.fromString("3")
    p.save()

    calculatePortfolioMetrics(SERVICE_SAFE, newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.zero(), BigInt.zero()).block)

    assert.fieldEquals("AgentPortfolio", SERVICE_SAFE.toHexString(), "totalGrossGains", "105")
  })

  test("a Collect paid to another address is not the Safe's fee", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, BOLD, null, BigInt.zero(), "0")
    closeAt(p, "100")
    handleCollect(newCollect(BigInt.fromI32(7), OTHER, BigInt.fromI64(1000000), BigInt.zero()))
    positionField(p, "collectedFeesUSD", "0")
  })

  test("principal collected to another address is not taken from a later fee Collect to the Safe", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, BOLD, null, BigInt.zero(), "0")
    closeAt(p, "100")
    createMockedFunction(VELO_MANAGER, "positions", "positions(uint256):(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))])
      .reverts()
    handleDecreaseLiquidity(newDecrease(BigInt.fromI32(7), USDC_50, BOLD_50))

    handleCollect(newCollect(BigInt.fromI32(7), OTHER, USDC_50, BOLD_50))
    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(5000000), BigInt.zero()))

    positionField(p, "collectedFees0", "5")
    positionField(p, "collectedFeesUSD", "5")
  })

  test("an Aero NFPM Collect books its fee on the aero-cl position, not a Velodrome one with the same tokenId", () => {
    let velo = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, BOLD, null, BigInt.zero(), "0")
    closeAt(velo, "100")
    let aero = seedPosition(SERVICE_SAFE, PROTOCOL_AERO_CL, BigInt.fromI32(7), USDC_NATIVE, BOLD, null, BigInt.zero(), "0")
    closeAt(aero, "100")
    createMockedFunction(AERO_NFT_MANAGER, "positions", "positions(uint256):(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))])
      .reverts()
    handleDecreaseLiquidity(newDecrease(BigInt.fromI32(7), USDC_50, BOLD_50, AERO_NFT_MANAGER))

    // The principal is owed under aero-cl, so a Velodrome Collect of the same tokenId is all fee
    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(2000000), BigInt.zero()))
    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(51000000), BigInt.fromString("50500000000000000000"), AERO_NFT_MANAGER))

    positionField(aero, "collectedFeesUSD", "1.5")
    positionField(velo, "collectedFeesUSD", "2")
  })

})

// Optimism tx 0x567935ab…: Safe 0xd32613 unstakes tokenId 53083183 from a Slipstream CL gauge 0x0f52…;
// the gauge pays 1.814069823640933344 of its reward token, then emits Withdraw(Safe, 53083183, …).
// Aerodrome's Slipstream gauge on Base emits the same events.
const SAFE_D12 = Address.fromString("0xd32613ed605be41d9c7fbc85f2ccb4fba59778ac")
const GAUGE_D12 = Address.fromString("0x0f5212f63ba8eab0fabd94fc2071d461d9d6ddb2")
const REWARD_PAID = BigInt.fromString("1814069823640933344")

const CL_GAUGE_WITHDRAW_TOPIC = "0x8903a5b5d08a841e7f68438387f1da20c84dea756379ed37e633ff3854b99b84"

function word32(hex: string): string {
  let digits = hex.startsWith("0x") ? hex.slice(2) : hex
  return "0x" + "0".repeat(64 - digits.length) + digits
}

// Withdraw(address indexed user, uint256 indexed tokenId, uint128 indexed liquidityToStake)
function gaugeWithdraw(gauge: Address, user: Address, tokenId: i32, logIndex: i32): ethereum.Log {
  return newLog(gauge.toHexString(), [
    CL_GAUGE_WITHDRAW_TOPIC,
    word32(user.toHexString()),
    word32(tokenId.toString(16)),
    word32("1")
  ], "0x", logIndex)
}

describe("claimed rewards", () => {
  beforeEach(() => {
    mockEthUsd()
    seedTokenPrice(AERO, "AERO", 18, "0.05")
  })
  afterEach(() => {
    clearStore()
  })

  test("a reward Transfer goes to the tokenId of the gauge Withdraw after it (0x567935ab)", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let unstaked = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(53083183), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "1")
    let other = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(53000000), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1000), "50")
    let receipt = newReceipt([
      newLog("0xf7f575f2c0f6c99fa9efe1bde9e11fa10be4fef9", ["0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c", "0x0000000000000000000000000f5212f63ba8eab0fabd94fc2071d461d9d6ddb2", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff4", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff5"], "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 30),
      newLog("0xf7f575f2c0f6c99fa9efe1bde9e11fa10be4fef9", ["0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0", "0x0000000000000000000000000f5212f63ba8eab0fabd94fc2071d461d9d6ddb2", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff4", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff5"], "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 31),
      newLog("0x416b433906b1b72fa758e166e239c43d68dc6f29", ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], "0x000000000000000000000000000000000000000000000000000000000329fc2f", 32),
      newLog("0x416b433906b1b72fa758e166e239c43d68dc6f29", ["0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01", "0x000000000000000000000000000000000000000000000000000000000329fc2f"], "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 33),
      newLog("0x9560e827af36c94d2ac33a39bce1fe78631088db", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000f5212f63ba8eab0fabd94fc2071d461d9d6ddb2", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac"], "0x000000000000000000000000000000000000000000000000192cdee4abdf93e0", 34),
      newLog("0x0f5212f63ba8eab0fabd94fc2071d461d9d6ddb2", ["0x1f89f96333d3133000ee447473151fa9606543368f02271c9d95ae14f13bcc67", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac"], "0x000000000000000000000000000000000000000000000000192cdee4abdf93e0", 35),
      newLog("0x416b433906b1b72fa758e166e239c43d68dc6f29", ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x0000000000000000000000000f5212f63ba8eab0fabd94fc2071d461d9d6ddb2", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x000000000000000000000000000000000000000000000000000000000329fc2f"], "0x", 36),
      newLog("0x416b433906b1b72fa758e166e239c43d68dc6f29", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000f5212f63ba8eab0fabd94fc2071d461d9d6ddb2", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x000000000000000000000000000000000000000000000000000000000329fc2f"], "0x", 37),
      newLog("0x0f5212f63ba8eab0fabd94fc2071d461d9d6ddb2", ["0x8903a5b5d08a841e7f68438387f1da20c84dea756379ed37e633ff3854b99b84", "0x000000000000000000000000d32613ed605be41d9c7fbc85f2ccb4fba59778ac", "0x000000000000000000000000000000000000000000000000000000000329fc2f", "0x000000000000000000000000000000000000000000000000000000f0f6ba74d3"], "0x", 38),
      newLog("0xd32613ed605be41d9c7fbc85f2ccb4fba59778ac", ["0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e"], "0x14cf640a3fff3d0c862b097c1d9a51930e714f57108c804daa17589557d188270000000000000000000000000000000000000000000000000000000000000000", 39),
    ])
    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SAFE_D12, REWARD_PAID, 34, receipt), seededAddressType)

    positionField(unstaked, "claimedRewards", "1.814069823640933344")
    positionField(unstaked, "claimedRewardsUSD", "0.0907034911820466672")
    positionField(other, "claimedRewards", "0")
    assert.notInStore("FundingBalance", SAFE_D12.toHexString())
  })

  test("each reward goes to the Withdraw after it, not one before it", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let first = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1001), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "0")
    let second = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1002), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "0")
    // reward (20) → Withdraw(1001) (21) → reward (22) → Withdraw(1002) (23), all from one gauge
    let receipt = newReceipt([
      gaugeWithdraw(GAUGE_D12, SAFE_D12, 1001, 21),
      gaugeWithdraw(GAUGE_D12, SAFE_D12, 1002, 23)
    ])
    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SAFE_D12, BigInt.fromString("1000000000000000000"), 20, receipt), seededAddressType)
    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SAFE_D12, BigInt.fromString("2000000000000000000"), 22, receipt), seededAddressType)

    positionField(first, "claimedRewards", "1")
    positionField(second, "claimedRewards", "2")
  })

  test("a Withdraw from another gauge or for another user does not take the reward", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let unstaked = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1001), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "0")
    let other = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1002), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "0")
    // reward (20) → Withdraw(1002) by another gauge (21) → Withdraw(1002) for another user (22) → Withdraw(1001) (23)
    let receipt = newReceipt([
      gaugeWithdraw(OTHER, SAFE_D12, 1002, 21),
      gaugeWithdraw(GAUGE_D12, OTHER, 1002, 22),
      gaugeWithdraw(GAUGE_D12, SAFE_D12, 1001, 23)
    ])
    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SAFE_D12, BigInt.fromString("1000000000000000000"), 20, receipt), seededAddressType)

    positionField(unstaked, "claimedRewards", "1")
    positionField(other, "claimedRewards", "0")
  })

  test("a reward credited to a closed position is in its gain and ROI", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let p = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1001), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "0")
    closeAt(p, "100")
    let receipt = newReceipt([gaugeWithdraw(GAUGE_D12, SAFE_D12, 1001, 21)])
    // 20 reward tokens at $0.05
    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SAFE_D12, BigInt.fromString("20000000000000000000"), 20, receipt), seededAddressType)

    positionField(p, "claimedRewardsUSD", "1")
    positionField(p, "netGainUSD", "1")
    positionField(p, "positionROI", "1")
  })

  test("a Withdraw naming an untracked tokenId credits no other position", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let a = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1001), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "1")
    let b = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1002), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "1")
    let receipt = newReceipt([gaugeWithdraw(GAUGE_D12, SAFE_D12, 9999, 21)])
    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SAFE_D12, BigInt.fromString("1000000000000000000"), 20, receipt), seededAddressType)

    positionField(a, "claimedRewards", "0")
    positionField(b, "claimedRewards", "0")
  })

  test("a v2 gauge reward claimed after the exit goes to the last closed position on that gauge", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let older = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V2, BigInt.zero(), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "0")
    closeAt(older, "100")
    older.exitTimestamp = BLOCK_TIMESTAMP.minus(BigInt.fromI32(1000))
    older.save()
    let p = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V2, BigInt.fromI32(1), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "0")
    closeAt(p, "100")
    p.exitTimestamp = BLOCK_TIMESTAMP
    p.save()
    // 20 reward tokens at $0.05, paid by getReward after the LP left the gauge
    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SAFE_D12, BigInt.fromString("20000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(p, "claimedRewards", "20")
    positionField(p, "netGainUSD", "1")
    positionField(older, "claimedRewards", "0")
  })

  test("with no earned reward and no liquidity on record a CL claim is split equally", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let a = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.zero(), "0")
    let b = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(2), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.zero(), "0")
    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SERVICE_SAFE, BigInt.fromString("2000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(a, "claimedRewards", "1")
    positionField(b, "claimedRewards", "1")
  })

  test("the claimable reward a block started with survives later refreshes in that block", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1), "3")
    let block = newMockEvent().block
    block.number = BLOCK_NUMBER

    recordClaimableRewardBeforeBlock(p, block)
    p.claimableReward = BigDecimal.zero()
    recordClaimableRewardBeforeBlock(p, block)
    assert.fieldEquals("ClaimableRewardBeforeBlock", p.id.toHexString(), "claimableReward", "3")

    block.number = BLOCK_NUMBER.plus(BigInt.fromI32(1))
    p.claimableReward = BigDecimal.fromString("5")
    recordClaimableRewardBeforeBlock(p, block)
    assert.fieldEquals("ClaimableRewardBeforeBlock", p.id.toHexString(), "claimableReward", "5")
  })

  test("a CL claim with no Withdraw is split by what each position had earned before the block", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let a = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1000), "0")
    let b = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(2), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(1000), "1")
    // A refresh earlier in this block already wrote a's claimableReward to 0; it had 3 before
    let before = new ClaimableRewardBeforeBlock(a.id)
    before.block = BLOCK_NUMBER
    before.claimableReward = BigDecimal.fromString("3")
    before.save()

    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SERVICE_SAFE, BigInt.fromString("4000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(a, "claimedRewards", "3")
    positionField(b, "claimedRewards", "1")
  })

  test("with nothing earned on record the claim is split by liquidity", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let a = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(100), "0")
    let b = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(2), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(300), "0")

    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SERVICE_SAFE, BigInt.fromString("4000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(a, "claimedRewards", "1")
    positionField(b, "claimedRewards", "3")
  })

  test("a v2 gauge reward goes to the Safe's position on that gauge", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let lp = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V2, BigInt.zero(), USDC_NATIVE, BOLD, GAUGE_D12, BigInt.fromI32(5), "0")

    processERC20Transfer(newTransfer(AERO, GAUGE_D12, SERVICE_SAFE, BigInt.fromString("2000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(lp, "claimedRewards", "2")
  })

  test("a closed position's ROI counts its claimed rewards", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, BOLD, null, BigInt.zero(), "0")
    p.claimedRewardsUSD = BigDecimal.fromString("5")
    closeAt(p, "100")
    assert.stringEquals(calculateActualROI(SERVICE_SAFE).toString(), "5")
  })
})

// Base tx 0xcdd2ac26…: Aero CL gauge 0x46a9… mints 2.618… AERO to account 0x787f (from the zero
// address, not from the gauge), then emits EmissionsClaimed(account, 1226169, account, 2.618… AERO)
const ACCOUNT_D14 = Address.fromString("0x787fd1dc3b533171781e4ae1a563c1ac7b4435e4")
const BASE_AERO = Address.fromString("0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee")
const AERO_PAID = BigInt.fromString("2618141535596443223")

// claimEmissions(safe, safe, [first, second]): one EmissionsClaimed per tokenId, paid by one Transfer of their sum
const FIRST_CLAIM_PAID = BigInt.fromString("1500000000000000000")
const SECOND_CLAIM_PAID = BigInt.fromString("250000000000000000")
const BOTH_CLAIMS_PAID = FIRST_CLAIM_PAID.plus(SECOND_CLAIM_PAID)
const COVERS_FIRST_CLAIM_ONLY = BigInt.fromString("1600000000000000000")

function seedTwoAeroPositions(): ProtocolPosition[] {
  seedService(ACCOUNT_D14, OPERATOR_SAFE, AGENT_INSTANCE)
  return [
    seedPosition(ACCOUNT_D14, PROTOCOL_AERO_CL, BigInt.fromI32(1226169), USDC_NATIVE, BOLD, AERO_CL_GAUGE, BigInt.fromI32(1), "0"),
    seedPosition(ACCOUNT_D14, PROTOCOL_AERO_CL, BigInt.fromI32(1226170), USDC_NATIVE, BOLD, AERO_CL_GAUGE, BigInt.fromI32(1), "0")
  ]
}

function twoAeroClaimsReceipt(): ethereum.TransactionReceipt {
  return newReceipt([
    newLog("0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4"], "0x00000000000000000000000000000000000000000000000018493fba64ef0000", 10),
    newLog("0x46a9dca72d78366571be583aa69c1dc16e6889fb", ["0x7b6bd720815adbeaaaed4fc759e1a535705901f33709fbb33e62ee9a89427bb1", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4", "0x000000000000000000000000000000000000000000000000000000000012b5b9", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4"], "0x00000000000000000000000000000000000000000000000014d1120d7b160000", 11),
    newLog("0x46a9dca72d78366571be583aa69c1dc16e6889fb", ["0x7b6bd720815adbeaaaed4fc759e1a535705901f33709fbb33e62ee9a89427bb1", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4", "0x000000000000000000000000000000000000000000000000000000000012b5ba", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4"], "0x00000000000000000000000000000000000000000000000003782dace9d90000", 12)
  ])
}

const EMISSIONS_CLAIMED_TOPIC = "0x7b6bd720815adbeaaaed4fc759e1a535705901f33709fbb33e62ee9a89427bb1"
const AERO_CL_GAUGE_D14 = "0x46a9dca72d78366571be583aa69c1dc16e6889fb"
const AERO_CL_GAUGE = Address.fromString(AERO_CL_GAUGE_D14)
const ONE_REWARD = "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000"
const HALF_REWARD = "0x00000000000000000000000000000000000000000000000006f05b59d3b20000"
const QUARTER_REWARD = "0x00000000000000000000000000000000000000000000000003782dace9d90000"

// EmissionsClaimed(address indexed _account, uint256 indexed _tokenId, address indexed _recipient, uint256 _rewardAmount)
function emissionsClaimed(tokenId: i32, recipient: Address, amountWord: string, logIndex: i32): ethereum.Log {
  return newLog(AERO_CL_GAUGE_D14, [
    EMISSIONS_CLAIMED_TOPIC,
    word32(ACCOUNT_D14.toHexString()),
    word32(tokenId.toString(16)),
    word32(recipient.toHexString())
  ], amountWord, logIndex)
}

describe("Aero CL rewards from EmissionsClaimed", () => {
  beforeEach(() => {
    seedTokenPrice(AERO_PROTOCOL_AERO, "AERO", 18, "0.6")
  })
  afterEach(() => {
    clearStore()
  })

  test("EmissionsClaimed credits its tokenId once (0xcdd2ac26)", () => {
    seedService(ACCOUNT_D14, OPERATOR_SAFE, AGENT_INSTANCE)
    let p = seedPosition(ACCOUNT_D14, PROTOCOL_AERO_CL, BigInt.fromI32(1226169), USDC_NATIVE, BOLD, AERO_CL_GAUGE, BigInt.fromI32(1), "0")
    let receipt = newReceipt([
      newLog("0x4a7af46bc8abc00048c6c7920a1488daf568366c", ["0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c", "0x00000000000000000000000046a9dca72d78366571be583aa69c1dc16e6889fb", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcf612", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcf644"], "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 94),
      newLog("0x4a7af46bc8abc00048c6c7920a1488daf568366c", ["0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0", "0x00000000000000000000000046a9dca72d78366571be583aa69c1dc16e6889fb", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcf612", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcf644"], "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 95),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], "0x000000000000000000000000000000000000000000000000000000000012b5b9", 96),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01", "0x000000000000000000000000000000000000000000000000000000000012b5b9"], "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 97),
      newLog("0x382409fad8503fbcdbb27a4211551fa03e884078", ["0x2fc4875070bf2f61f7192e9e3710c8c8e3738c1a7ec632e3cbc591fc1242051a", "0x00000000000000000000000046a9dca72d78366571be583aa69c1dc16e6889fb"], "0x000000000000000000000000000000000000000000000000488c160d489c91100000000000000000000000000000000000000000000000003408be8b45e3b0ee000000000000000000000000000000000000000000000000060bac811b62616c0000000000000000000000000000000000000000002f1c3bd2a2c353e76bb42a", 98),
      newLog("0x46a9dca72d78366571be583aa69c1dc16e6889fb", ["0xd14a5bd00daa2f3d53854ba105be35afa78eb389d08398e4bdc0fb5620d02fce"], "0x0000000000000000000000000000000000000000000062df0b08a00306234ec0000000000000000000000000000000000000000000000000488c160d489c9110", 99),
      newLog("0x6cdda0e730744dc6ff67654b35350adad05ecee7", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x0000000000000000000000008c37f30f3c8fd48beddb14086fa5148291d422c3"], "0x000000000000000000000000000000000000000000000000245581dae8ebf657", 100),
      newLog("0x6cdda0e730744dc6ff67654b35350adad05ecee7", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000008c37f30f3c8fd48beddb14086fa5148291d422c3", "0x0000000000000000000000000000000000000000000000000000000000000000"], "0x000000000000000000000000000000000000000000000000245581dae8ebf657", 101),
      newLog("0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4"], "0x000000000000000000000000000000000000000000000000245581dae8ebf657", 102),
      newLog("0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x0000000000000000000000009beb95cced809c0667bbb6577ee4066ac5cc1156"], "0x00000000000000000000000000000000000000000000000001d1134af20bcc51", 103),
      newLog("0x59268a34ba897e82368fee39839ffc661d4f9c97", ["0x25b428dfde728ccfaddad7e29e4ac23c24ed7fd1a6e3e3f91894a9a073f5dfff", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4"], "0x000000000000000000000000000000000000000000000000245581dae8ebf65700000000000000000000000000000000000000000000000001d1134af20bcc51", 104),
      newLog("0x49d7d4f17ec56ef8fa04e464af5d1a4942cc31e6", ["0x871c9c135204dfaa6a5ebebccc99a16da2bfb11ef83a4511d5c87cab5f7916f8", "0x0000000000000000000000000000000000000000000000000000000000002105", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4"], "0x000000000000000000000000000000000000000000000000245581dae8ebf65700000000000000000000000000000000000000000003ec5dd84d780d2565c93b", 105),
      newLog("0x4f347fec2aeb8fdb569045af4d0806ee7f7f6194", ["0x93353145426252e868e8c3c5aa51e34eeaadf3bd6e61a28c32770f3e5928305a", "0x0000000000000000000000000000000000000000000000000000000000002105"], "0x00000000000000000000000000000000000000000000000000000000001674d20000000000000000000000000000000000000000000000000000000000000004", 106),
      newLog("0x7ea1079604af6da2282b80f4cdc6cea7b07914fe", ["0x9ece25ff2f38a4b95c813c9bde80512c628d5cf29c3922ba549630f856fb5858", "0x0000000000000000000000000000000000000000000000000000000000002105"], "0x00000000000000000000000000000000000000000000000000000000001674d20000000000000000000000000000000000000000000000000000000000000004", 107),
      newLog("0x382409fad8503fbcdbb27a4211551fa03e884078", ["0x27d4634c833b7622a0acddbf7f746183625f105945e95c723ad1d5a9f2a0b6fc", "0x0000000000000000000000008c37f30f3c8fd48beddb14086fa5148291d422c3", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4"], "0x000000000000000000000000000000000000000000000000245581dae8ebf657", 108),
      newLog("0x382409fad8503fbcdbb27a4211551fa03e884078", ["0x9acaadd0523552411c0e34a0160b98573211a163d69962b54a3786be27542f7a", "0x00000000000000000000000046a9dca72d78366571be583aa69c1dc16e6889fb"], "0x000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e40000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000245581dae8ebf657", 109),
      newLog("0x46a9dca72d78366571be583aa69c1dc16e6889fb", ["0x7b6bd720815adbeaaaed4fc759e1a535705901f33709fbb33e62ee9a89427bb1", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4", "0x000000000000000000000000000000000000000000000000000000000012b5b9", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4"], "0x000000000000000000000000000000000000000000000000245581dae8ebf657", 110),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x00000000000000000000000046a9dca72d78366571be583aa69c1dc16e6889fb", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x000000000000000000000000000000000000000000000000000000000012b5b9"], "0x", 111),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x00000000000000000000000046a9dca72d78366571be583aa69c1dc16e6889fb", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4", "0x000000000000000000000000000000000000000000000000000000000012b5b9"], "0x", 112),
      newLog("0x46a9dca72d78366571be583aa69c1dc16e6889fb", ["0xac2f121be0a440c47693663f2118f4d3b12cf85696cbe2c7a1b4a35e68a827d2", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4", "0x000000000000000000000000000000000000000000000000000000000012b5b9"], "0x00000000000000000000000000000000000000000000000066e86cef2a33ccf3", 113),
      newLog("0x4a7af46bc8abc00048c6c7920a1488daf568366c", ["0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c", "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcf612", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcf644"], "0x00000000000000000000000000000000000000000000000066e86cef2a33ccf3000000000000000000000000000000000000000000000005570c14cab10e464e0000000000000000000000000000000000000000000000000000009911dd73f5", 114),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], "0x000000000000000000000000000000000000000000000000000000000012b5b9", 115),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4", "0x000000000000000000000000000000000000000000000000000000000012b5b9"], "0x00000000000000000000000000000000000000000000000066e86cef2a33ccf3000000000000000000000000000000000000000000000005570c14cab10e464e0000000000000000000000000000000000000000000000000000009911dd73f5", 116),
      newLog("0x4200000000000000000000000000000000000006", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000004a7af46bc8abc00048c6c7920a1488daf568366c", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4"], "0x000000000000000000000000000000000000000000000005570c14cab10e464e", 117),
      newLog("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000004a7af46bc8abc00048c6c7920a1488daf568366c", "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4"], "0x0000000000000000000000000000000000000000000000000000009911dd73f5", 118),
      newLog("0x4a7af46bc8abc00048c6c7920a1488daf568366c", ["0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0", "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcf612", "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcf644"], "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4000000000000000000000000000000000000000000000005570c14cab10e464e0000000000000000000000000000000000000000000000000000009911dd73f5", 119),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], "0x000000000000000000000000000000000000000000000000000000000012b5b9", 120),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01", "0x000000000000000000000000000000000000000000000000000000000012b5b9"], "0x000000000000000000000000787fd1dc3b533171781e4ae1a563c1ac7b4435e4000000000000000000000000000000000000000000000005570c14cab10e464e0000000000000000000000000000000000000000000000000000009911dd73f5", 121),
    ])
    let event = newTransfer(BASE_AERO, Address.zero(), ACCOUNT_D14, AERO_PAID, 102, receipt)

    assert.assertTrue(attributeRewardTransfer(event, Address.zero(), ACCOUNT_D14, AERO_PAID))
    assert.assertTrue(!attributeRewardTransfer(event, Address.zero(), ACCOUNT_D14, AERO_PAID))

    positionField(p, "claimedRewards", "2.618141535596443223")
  })

  test("one claimEmissions over two tokenIds credits each its own amount", () => {
    let positions = seedTwoAeroPositions()
    let event = newTransfer(BASE_AERO, Address.zero(), ACCOUNT_D14, BOTH_CLAIMS_PAID, 10, twoAeroClaimsReceipt())

    assert.assertTrue(attributeRewardTransfer(event, Address.zero(), ACCOUNT_D14, BOTH_CLAIMS_PAID))
    assert.assertTrue(!attributeRewardTransfer(event, Address.zero(), ACCOUNT_D14, BOTH_CLAIMS_PAID))

    positionField(positions[0], "claimedRewards", "1.5")
    positionField(positions[1], "claimedRewards", "0.25")
  })

  test("only claims paid to the Safe, for its own tokenIds, are credited", () => {
    seedService(ACCOUNT_D14, OPERATOR_SAFE, AGENT_INSTANCE)
    seedService(OTHER, OPERATOR_SAFE, AGENT_INSTANCE)
    let mine = seedPosition(ACCOUNT_D14, PROTOCOL_AERO_CL, BigInt.fromI32(1226169), USDC_NATIVE, BOLD, AERO_CL_GAUGE, BigInt.fromI32(1), "0")
    let theirs = seedPosition(OTHER, PROTOCOL_AERO_CL, BigInt.fromI32(1226170), USDC_NATIVE, BOLD, AERO_CL_GAUGE, BigInt.fromI32(1), "0")
    // 1 to another recipient, 0.5 for another Safe's tokenId, 0.25 to the Safe for its own; one Transfer covers all
    let receipt = newReceipt([
      emissionsClaimed(1226169, OTHER, ONE_REWARD, 11),
      emissionsClaimed(1226170, ACCOUNT_D14, HALF_REWARD, 12),
      emissionsClaimed(1226169, ACCOUNT_D14, QUARTER_REWARD, 13)
    ])
    let paid = BigInt.fromString("1750000000000000000")
    let event = newTransfer(BASE_AERO, Address.zero(), ACCOUNT_D14, paid, 14, receipt)

    assert.assertTrue(attributeRewardTransfer(event, Address.zero(), ACCOUNT_D14, paid))

    positionField(mine, "claimedRewards", "0.25")
    positionField(mine, "claimedRewardsUSD", "0.15")
    positionField(theirs, "claimedRewards", "0")
  })

  test("an EmissionsClaimed not emitted by the position's gauge is not credited", () => {
    seedService(ACCOUNT_D14, OPERATOR_SAFE, AGENT_INSTANCE)
    let mine = seedPosition(ACCOUNT_D14, PROTOCOL_AERO_CL, BigInt.fromI32(1226169), USDC_NATIVE, BOLD, AERO_CL_GAUGE, BigInt.fromI32(1), "0")
    let receipt = newReceipt([
      newLog(OTHER.toHexString(), [
        EMISSIONS_CLAIMED_TOPIC,
        word32(ACCOUNT_D14.toHexString()),
        word32((1226169 as i32).toString(16)),
        word32(ACCOUNT_D14.toHexString())
      ], QUARTER_REWARD, 11)
    ])
    let paid = BigInt.fromString("250000000000000000")
    let event = newTransfer(BASE_AERO, Address.zero(), ACCOUNT_D14, paid, 12, receipt)

    attributeRewardTransfer(event, Address.zero(), ACCOUNT_D14, paid)

    positionField(mine, "claimedRewards", "0")
  })

  test("a Transfer pays only the claims its amount covers, in log order", () => {
    let positions = seedTwoAeroPositions()
    let event = newTransfer(BASE_AERO, Address.zero(), ACCOUNT_D14, COVERS_FIRST_CLAIM_ONLY, 10, twoAeroClaimsReceipt())

    assert.assertTrue(attributeRewardTransfer(event, Address.zero(), ACCOUNT_D14, COVERS_FIRST_CLAIM_ONLY))

    positionField(positions[0], "claimedRewards", "1.5")
    positionField(positions[1], "claimedRewards", "0")
  })

  test("a claim the Transfer cannot cover is skipped and later ones are still credited", () => {
    let positions = seedTwoAeroPositions()
    let event = newTransfer(BASE_AERO, Address.zero(), ACCOUNT_D14, SECOND_CLAIM_PAID, 10, twoAeroClaimsReceipt())

    assert.assertTrue(attributeRewardTransfer(event, Address.zero(), ACCOUNT_D14, SECOND_CLAIM_PAID))

    positionField(positions[0], "claimedRewards", "0")
    positionField(positions[1], "claimedRewards", "0.25")
  })

  test("a Transfer of another token does not take the claims", () => {
    let positions = seedTwoAeroPositions()
    seedTokenPrice(BOLD, "BOLD", 18, "1")
    let receipt = twoAeroClaimsReceipt()
    let other = newTransfer(BOLD, OTHER, ACCOUNT_D14, BOTH_CLAIMS_PAID, 9, receipt)

    assert.assertTrue(!attributeRewardTransfer(other, OTHER, ACCOUNT_D14, BOTH_CLAIMS_PAID))
    positionField(positions[0], "claimedRewards", "0")

    let reward = newTransfer(BASE_AERO, Address.zero(), ACCOUNT_D14, BOTH_CLAIMS_PAID, 10, receipt)
    assert.assertTrue(attributeRewardTransfer(reward, Address.zero(), ACCOUNT_D14, BOTH_CLAIMS_PAID))
    positionField(positions[0], "claimedRewards", "1.5")
    positionField(positions[1], "claimedRewards", "0.25")
  })
})
