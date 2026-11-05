import { assert, describe, test, clearStore, afterEach, beforeEach, createMockedFunction } from "matchstick-as/assembly/index"
import { Address, BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { newMockEvent } from "matchstick-as/assembly/index"
import { AgentSwapBuffer, ClaimableRewardBeforeBlock, ProtocolPosition } from "../generated/schema"
import { Collect, DecreaseLiquidity } from "../generated/VeloNFTManager/VelodromePositionNFTManager"
import {
  Collect as UniV3Collect,
  DecreaseLiquidity as UniV3DecreaseLiquidity,
  IncreaseLiquidity as UniV3IncreaseLiquidity,
  Transfer as UniV3Transfer
} from "../generated/UniV3NFTManager/UniswapV3PositionNFTManager"
import { handleCollect, handleDecreaseLiquidity } from "../src/veloNFTManager"
import { handleUniV3Collect, handleUniV3DecreaseLiquidity, handleUniV3IncreaseLiquidity, handleUniV3Transfer } from "../src/uniV3NFTManager"
import { processERC20Transfer } from "../src/tokenBalances"
import { attributeRewardTransfer, recordClaimableRewardBeforeBlock } from "../src/positionIncome"
import { calculateActualROI } from "../src/roiCalculation"
import { calculatePortfolioMetrics } from "../src/helpers"
import { searchAndAssociateRecentSwaps } from "../src/swapTracking"
import { refreshBalancerPosition, refreshBalancerPositionWithEventAmounts, getBalancerPositionId } from "../src/balancerShared"
import { USDC_NATIVE, DAI, VELO, VELO_MANAGER, UNI_V3_MANAGER, PROTOCOL_VELODROME_V3, PROTOCOL_VELODROME_V2, PROTOCOL_UNISWAP_V3, PROTOCOL_AERO_CL, AERO_NFT_MANAGER, UNI_V3_FACTORY, BALANCER_VAULT } from "../src/constants"
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
const DAI_50 = BigInt.fromString("50000000000000000000")

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
    seedTokenPrice(DAI, "DAI", 18, "1")
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
  })
  afterEach(() => {
    clearStore()
  })

  test("Collect finds the Velodrome CL position and records only the fee part", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    closeAt(p, "100")
    // positions() reverting stops the refresh after the principal is recorded
    createMockedFunction(VELO_MANAGER, "positions", "positions(uint256):(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))])
      .reverts()
    handleDecreaseLiquidity(newDecrease(BigInt.fromI32(7), USDC_50, DAI_50))

    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(51000000), BigInt.fromString("50500000000000000000")))

    positionField(p, "collectedFees0", "1")
    positionField(p, "collectedFees1", "0.5")
    positionField(p, "collectedFeesUSD", "1.5")
    positionField(p, "exitAmountUSD", "100")
    positionField(p, "netGainUSD", "1.5")
    positionField(p, "positionROI", "1.5")
  })

  test("a fee on a closed position with no recorded investment is still saved", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(8), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    p.entryAmountUSD = BigDecimal.zero()
    p.investmentUSD = BigDecimal.zero()
    p.save()
    closeAt(p, "0")

    handleCollect(newCollect(BigInt.fromI32(8), SERVICE_SAFE, BigInt.fromI64(2000000), BigInt.zero()))

    positionField(p, "collectedFeesUSD", "2")
  })

  test("a Collect smaller than the owed principal books no fee and leaves the rest owed", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
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

  test("a swap linked to a closed position keeps its fees and rewards in the gross gain", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    closeAt(p, "110")
    p.collectedFeesUSD = BigDecimal.fromString("2")
    p.claimedRewardsUSD = BigDecimal.fromString("3")
    p.save()
    // One swap with $5 of slippage waiting in the agent's newest bucket
    let buffer = new AgentSwapBuffer(SERVICE_SAFE)
    buffer.agent = SERVICE_SAFE
    buffer.bucket0Swaps = BLOCK_TIMESTAMP.toString() + ",0x01,5," + BLOCK_TIMESTAMP.toString() + ",0x01"
    buffer.bucket1Swaps = ""
    buffer.bucket2Swaps = ""
    buffer.bucket3Swaps = ""
    buffer.totalSlippageUSD = BigDecimal.fromString("5")
    buffer.lastUpdated = BLOCK_TIMESTAMP
    buffer.currentBucketIndex = BigInt.zero()
    buffer.save()

    searchAndAssociateRecentSwaps(p)

    positionField(p, "investmentUSD", "105")
    positionField(p, "grossGainUSD", "115")
    positionField(p, "netGainUSD", "10")
  })

  test("the portfolio's gross gain adds closed positions' fees and rewards to their exit", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    closeAt(p, "100")
    p.collectedFeesUSD = BigDecimal.fromString("2")
    p.claimedRewardsUSD = BigDecimal.fromString("3")
    p.save()

    calculatePortfolioMetrics(SERVICE_SAFE, newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.zero(), BigInt.zero()).block)

    assert.fieldEquals("AgentPortfolio", SERVICE_SAFE.toHexString(), "totalGrossGains", "105")
  })

  test("each fee leg is valued at its own token's price", () => {
    seedTokenPrice(DAI, "DAI", 18, "2")
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    closeAt(p, "100")
    // 1 USDC at $1 and 0.5 DAI at $2
    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(1000000), BigInt.fromString("500000000000000000")))
    positionField(p, "collectedFeesUSD", "2")
  })

  test("a Collect paid to another address is not the Safe's fee", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    closeAt(p, "100")
    handleCollect(newCollect(BigInt.fromI32(7), OTHER, BigInt.fromI64(1000000), BigInt.zero()))
    positionField(p, "collectedFeesUSD", "0")
  })

  test("principal collected to another address is not taken from a later fee Collect to the Safe", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    closeAt(p, "100")
    createMockedFunction(VELO_MANAGER, "positions", "positions(uint256):(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))])
      .reverts()
    handleDecreaseLiquidity(newDecrease(BigInt.fromI32(7), USDC_50, DAI_50))

    handleCollect(newCollect(BigInt.fromI32(7), OTHER, USDC_50, DAI_50))
    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(5000000), BigInt.zero()))

    positionField(p, "collectedFees0", "5")
    positionField(p, "collectedFeesUSD", "5")
  })

  test("an Aero NFPM Collect books its fee on the aero-cl position, not a Velodrome one with the same tokenId", () => {
    let velo = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(7), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    closeAt(velo, "100")
    let aero = seedPosition(SERVICE_SAFE, PROTOCOL_AERO_CL, BigInt.fromI32(7), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    closeAt(aero, "100")
    createMockedFunction(AERO_NFT_MANAGER, "positions", "positions(uint256):(uint96,address,address,address,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))])
      .reverts()
    handleDecreaseLiquidity(newDecrease(BigInt.fromI32(7), USDC_50, DAI_50, AERO_NFT_MANAGER))

    // The principal is owed under aero-cl, so a Velodrome Collect of the same tokenId is all fee
    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(2000000), BigInt.zero()))
    handleCollect(newCollect(BigInt.fromI32(7), SERVICE_SAFE, BigInt.fromI64(51000000), BigInt.fromString("50500000000000000000"), AERO_NFT_MANAGER))

    positionField(aero, "collectedFeesUSD", "1.5")
    positionField(velo, "collectedFeesUSD", "2")
  })

  test("Uniswap V3: a position opened by IncreaseLiquidity is found by its DecreaseLiquidity and Collect", () => {
    const tokenId = BigInt.fromI32(77)
    const pool = Address.fromString("0x00000000000000000000000000000000000000d7")
    createMockedFunction(UNI_V3_MANAGER, "ownerOf", "ownerOf(uint256):(address)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(tokenId)])
      .returns([ethereum.Value.fromAddress(SERVICE_SAFE)])
    createMockedFunction(UNI_V3_MANAGER, "positions", "positions(uint256):(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(tokenId)])
      .returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
        ethereum.Value.fromAddress(Address.zero()),
        ethereum.Value.fromAddress(USDC_NATIVE),
        ethereum.Value.fromAddress(DAI),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(100)),
        ethereum.Value.fromI32(-10),
        ethereum.Value.fromI32(10),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000)),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero())
      ])
    createMockedFunction(UNI_V3_FACTORY, "getPool", "getPool(address,address,uint24):(address)")
      .withArgs([ethereum.Value.fromAddress(USDC_NATIVE), ethereum.Value.fromAddress(DAI), ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(100))])
      .returns([ethereum.Value.fromAddress(pool)])
    // The current-value refresh stops at slot0; the position and its mapping are already written
    createMockedFunction(pool, "slot0", "slot0():(uint160,int24,uint16,uint16,uint16,uint8,bool)").withArgs([]).reverts()

    let increase = changetype<UniV3IncreaseLiquidity>(newMockEvent())
    increase.address = UNI_V3_MANAGER
    increase.parameters = new Array()
    increase.parameters.push(new ethereum.EventParam("tokenId", ethereum.Value.fromUnsignedBigInt(tokenId)))
    increase.parameters.push(new ethereum.EventParam("liquidity", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000))))
    increase.parameters.push(new ethereum.EventParam("amount0", ethereum.Value.fromUnsignedBigInt(USDC_50)))
    increase.parameters.push(new ethereum.EventParam("amount1", ethereum.Value.fromUnsignedBigInt(DAI_50)))
    increase.block.number = BLOCK_NUMBER
    increase.block.timestamp = BLOCK_TIMESTAMP
    handleUniV3IncreaseLiquidity(increase)

    let decrease = changetype<UniV3DecreaseLiquidity>(newDecrease(tokenId, USDC_50, DAI_50, UNI_V3_MANAGER))
    handleUniV3DecreaseLiquidity(decrease)
    handleUniV3Collect(changetype<UniV3Collect>(newCollect(tokenId, SERVICE_SAFE, BigInt.fromI64(53000000), DAI_50, UNI_V3_MANAGER)))

    let id = Bytes.fromUTF8(SERVICE_SAFE.toHexString() + "-uniswap-v3-77")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "collectedFeesUSD", "3")
  })

  test("Uniswap V3: a position opened by its mint Transfer is found by its DecreaseLiquidity and Collect", () => {
    const tokenId = BigInt.fromI32(78)
    const pool = Address.fromString("0x00000000000000000000000000000000000000d7")
    createMockedFunction(UNI_V3_MANAGER, "ownerOf", "ownerOf(uint256):(address)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(tokenId)])
      .returns([ethereum.Value.fromAddress(SERVICE_SAFE)])
    createMockedFunction(UNI_V3_MANAGER, "positions", "positions(uint256):(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(tokenId)])
      .returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
        ethereum.Value.fromAddress(Address.zero()),
        ethereum.Value.fromAddress(USDC_NATIVE),
        ethereum.Value.fromAddress(DAI),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(100)),
        ethereum.Value.fromI32(-10),
        ethereum.Value.fromI32(10),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000)),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
        ethereum.Value.fromUnsignedBigInt(BigInt.zero())
      ])
    createMockedFunction(UNI_V3_FACTORY, "getPool", "getPool(address,address,uint24):(address)")
      .withArgs([ethereum.Value.fromAddress(USDC_NATIVE), ethereum.Value.fromAddress(DAI), ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(100))])
      .returns([ethereum.Value.fromAddress(pool)])
    // At tick 0, inside the position's range; the mint Transfer's refresh creates the position
    createMockedFunction(pool, "slot0", "slot0():(uint160,int24,uint16,uint16,uint16,uint8,bool)").withArgs([]).returns([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString("79228162514264337593543950336")),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromBoolean(true)
    ])

    let mint = changetype<UniV3Transfer>(newMockEvent())
    mint.address = UNI_V3_MANAGER
    mint.parameters = new Array()
    mint.parameters.push(new ethereum.EventParam("from", ethereum.Value.fromAddress(Address.zero())))
    mint.parameters.push(new ethereum.EventParam("to", ethereum.Value.fromAddress(SERVICE_SAFE)))
    mint.parameters.push(new ethereum.EventParam("tokenId", ethereum.Value.fromUnsignedBigInt(tokenId)))
    mint.block.number = BLOCK_NUMBER
    mint.block.timestamp = BLOCK_TIMESTAMP
    handleUniV3Transfer(mint)

    let decrease = changetype<UniV3DecreaseLiquidity>(newDecrease(tokenId, USDC_50, DAI_50, UNI_V3_MANAGER))
    handleUniV3DecreaseLiquidity(decrease)
    handleUniV3Collect(changetype<UniV3Collect>(newCollect(tokenId, SERVICE_SAFE, BigInt.fromI64(53000000), DAI_50, UNI_V3_MANAGER)))

    let id = Bytes.fromUTF8(SERVICE_SAFE.toHexString() + "-uniswap-v3-78")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "collectedFeesUSD", "3")
  })

  test("Uniswap V3: a DecreaseLiquidity for an NFT the agent does not hold records no principal", () => {
    createMockedFunction(UNI_V3_MANAGER, "ownerOf", "ownerOf(uint256):(address)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(99))])
      .reverts()
    handleUniV3DecreaseLiquidity(changetype<UniV3DecreaseLiquidity>(newDecrease(BigInt.fromI32(99), USDC_50, DAI_50, UNI_V3_MANAGER)))
    assert.entityCount("UncollectedPrincipal", 0)
  })

  test("Uniswap V3: a Collect on a closed position recalculates the portfolio", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_UNISWAP_V3, BigInt.fromI32(9), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    closeAt(p, "100")
    createMockedFunction(UNI_V3_MANAGER, "ownerOf", "ownerOf(uint256):(address)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(9))])
      .reverts()
    assert.entityCount("AgentPortfolio", 0)

    handleUniV3Collect(changetype<UniV3Collect>(newCollect(BigInt.fromI32(9), SERVICE_SAFE, BigInt.fromI64(2000000), BigInt.zero(), UNI_V3_MANAGER)))

    positionField(p, "collectedFeesUSD", "2")
    assert.entityCount("AgentPortfolio", 1)
  })

  test("Uniswap V3: DecreaseLiquidity principal is subtracted from the next Collect", () => {
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_UNISWAP_V3, BigInt.fromI32(9), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    createMockedFunction(UNI_V3_MANAGER, "ownerOf", "ownerOf(uint256):(address)")
      .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(9))])
      .reverts()

    handleUniV3DecreaseLiquidity(changetype<UniV3DecreaseLiquidity>(newDecrease(BigInt.fromI32(9), USDC_50, DAI_50, UNI_V3_MANAGER)))
    handleUniV3Collect(changetype<UniV3Collect>(newCollect(BigInt.fromI32(9), SERVICE_SAFE, BigInt.fromI64(52000000), DAI_50, UNI_V3_MANAGER)))

    positionField(p, "collectedFeesUSD", "2")
  })
})

