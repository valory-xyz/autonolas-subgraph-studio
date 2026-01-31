import {
  QuestionInitialized as OOQuestionInitialized,
  QuestionResolved as OOQuestionResolvedEvent,
} from "../generated/OptimisticOracleV3/OptimisticOracleV3";
import {
  QuestionInitialized as UmaQuestionInitialized,
  QuestionResolved as UmaQuestionResolvedEvent,
} from "../generated/UmaCtfAdapter/UmaCtfAdapter";
import {
  MarketMetadata,
  Question,
  QuestionIdToConditionId,
} from "../generated/schema";
import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { processMarketResolution } from "./utils";

/**
 * Extracts the title from UMA ancillaryData string.
 * Example input: "q: title: Will BTC hit 100k?, res_data: ..."
 */
export function extractTitle(rawData: string): string {
  // We look for all possible start keys
  const keys = ["question: ", "q: ", "title: "];
  let currentString = rawData;

  // 1. Strip all prefix keys (handles "q: title: ..." or "q: ...")
  let found = true;
  
  while (found) {
    found = false;
    for (let i = 0; i < keys.length; i++) {
      if (currentString.startsWith(keys[i])) {
        currentString = currentString.substring(keys[i].length).trim();
        found = true;
        break;
      }
    }
  }
  
  // If we didn't strip anything, but "title: " or "question: " exists elsewhere
  if (currentString == rawData) {
     for (let i = 0; i < keys.length; i++) {
        let idx = rawData.indexOf(keys[i]);
        if (idx != -1) {
          // Move past the key and recurse or loop to catch nested keys
          return extractTitle(rawData.substring(idx + keys[i].length));
        }
     }
  }

  // Now determine the end of the title based on the stripped string
  const delimiters = [", description:", ", outcomes:", ", res_data:", ", start:", ", id:", ", initializer:"];
  let end = -1;

  for (let i = 0; i < delimiters.length; i++) {
    let dIdx = currentString.indexOf(delimiters[i]);
    if (dIdx != -1 && (end == -1 || dIdx < end)) {
      end = dIdx;
    }
  }

  // Generic field pattern fallback ", <word>:"
  if (end == -1) {
    for (let i = 0; i < currentString.length - 2; i++) {
      if (currentString.charAt(i) == "," && currentString.charAt(i + 1) == " ") {
        let colonIdx = currentString.indexOf(":", i + 2);
        if (colonIdx != -1 && colonIdx < i + 20) {
          end = i;
          break;
        }
      }
    }
  }

  let finalTitle = end == -1 ? currentString : currentString.substring(0, end);
  return finalTitle.trim();
}

/**
 * Helper to verify the outcome pair is strictly binary Yes/No
 */
function isYesNoPair(out1: string, out2: string): boolean {
  let val1 = out1.toLowerCase();
  let val2 = out2.toLowerCase();

  return (val1 == "yes" && val2 == "no") || (val1 == "no" && val2 == "yes");
}

/**
 * Extracts the outcomes array.
 * Example input: "... outcomes: [Yes, No]" or
 * res_data: p1: 0, p2: 1, p3: 0.5. Outcome Mapping: Where p1 corresponds to Team WE, p2 to EDward Gaming, p3 to unknown/50-50
 */
