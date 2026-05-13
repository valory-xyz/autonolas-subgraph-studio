import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { createMockedFunction } from "matchstick-as/assembly/index";
import { QuestionIdToConditionId } from "../generated/schema";

// Default contract address used by matchstick's newMockEvent() — handlers bind
// the ConditionalTokens contract to event.address, so mocks must target this.
export const DEFAULT_MOCK_CONTRACT = Address.fromString(
  "0xa16081f360e3847006db660bae1c6d1b2e17ec2a",
);

export const USDC_E = Address.fromString(
  "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
);
export const NEG_RISK_ADAPTER = Address.fromString(
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
);
const ZERO_BYTES32 = Bytes.fromHexString(
  "0x0000000000000000000000000000000000000000000000000000000000000000",
);

/**
 * Mock the ConditionalTokens.getCollectionId + getPositionId eth_calls that
 * handleConditionPreparation makes to derive outcome tokenIds for v2 markets.
 *
 * Returns the 32-byte `tokenIdBytes` values that the handler will use as the
 * TokenRegistry entity IDs (outcome 0 at index 0, outcome 1 at index 1). These
 * are the Bytes.fromBigInt round-trip of the mocked positionId values; tests
 * should use them directly for `assert.fieldEquals("TokenRegistry", ..)`.
 */
export function mockConditionalTokensCalls(
  conditionId: Bytes,
  collateral: Address,
): Bytes[] {
  // Derive distinct-per-condition bytes32 values for collectionIds so repeated
  // calls across conditions don't collide in the mock registry. Highest byte
  // kept at 0x11..0xdd (top bit unset) so fromBigInt round-trips cleanly to
  // 32 bytes without an unsigned-padding byte.
  let mockCollection1 = Bytes.fromHexString(
    "0x01" + conditionId.toHexString().slice(4),
  ) as Bytes;
  let mockCollection2 = Bytes.fromHexString(
    "0x02" + conditionId.toHexString().slice(4),
  ) as Bytes;
  let mockTokenId1 = BigInt.fromUnsignedBytes(mockCollection1);
  let mockTokenId2 = BigInt.fromUnsignedBytes(mockCollection2);

  createMockedFunction(
    DEFAULT_MOCK_CONTRACT,
    "getCollectionId",
    "getCollectionId(bytes32,bytes32,uint256):(bytes32)",
  )
    .withArgs([
      ethereum.Value.fromFixedBytes(ZERO_BYTES32 as Bytes),
      ethereum.Value.fromFixedBytes(conditionId),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
    ])
    .returns([ethereum.Value.fromFixedBytes(mockCollection1)]);

  createMockedFunction(
    DEFAULT_MOCK_CONTRACT,
    "getCollectionId",
    "getCollectionId(bytes32,bytes32,uint256):(bytes32)",
  )
    .withArgs([
      ethereum.Value.fromFixedBytes(ZERO_BYTES32 as Bytes),
      ethereum.Value.fromFixedBytes(conditionId),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2)),
    ])
    .returns([ethereum.Value.fromFixedBytes(mockCollection2)]);

  createMockedFunction(
    DEFAULT_MOCK_CONTRACT,
    "getPositionId",
    "getPositionId(address,bytes32):(uint256)",
  )
    .withArgs([
      ethereum.Value.fromAddress(collateral),
      ethereum.Value.fromFixedBytes(mockCollection1),
    ])
    .returns([ethereum.Value.fromUnsignedBigInt(mockTokenId1)]);

  createMockedFunction(
    DEFAULT_MOCK_CONTRACT,
    "getPositionId",
    "getPositionId(address,bytes32):(uint256)",
  )
    .withArgs([
      ethereum.Value.fromAddress(collateral),
      ethereum.Value.fromFixedBytes(mockCollection2),
    ])
    .returns([ethereum.Value.fromUnsignedBigInt(mockTokenId2)]);

  // Stored TokenRegistry ID = Bytes.fromByteArray(Bytes.fromBigInt(positionId)).
  // After the Matchstick BigInt round-trip the unsigned-padding byte is dropped,
  // so the stored 32-byte ID equals the mockCollection bytes (same LE layout).
  return [mockCollection1, mockCollection2];
}