// Optimism tx 0x567935ab…: Safe 0xd32613 unstakes tokenId 53083183 from Velodrome CL gauge 0x0f52…;
// the gauge pays 1.814069823640933344 VELO, then emits Withdraw(Safe, 53083183, …)
const SAFE_D12 = Address.fromString("0xd32613ed605be41d9c7fbc85f2ccb4fba59778ac")
const GAUGE_D12 = Address.fromString("0x0f5212f63ba8eab0fabd94fc2071d461d9d6ddb2")
const VELO_PAID = BigInt.fromString("1814069823640933344")

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
    seedTokenPrice(VELO, "VELO", 18, "0.05")
  })
  afterEach(() => {
    clearStore()
  })

  test("a reward Transfer goes to the tokenId of the gauge Withdraw after it (0x567935ab)", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let unstaked = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(53083183), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "1")
    let other = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(53000000), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1000), "50")
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
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SAFE_D12, VELO_PAID, 34, receipt), seededAddressType)

    positionField(unstaked, "claimedRewards", "1.814069823640933344")
    positionField(unstaked, "claimedRewardsUSD", "0.0907034911820466672")
    positionField(other, "claimedRewards", "0")
    assert.notInStore("FundingBalance", SAFE_D12.toHexString())
  })

  test("each reward goes to the Withdraw after it, not one before it", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let first = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1001), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "0")
    let second = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1002), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "0")
    // reward (20) → Withdraw(1001) (21) → reward (22) → Withdraw(1002) (23), all from one gauge
    let receipt = newReceipt([
      gaugeWithdraw(GAUGE_D12, SAFE_D12, 1001, 21),
      gaugeWithdraw(GAUGE_D12, SAFE_D12, 1002, 23)
    ])
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SAFE_D12, BigInt.fromString("1000000000000000000"), 20, receipt), seededAddressType)
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SAFE_D12, BigInt.fromString("2000000000000000000"), 22, receipt), seededAddressType)

    positionField(first, "claimedRewards", "1")
    positionField(second, "claimedRewards", "2")
  })

  test("a Withdraw from another gauge or for another user does not take the reward", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let unstaked = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1001), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "0")
    let other = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1002), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "0")
    // reward (20) → Withdraw(1002) by another gauge (21) → Withdraw(1002) for another user (22) → Withdraw(1001) (23)
    let receipt = newReceipt([
      gaugeWithdraw(OTHER, SAFE_D12, 1002, 21),
      gaugeWithdraw(GAUGE_D12, OTHER, 1002, 22),
      gaugeWithdraw(GAUGE_D12, SAFE_D12, 1001, 23)
    ])
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SAFE_D12, BigInt.fromString("1000000000000000000"), 20, receipt), seededAddressType)

    positionField(unstaked, "claimedRewards", "1")
    positionField(other, "claimedRewards", "0")
  })

  test("a reward credited to a closed position is in its gain and ROI", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let p = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1001), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "0")
    closeAt(p, "100")
    let receipt = newReceipt([gaugeWithdraw(GAUGE_D12, SAFE_D12, 1001, 21)])
    // 20 reward tokens at $0.05
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SAFE_D12, BigInt.fromString("20000000000000000000"), 20, receipt), seededAddressType)

    positionField(p, "claimedRewardsUSD", "1")
    positionField(p, "netGainUSD", "1")
    positionField(p, "positionROI", "1")
  })

  test("a Withdraw naming an untracked tokenId credits no other position", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let a = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1001), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "1")
    let b = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1002), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "1")
    let receipt = newReceipt([gaugeWithdraw(GAUGE_D12, SAFE_D12, 9999, 21)])
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SAFE_D12, BigInt.fromString("1000000000000000000"), 20, receipt), seededAddressType)

    positionField(a, "claimedRewards", "0")
    positionField(b, "claimedRewards", "0")
  })

  test("a v2 gauge reward claimed after the exit goes to the last closed position on that gauge", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let older = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V2, BigInt.zero(), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "0")
    closeAt(older, "100")
    older.exitTimestamp = BLOCK_TIMESTAMP.minus(BigInt.fromI32(1000))
    older.save()
    let p = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V2, BigInt.fromI32(1), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "0")
    closeAt(p, "100")
    p.exitTimestamp = BLOCK_TIMESTAMP
    p.save()
    // 20 reward tokens at $0.05, paid by getReward after the LP left the gauge
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SAFE_D12, BigInt.fromString("20000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(p, "claimedRewards", "20")
    positionField(p, "netGainUSD", "1")
    positionField(older, "claimedRewards", "0")
  })

  test("a closed position on the gauge takes no share of a split claim", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let active = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "1")
    // A stale claimableReward left on the closed position must not weigh in
    let closed = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(2), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "3")
    closeAt(closed, "100")
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SERVICE_SAFE, BigInt.fromString("2000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(active, "claimedRewards", "2")
    positionField(closed, "claimedRewards", "0")
  })

  test("a claim with no Withdraw and only closed CL positions on the gauge credits none of them", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let p = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V3, BigInt.fromI32(1001), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "0")
    closeAt(p, "100")
    p.exitTimestamp = BLOCK_TIMESTAMP
    p.save()
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SAFE_D12, BigInt.fromString("20000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(p, "claimedRewards", "0")
  })

  test("a v2 reward after the exit goes to the latest exit, whichever position was opened first", () => {
    seedService(SAFE_D12, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let newer = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V2, BigInt.fromI32(1), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "0")
    closeAt(newer, "100")
    newer.exitTimestamp = BLOCK_TIMESTAMP
    newer.save()
    let older = seedPosition(SAFE_D12, PROTOCOL_VELODROME_V2, BigInt.zero(), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "0")
    closeAt(older, "100")
    older.exitTimestamp = BLOCK_TIMESTAMP.minus(BigInt.fromI32(1000))
    older.save()
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SAFE_D12, BigInt.fromString("20000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(newer, "claimedRewards", "20")
    positionField(older, "claimedRewards", "0")
  })

  test("with no earned reward and no liquidity on record a CL claim is split equally", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let a = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, DAI, GAUGE_D12, BigInt.zero(), "0")
    let b = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(2), USDC_NATIVE, DAI, GAUGE_D12, BigInt.zero(), "0")
    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SERVICE_SAFE, BigInt.fromString("2000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(a, "claimedRewards", "1")
    positionField(b, "claimedRewards", "1")
  })

  test("the claimable reward a block started with survives later refreshes in that block", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1), "3")
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
    let a = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1000), "0")
    let b = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(2), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(1000), "1")
    // A refresh earlier in this block already wrote a's claimableReward to 0; it had 3 before
    let before = new ClaimableRewardBeforeBlock(a.id)
    before.block = BLOCK_NUMBER
    before.claimableReward = BigDecimal.fromString("3")
    before.save()

    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SERVICE_SAFE, BigInt.fromString("4000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(a, "claimedRewards", "3")
    positionField(b, "claimedRewards", "1")
  })

  test("with nothing earned on record the claim is split by liquidity", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let a = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(100), "0")
    let b = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(2), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(300), "0")

    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SERVICE_SAFE, BigInt.fromString("4000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(a, "claimedRewards", "1")
    positionField(b, "claimedRewards", "3")
  })

  test("a v2 gauge reward goes to the Safe's position on that gauge", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    seedAddressType(GAUGE_D12, true, false)
    let lp = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V2, BigInt.zero(), USDC_NATIVE, DAI, GAUGE_D12, BigInt.fromI32(5), "0")

    processERC20Transfer(newTransfer(VELO, GAUGE_D12, SERVICE_SAFE, BigInt.fromString("2000000000000000000"), 1, newReceipt([])), seededAddressType)

    positionField(lp, "claimedRewards", "2")
  })

  test("a closed position's ROI counts its claimed rewards", () => {
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
    let p = seedPosition(SERVICE_SAFE, PROTOCOL_VELODROME_V3, BigInt.fromI32(1), USDC_NATIVE, DAI, null, BigInt.zero(), "0")
    p.claimedRewardsUSD = BigDecimal.fromString("5")
    closeAt(p, "100")
    assert.stringEquals(calculateActualROI(SERVICE_SAFE).toString(), "5")
  })
})