export function extractBinaryOutcomes(rawData: string): string[] {
  // 1. Try to find explicit mappings (p1: No, p2: Yes, etc.)
  let p1Key = "p1 corresponds to ";
  let p2Key = "p2 to ";
  let p1Idx = rawData.indexOf(p1Key);
  let p2Idx = rawData.indexOf(p2Key);

  if (p1Idx != -1 && p2Idx != -1) {
    let p1Start = p1Idx + p1Key.length;
    let p1End = rawData.indexOf(",", p1Start);
    let p2Start = p2Idx + p2Key.length;
    let p2End = rawData.indexOf(",", p2Start);
    if (p2End == -1) p2End = rawData.indexOf(".", p2Start);
    if (p2End == -1) p2End = rawData.length;

    let out1 = rawData.substring(p1Start, p1End != -1 ? p1End : rawData.length).trim();
    let out2 = rawData.substring(p2Start, p2End != -1 ? p2End : rawData.length).trim();
    
    // If we found outcomes but they AREN'T Yes/No, we reject the market.
    if (isYesNoPair(out1, out2)) {
      return [out1, out2];
    } else {
      return []; // Reject categorical markets
    }
  }

  // 2. Try the "outcomes: [Yes, No]" pattern
  let outcomesKey = "outcomes: [";
  let oStart = rawData.indexOf(outcomesKey);
  if (oStart != -1) {
    let oEnd = rawData.indexOf("]", oStart);
    if (oEnd != -1) {
      let list = rawData.substring(oStart + outcomesKey.length, oEnd).split(",");
      if (list.length == 2) {
        let out1 = list[0].trim();
        let out2 = list[1].trim();
        if (isYesNoPair(out1, out2)) {
          return [out1, out2];
        }
      }
    }
    // If outcomes tag exists but isn't Yes/No, reject.
    return [];
  }

  // 3. Fallback for binary markets that don't have outcomes defined
  return ["Yes", "No"];
}

export function handleQuestionInitialization(
  questionID: Bytes,
  ancillaryData: Bytes,
  event: ethereum.Event,
): void {
  let rawData = ancillaryData.toString();
  let outcomes = extractBinaryOutcomes(rawData);

  // 1. Check if it's a Yes/No market
  if (outcomes.length == 0) return;

  // 2. Find the ConditionID using our bridge
  let bridge = QuestionIdToConditionId.load(questionID);
  if (bridge == null) return;

  // 3. Create the MarketMetadata
  let metadata = new MarketMetadata(questionID);
  metadata.title = extractTitle(rawData);
  metadata.outcomes = outcomes;
  metadata.rawAncillaryData = rawData;
  metadata.save();

  // 4. Create the Question using ConditionID as the ID
  let question = new Question(bridge.conditionId);
  question.questionId = questionID;
  question.metadata = metadata.id;
  question.isNegRisk = false;
  question.blockNumber = event.block.number;
  question.blockTimestamp = event.block.timestamp;
  question.transactionHash = event.transaction.hash;
  question.save();
}

export function handleQuestionResolution(
  questionID: Bytes,
  settledPrice: BigInt,
  payouts: BigInt[],
  event: ethereum.Event,
): void {
  let bridge = QuestionIdToConditionId.load(questionID);
  if (bridge == null) return;

  let winningOutcome = BigInt.fromI32(-1);
  if (payouts.length >= 2) {
    let p0 = payouts[0];
    let p1 = payouts[1];
    if (p1 > p0) winningOutcome = BigInt.fromI32(1);
    else if (p0 > p1) winningOutcome = BigInt.fromI32(0);
  }

  processMarketResolution(
    bridge.conditionId,
    winningOutcome,
    settledPrice,
    payouts,
    event,
  );
}

// For OptimisticOracleV3
export function handleOOQuestionInitialized(
  event: OOQuestionInitialized,
): void {
  handleQuestionInitialization(
    event.params.questionID,
    event.params.ancillaryData,
    event,
  );
}

export function handleOOQuestionResolved(event: OOQuestionResolvedEvent): void {
  handleQuestionResolution(
    event.params.questionID,
    event.params.settledPrice,
    event.params.payouts,
    event,
  );
}

// For UmaCtfAdapter
export function handleUmaQuestionInitialized(
  event: UmaQuestionInitialized,
): void {
  handleQuestionInitialization(
    event.params.questionID,
    event.params.ancillaryData,
    event,
  );
}

export function handleUmaQuestionResolved(
  event: UmaQuestionResolvedEvent,
): void {
  handleQuestionResolution(
    event.params.questionID,
    event.params.settledPrice,
    event.params.payouts,
    event,
  );
}