/**
 * Common test addresses for consistency across tests
 */
export namespace TestAddresses {
  export const TRADER_AGENT_1 = Address.fromString("0x1234567890123456789012345678901234567890");
  export const TRADER_AGENT_2 = Address.fromString("0x2234567890123456789012345678901234567890");
  export const MULTISIG_1 = Address.fromString("0x3234567890123456789012345678901234567890");
  export const MULTISIG_2 = Address.fromString("0x4234567890123456789012345678901234567890");
  export const ORACLE = Address.fromString("0x5234567890123456789012345678901234567890");
  export const OPERATOR = Address.fromString("0x6234567890123456789012345678901234567890");
  export const REQUESTER = Address.fromString("0x7234567890123456789012345678901234567890");
  export const CURRENCY = Address.fromString("0x8234567890123456789012345678901234567890");
  export const COLLATERAL_TOKEN = Address.fromString("0x9234567890123456789012345678901234567890");
}

/**
 * Common test bytes for consistency across tests
 */
export namespace TestBytes {
  export const QUESTION_ID_1 = Bytes.fromHexString("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  export const QUESTION_ID_2 = Bytes.fromHexString("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  export const CONDITION_ID_1 = Bytes.fromHexString("0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
  export const CONDITION_ID_2 = Bytes.fromHexString("0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");
  export const ANSWER_0 = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");
  export const ANSWER_1 = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001");
  export const DUMMY_HASH = Bytes.fromHexString("0x1234567890123456789012345678901234567890123456789012345678901234");
}

/**
 * Common test BigInts for consistency
 */
export namespace TestConstants {
  export const SERVICE_ID_1 = BigInt.fromI32(100);
  export const SERVICE_ID_2 = BigInt.fromI32(200);
  export const TIMESTAMP_START = BigInt.fromI32(1710000000);
  export const TIMESTAMP_DAY_1 = BigInt.fromI32(1710000000);
  export const TIMESTAMP_DAY_2 = BigInt.fromI32(1710086400);
  export const TIMESTAMP_DAY_3 = BigInt.fromI32(1710172800);
  export const ONE_DAY = BigInt.fromI32(86400);
  export const BLOCK_NUMBER_START = BigInt.fromI32(1000);
}

/**
 * Helper to create ancillary data bytes from a readable format
 */
export function createAncillaryData(
  title: string,
  outcomes: string[] | null = null,
  includeDescription: bool = false,
  description: string = "Test description"
): Bytes {
  let data = "q: title: " + title;

  if (includeDescription) {
    data += ", description: " + description;
  }

  if (outcomes !== null && outcomes.length == 2) {
    data += ", res_data: p1: 0, p2: 1, p3: 0.5. Where p1 corresponds to " + outcomes[0] + ", p2 to " + outcomes[1] + ", p3 to unknown/50-50";
  }

  return Bytes.fromUTF8(data);
}

/**
 * Helper to normalize timestamp to start of day (UTC)
 * Matches the logic used in production code
 */
export function normalizeTimestamp(timestamp: BigInt): BigInt {
  const ONE_DAY = BigInt.fromI32(86400);
  return timestamp.div(ONE_DAY).times(ONE_DAY);
}

/**
 * Helper to create a daily ID for DailyProfitStatistic entities
 */
export function createDailyId(agentAddress: Address, timestamp: BigInt): string {
  let normalizedTs = normalizeTimestamp(timestamp);
  return agentAddress.toHexString() + "_" + normalizedTs.toString();
}

/**
 * Helper to create a bridge between questionId and conditionId
 */
export function createBridge(questionId: Bytes, conditionId: Bytes): void {
  let bridge = new QuestionIdToConditionId(questionId);
  bridge.conditionId = conditionId;
  bridge.oracle = TestAddresses.ORACLE;
  bridge.transactionHash = TestBytes.DUMMY_HASH;
  bridge.save();
}