// Optimism tx 0x7daa9dd3…: Aero CL gauge 0x9bf2… emits EmissionsClaimed(account, 53640, account, 0.2143… xAERO);
// the xAERO comes from LeafEmissionsHandler 0x1ae1…, not from the gauge
const ACCOUNT_D14 = Address.fromString("0xc5e3818458167662fe741e3f930a05a41f952af6")
const XAERO = Address.fromString("0xbdeaea5205d16f34cb40038052d91235d87b4c54")
const LEAF_EMISSIONS_HANDLER = Address.fromString("0x1ae1793aa67bb8a234a39ed1071d43b785b001ce")
const XAERO_PAID = BigInt.fromString("214333257835848575")

// claimEmissions(safe, safe, [first, second]): one EmissionsClaimed per tokenId, paid by one Transfer of their sum
const FIRST_CLAIM_PAID = BigInt.fromString("1500000000000000000")
const SECOND_CLAIM_PAID = BigInt.fromString("250000000000000000")
const BOTH_CLAIMS_PAID = FIRST_CLAIM_PAID.plus(SECOND_CLAIM_PAID)
const COVERS_FIRST_CLAIM_ONLY = BigInt.fromString("1600000000000000000")

function seedTwoAeroPositions(): ProtocolPosition[] {
  seedService(ACCOUNT_D14, OPERATOR_SAFE, AGENT_INSTANCE)
  return [
    seedPosition(ACCOUNT_D14, PROTOCOL_AERO_CL, BigInt.fromI32(53640), USDC_NATIVE, DAI, AERO_CL_GAUGE, BigInt.fromI32(1), "0"),
    seedPosition(ACCOUNT_D14, PROTOCOL_AERO_CL, BigInt.fromI32(53641), USDC_NATIVE, DAI, AERO_CL_GAUGE, BigInt.fromI32(1), "0")
  ]
}

