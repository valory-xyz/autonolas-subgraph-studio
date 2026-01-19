import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";

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