function twoAeroClaimsReceipt(): ethereum.TransactionReceipt {
  return newReceipt([
    newLog("0xbdeaea5205d16f34cb40038052d91235d87b4c54", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000001ae1793aa67bb8a234a39ed1071d43b785b001ce", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6"], "0x00000000000000000000000000000000000000000000000018493fba64ef0000", 10),
    newLog("0x9bf2a235f536d2889a5548c7be8b48d4f5783879", ["0x7b6bd720815adbeaaaed4fc759e1a535705901f33709fbb33e62ee9a89427bb1", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000000000000000000000000000000000000000d188", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6"], "0x00000000000000000000000000000000000000000000000014d1120d7b160000", 11),
    newLog("0x9bf2a235f536d2889a5548c7be8b48d4f5783879", ["0x7b6bd720815adbeaaaed4fc759e1a535705901f33709fbb33e62ee9a89427bb1", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000000000000000000000000000000000000000d189", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6"], "0x00000000000000000000000000000000000000000000000003782dace9d90000", 12)
  ])
}

const EMISSIONS_CLAIMED_TOPIC = "0x7b6bd720815adbeaaaed4fc759e1a535705901f33709fbb33e62ee9a89427bb1"
const AERO_CL_GAUGE_D14 = "0x9bf2a235f536d2889a5548c7be8b48d4f5783879"
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
    seedTokenPrice(XAERO, "xAERO", 18, "0.5")
  })
  afterEach(() => {
    clearStore()
  })

  test("EmissionsClaimed credits its tokenId once (0x7daa9dd3)", () => {
    seedService(ACCOUNT_D14, OPERATOR_SAFE, AGENT_INSTANCE)
    let p = seedPosition(ACCOUNT_D14, PROTOCOL_AERO_CL, BigInt.fromI32(53640), USDC_NATIVE, DAI, AERO_CL_GAUGE, BigInt.fromI32(1), "0")
    let receipt = newReceipt([
      newLog("0xba2b011b3de41274946e6ef93337b451fe47d727", ["0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c", "0x0000000000000000000000009bf2a235f536d2889a5548c7be8b48d4f5783879", "0x000000000000000000000000000000000000000000000000000000000000000f", "0x0000000000000000000000000000000000000000000000000000000000000010"], "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 96),
      newLog("0xba2b011b3de41274946e6ef93337b451fe47d727", ["0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0", "0x0000000000000000000000009bf2a235f536d2889a5548c7be8b48d4f5783879", "0x000000000000000000000000000000000000000000000000000000000000000f", "0x0000000000000000000000000000000000000000000000000000000000000010"], "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 97),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], "0x000000000000000000000000000000000000000000000000000000000000d188", 98),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01", "0x000000000000000000000000000000000000000000000000000000000000d188"], "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 99),
      newLog("0x382409fad8503fbcdbb27a4211551fa03e884078", ["0x2fc4875070bf2f61f7192e9e3710c8c8e3738c1a7ec632e3cbc591fc1242051a", "0x0000000000000000000000009bf2a235f536d2889a5548c7be8b48d4f5783879"], "0x000000000000000000000000000000000000000000000000012a06895c90f3a8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000035f6293966d130000000000000000000000000000000000000000000004cc1abd93c91984de99", 100),
      newLog("0x9bf2a235f536d2889a5548c7be8b48d4f5783879", ["0xd14a5bd00daa2f3d53854ba105be35afa78eb389d08398e4bdc0fb5620d02fce"], "0x000000000000000000000000000000000000000000000008e80041d3c53159dd0000000000000000000000000000000000000000000000000286c77d34190ee4", 101),
      newLog("0xbdeaea5205d16f34cb40038052d91235d87b4c54", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x0000000000000000000000001ae1793aa67bb8a234a39ed1071d43b785b001ce"], "0x00000000000000000000000000000000000000000000000002f976f660dba37f", 102),
      newLog("0xbdeaea5205d16f34cb40038052d91235d87b4c54", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000001ae1793aa67bb8a234a39ed1071d43b785b001ce", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6"], "0x00000000000000000000000000000000000000000000000002f976f660dba37f", 103),
      newLog("0x382409fad8503fbcdbb27a4211551fa03e884078", ["0x9acaadd0523552411c0e34a0160b98573211a163d69962b54a3786be27542f7a", "0x0000000000000000000000009bf2a235f536d2889a5548c7be8b48d4f5783879"], "0x000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000002f976f660dba37f", 104),
      newLog("0x9bf2a235f536d2889a5548c7be8b48d4f5783879", ["0x7b6bd720815adbeaaaed4fc759e1a535705901f33709fbb33e62ee9a89427bb1", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000000000000000000000000000000000000000d188", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6"], "0x00000000000000000000000000000000000000000000000002f976f660dba37f", 105),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x0000000000000000000000009bf2a235f536d2889a5548c7be8b48d4f5783879", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x000000000000000000000000000000000000000000000000000000000000d188"], "0x", 106),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000009bf2a235f536d2889a5548c7be8b48d4f5783879", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000000000000000000000000000000000000000d188"], "0x", 107),
      newLog("0x9bf2a235f536d2889a5548c7be8b48d4f5783879", ["0xac2f121be0a440c47693663f2118f4d3b12cf85696cbe2c7a1b4a35e68a827d2", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000000000000000000000000000000000000000d188"], "0x0000000000000000000000000000000000000000000000000000ae3cc8742daf", 108),
      newLog("0xbdeaea5205d16f34cb40038052d91235d87b4c54", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x0000000000000000000000001fb0330de87cc5321652a22c99f4fcfb1d8d5227"], "0x00000000000000000000000000000000000000000000000002f976f660dba37f", 109),
      newLog("0xba2b011b3de41274946e6ef93337b451fe47d727", ["0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c", "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b", "0x000000000000000000000000000000000000000000000000000000000000000f", "0x0000000000000000000000000000000000000000000000000000000000000010"], "0x0000000000000000000000000000000000000000000000000000ae3cc8742daf000000000000000000000000000000000000000000000000000000023a786d090000000000000000000000000000000000000000000000000000000000000000", 110),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], "0x000000000000000000000000000000000000000000000000000000000000d188", 111),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4", "0x000000000000000000000000000000000000000000000000000000000000d188"], "0x0000000000000000000000000000000000000000000000000000ae3cc8742daf000000000000000000000000000000000000000000000000000000023a786d090000000000000000000000000000000000000000000000000000000000000000", 112),
      newLog("0x0b2c639c533813f4aa9d7837caf62653d097ff85", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000ba2b011b3de41274946e6ef93337b451fe47d727", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6"], "0x000000000000000000000000000000000000000000000000000000023a786d09", 113),
      newLog("0xba2b011b3de41274946e6ef93337b451fe47d727", ["0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0", "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b", "0x000000000000000000000000000000000000000000000000000000000000000f", "0x0000000000000000000000000000000000000000000000000000000000000010"], "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6000000000000000000000000000000000000000000000000000000023a786d090000000000000000000000000000000000000000000000000000000000000000", 114),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], "0x000000000000000000000000000000000000000000000000000000000000d188", 115),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01", "0x000000000000000000000000000000000000000000000000000000000000d188"], "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6000000000000000000000000000000000000000000000000000000023a786d090000000000000000000000000000000000000000000000000000000000000000", 116),
      newLog("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000ba2b011b3de41274946e6ef93337b451fe47d727", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6"], "0x000000000000000000000000000000000000000000000000000000008309e4a8", 117),
      newLog("0x0b2c639c533813f4aa9d7837caf62653d097ff85", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000ba2b011b3de41274946e6ef93337b451fe47d727"], "0x0000000000000000000000000000000000000000000000000000000082e0f088", 118),
      newLog("0xba2b011b3de41274946e6ef93337b451fe47d727", ["0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6"], "0x0000000000000000000000000000000000000000000000000000000082e0f088ffffffffffffffffffffffffffffffffffffffffffffffffffffffff7cf61b5800000000000000000000000000000000000000010028156752d643aeee7167440000000000000000000000000000000000000000000000000000baf1438145af000000000000000000000000000000000000000000000000000000000000000c", 119),
      newLog("0x0b2c639c533813f4aa9d7837caf62653d097ff85", ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b"], "0x00000000000000000000000000000000000000000000000000000001b7985499", 120),
      newLog("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b"], "0x000000000000000000000000000000000000000000000000000000008309e4ac", 121),
      newLog("0x0b2c639c533813f4aa9d7837caf62653d097ff85", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000ba2b011b3de41274946e6ef93337b451fe47d727"], "0x00000000000000000000000000000000000000000000000000000001b7985490", 122),
      newLog("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000ba2b011b3de41274946e6ef93337b451fe47d727"], "0x000000000000000000000000000000000000000000000000000000008309e4ac", 123),
      newLog("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b"], "0x0000000000000000000000000000000000000000000000000000000000000000", 124),
      newLog("0xba2b011b3de41274946e6ef93337b451fe47d727", ["0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde", "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b", "0x000000000000000000000000000000000000000000000000000000000000000c", "0x000000000000000000000000000000000000000000000000000000000000000d"], "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b0000000000000000000000000000000000000000000000000000ae3674703cdc00000000000000000000000000000000000000000000000000000001b7985490000000000000000000000000000000000000000000000000000000008309e4ac", 125),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], "0x0000000000000000000000000000000000000000000000000000000000005d51", 126),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x0f8712c47eb813e705bf827a60bdd551e6f2e055b4a1c2004304d52208a5a513", "0x0000000000000000000000000000000000000000000000000000000000005d51"], "0x0000000000000000000000000000000000000000000000000000ae3674703cdc00000000000000000000000000000000000000000000000000000001b7985490000000000000000000000000000000000000000000000000000000008309e4ac000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000d", 127),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x0000000000000000000000009bf2a235f536d2889a5548c7be8b48d4f5783879", "0x0000000000000000000000000000000000000000000000000000000000005d51"], "0x", 128),
      newLog("0xba2b011b3de41274946e6ef93337b451fe47d727", ["0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c", "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b", "0x000000000000000000000000000000000000000000000000000000000000000c", "0x000000000000000000000000000000000000000000000000000000000000000d"], "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 129),
      newLog("0xba2b011b3de41274946e6ef93337b451fe47d727", ["0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0", "0x0000000000000000000000004857db576ee0e45f10525ec59527bfd10beec60b", "0x000000000000000000000000000000000000000000000000000000000000000c", "0x000000000000000000000000000000000000000000000000000000000000000d"], "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 130),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"], "0x0000000000000000000000000000000000000000000000000000000000005d51", 131),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01", "0x0000000000000000000000000000000000000000000000000000000000005d51"], "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 132),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000000000000000000000005d51"], "0x", 133),
      newLog("0x4857db576ee0e45f10525ec59527bfd10beec60b", ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x0000000000000000000000009bf2a235f536d2889a5548c7be8b48d4f5783879", "0x0000000000000000000000000000000000000000000000000000000000005d51"], "0x", 134),
      newLog("0x9bf2a235f536d2889a5548c7be8b48d4f5783879", ["0xc9817c7b5bf7b2417ea338292b8681857834d37427fbb1899f98e6897f3fe426", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x000000000000000000000000c5e3818458167662fe741e3f930a05a41f952af6", "0x0000000000000000000000000000000000000000000000000000000000005d51"], "0x0000000000000000000000000000000000000000000000000000ae3674703cdc", 135),
    ])
    let event = newTransfer(XAERO, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, XAERO_PAID, 103, receipt)

    assert.assertTrue(attributeRewardTransfer(event, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, XAERO_PAID))
    assert.assertTrue(!attributeRewardTransfer(event, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, XAERO_PAID))

    positionField(p, "claimedRewards", "0.214333257835848575")
  })

  test("one claimEmissions over two tokenIds credits each its own amount", () => {
    let positions = seedTwoAeroPositions()
    let event = newTransfer(XAERO, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, BOTH_CLAIMS_PAID, 10, twoAeroClaimsReceipt())

    assert.assertTrue(attributeRewardTransfer(event, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, BOTH_CLAIMS_PAID))
    assert.assertTrue(!attributeRewardTransfer(event, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, BOTH_CLAIMS_PAID))

    positionField(positions[0], "claimedRewards", "1.5")
    positionField(positions[1], "claimedRewards", "0.25")
  })

  test("only claims paid to the Safe, for its own tokenIds, are credited", () => {
    seedService(ACCOUNT_D14, OPERATOR_SAFE, AGENT_INSTANCE)
    seedService(OTHER, OPERATOR_SAFE, AGENT_INSTANCE)
    let mine = seedPosition(ACCOUNT_D14, PROTOCOL_AERO_CL, BigInt.fromI32(53640), USDC_NATIVE, DAI, AERO_CL_GAUGE, BigInt.fromI32(1), "0")
    let theirs = seedPosition(OTHER, PROTOCOL_AERO_CL, BigInt.fromI32(53641), USDC_NATIVE, DAI, AERO_CL_GAUGE, BigInt.fromI32(1), "0")
    // 1 to another recipient, 0.5 for another Safe's tokenId, 0.25 to the Safe for its own; one Transfer covers all
    let receipt = newReceipt([
      emissionsClaimed(53640, OTHER, ONE_REWARD, 11),
      emissionsClaimed(53641, ACCOUNT_D14, HALF_REWARD, 12),
      emissionsClaimed(53640, ACCOUNT_D14, QUARTER_REWARD, 13)
    ])
    let paid = BigInt.fromString("1750000000000000000")
    let event = newTransfer(XAERO, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, paid, 14, receipt)

    assert.assertTrue(attributeRewardTransfer(event, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, paid))

    positionField(mine, "claimedRewards", "0.25")
    positionField(mine, "claimedRewardsUSD", "0.125")
    positionField(theirs, "claimedRewards", "0")
  })

  test("an EmissionsClaimed not emitted by the position's gauge is not credited", () => {
    seedService(ACCOUNT_D14, OPERATOR_SAFE, AGENT_INSTANCE)
    let mine = seedPosition(ACCOUNT_D14, PROTOCOL_AERO_CL, BigInt.fromI32(53640), USDC_NATIVE, DAI, AERO_CL_GAUGE, BigInt.fromI32(1), "0")
    let receipt = newReceipt([
      newLog(OTHER.toHexString(), [
        EMISSIONS_CLAIMED_TOPIC,
        word32(ACCOUNT_D14.toHexString()),
        word32((53640 as i32).toString(16)),
        word32(ACCOUNT_D14.toHexString())
      ], QUARTER_REWARD, 11)
    ])
    let paid = BigInt.fromString("250000000000000000")
    let event = newTransfer(XAERO, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, paid, 12, receipt)

    attributeRewardTransfer(event, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, paid)

    positionField(mine, "claimedRewards", "0")
  })

  test("a Transfer pays only the claims its amount covers, in log order", () => {
    let positions = seedTwoAeroPositions()
    let event = newTransfer(XAERO, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, COVERS_FIRST_CLAIM_ONLY, 10, twoAeroClaimsReceipt())

    assert.assertTrue(attributeRewardTransfer(event, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, COVERS_FIRST_CLAIM_ONLY))

    positionField(positions[0], "claimedRewards", "1.5")
    positionField(positions[1], "claimedRewards", "0")
  })

  test("a claim the Transfer cannot cover is skipped and later ones are still credited", () => {
    let positions = seedTwoAeroPositions()
    let event = newTransfer(XAERO, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, SECOND_CLAIM_PAID, 10, twoAeroClaimsReceipt())

    assert.assertTrue(attributeRewardTransfer(event, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, SECOND_CLAIM_PAID))

    positionField(positions[0], "claimedRewards", "0")
    positionField(positions[1], "claimedRewards", "0.25")
  })

  test("a Transfer of another token does not take the claims", () => {
    let positions = seedTwoAeroPositions()
    seedTokenPrice(DAI, "DAI", 18, "1")
    let receipt = twoAeroClaimsReceipt()
    let other = newTransfer(DAI, OTHER, ACCOUNT_D14, BOTH_CLAIMS_PAID, 9, receipt)

    assert.assertTrue(!attributeRewardTransfer(other, OTHER, ACCOUNT_D14, BOTH_CLAIMS_PAID))
    positionField(positions[0], "claimedRewards", "0")

    let reward = newTransfer(XAERO, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, BOTH_CLAIMS_PAID, 10, receipt)
    assert.assertTrue(attributeRewardTransfer(reward, LEAF_EMISSIONS_HANDLER, ACCOUNT_D14, BOTH_CLAIMS_PAID))
    positionField(positions[0], "claimedRewards", "1.5")
    positionField(positions[1], "claimedRewards", "0.25")
  })
})

const BALANCER_POOL = Address.fromString("0x00000000000000000000000000000000000000b1")
const BALANCER_POOL_ID = Bytes.fromHexString("0x00000000000000000000000000000000000000b1000200000000000000000001")

function mockBalancerPool(pool: Address): void {
  createMockedFunction(pool, "getSwapFeePercentage", "getSwapFeePercentage():(uint256)").withArgs([]).reverts()
  // No BPT left: the refresh closes the position without reading the vault
  createMockedFunction(pool, "balanceOf", "balanceOf(address):(uint256)")
    .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
    .returns([ethereum.Value.fromUnsignedBigInt(BigInt.zero())])
}

function balancerBlock(): ethereum.Block {
  let block = newMockEvent().block
  block.number = BLOCK_NUMBER
  block.timestamp = BLOCK_TIMESTAMP
  return block
}

describe("Balancer positions start with zero income", () => {
  beforeEach(() => {
    mockEthUsd()
    seedTokenPrice(USDC_NATIVE, "USDC", 6, "1")
    seedTokenPrice(DAI, "DAI", 18, "1")
    seedService(SERVICE_SAFE, OPERATOR_SAFE, AGENT_INSTANCE)
  })
  afterEach(() => {
    clearStore()
  })

  test("a position created by a join has its fee and reward fields set", () => {
    mockBalancerPool(BALANCER_POOL)
    refreshBalancerPositionWithEventAmounts(SERVICE_SAFE, BALANCER_POOL, BALANCER_POOL_ID, [USDC_NATIVE, DAI], [USDC_50, DAI_50], balancerBlock(), Bytes.fromI32(1))

    let id = getBalancerPositionId(SERVICE_SAFE, BALANCER_POOL)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "collectedFeesUSD", "0")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimedRewardsUSD", "0")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "usdCurrentWithRewards", "0")
  })

  test("a position created by a refresh has its fee and reward fields set", () => {
    mockBalancerPool(BALANCER_POOL)
    refreshBalancerPosition(SERVICE_SAFE, BALANCER_POOL, BALANCER_POOL_ID, balancerBlock(), Bytes.fromI32(1), false)

    let id = getBalancerPositionId(SERVICE_SAFE, BALANCER_POOL)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "collectedFeesUSD", "0")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "claimedRewardsUSD", "0")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "usdCurrentWithRewards", "0")
  })

  test("a position a refresh creates while the pool holds its BPT is saved with every required field", () => {
    createMockedFunction(BALANCER_POOL, "balanceOf", "balanceOf(address):(uint256)")
      .withArgs([ethereum.Value.fromAddress(SERVICE_SAFE)])
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000000000000"))])
    // The vault read fails, so the position keeps what its create branch set
    createMockedFunction(BALANCER_VAULT, "getPoolTokens", "getPoolTokens(bytes32):(address[],uint256[],uint256)")
      .withArgs([ethereum.Value.fromFixedBytes(BALANCER_POOL_ID)])
      .reverts()
    refreshBalancerPosition(SERVICE_SAFE, BALANCER_POOL, BALANCER_POOL_ID, balancerBlock(), Bytes.fromI32(1), false)

    let id = getBalancerPositionId(SERVICE_SAFE, BALANCER_POOL)
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "isActive", "true")
    assert.fieldEquals("ProtocolPosition", id.toHexString(), "usdCurrentWithRewards", "0")
  })
})
