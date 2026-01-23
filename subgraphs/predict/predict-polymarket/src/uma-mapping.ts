import {
  QuestionInitialized,
  QuestionResolved as QuestionResolvedEvent
} from "../generated/OptimisticOracleV3/OptimisticOracleV3"
import {
  MarketMetadata,
  Question,
  QuestionIdToConditionId,
  QuestionResolution,
  TraderAgent,
  MarketParticipant,
  DailyProfitStatistic
} from "../generated/schema"
import { BigInt, log } from "@graphprotocol/graph-ts"
import { getGlobal, saveMapValues, getDailyProfitStatistic, addProfitParticipant, getDayTimestamp } from "./utils"

/**
 * Extracts the title from UMA ancillaryData string.
 * Example input: "q: title: Will BTC hit 100k?, res_data: ..."
 */
export function extractTitle(rawData: string): string {
  const titleKey = "title: ";
  const start = rawData.indexOf(titleKey);
  if (start == -1) return "Unknown Market";

  const titleStart = start + titleKey.length;

  // Look for the next field delimiter to find the end of the title
  // Try specific known field separators first
  let end = rawData.indexOf(", description:", titleStart);
  if (end == -1) end = rawData.indexOf(", outcomes:", titleStart);
  if (end == -1) end = rawData.indexOf(", res_data:", titleStart);

  // If no specific delimiter found, look for generic pattern ", <word>:"
  // This handles cases like ", p1 corresponds", ", other_field:", etc.
  if (end == -1) {
    // Search for comma followed by space and word with colon (field pattern)
    for (let i = titleStart; i < rawData.length - 2; i++) {
      if (rawData.charAt(i) == ',' && rawData.charAt(i + 1) == ' ') {
        // Check if this looks like a field delimiter (has letters followed by colon or space)
        let nextChar = rawData.charAt(i + 2);
        if (nextChar >= 'a' && nextChar <= 'z' || nextChar >= 'A' && nextChar <= 'Z') {
          end = i;
          break;
        }
      }
    }
  }

  if (end == -1) {
    return rawData.substring(titleStart).trim();
  }

  return rawData.substring(titleStart, end).trim();
}

/**
 * Helper to verify the outcome pair is strictly binary Yes/No
 */
function isYesNoPair(out1: string, out2: string): boolean {
  let val1 = out1.toLowerCase();
  let val2 = out2.toLowerCase();

  return (
    (val1 == "yes" && val2 == "no") || 
    (val1 == "no" && val2 == "yes")
  );
}

/**
 * Extracts the outcomes array.
 * Example input: "... outcomes: [Yes, No]" or
 * res_data: p1: 0, p2: 1, p3: 0.5. Outcome Mapping: Where p1 corresponds to Team WE, p2 to EDward Gaming, p3 to unknown/50-50
 */
export function extractBinaryOutcomes(rawData: string): string[] {
  // 1. Find the mapping section which is standard in Polymarket/UMA metadata
  // Look for the "p1 corresponds to" part
  let p1Key = "p1 corresponds to ";
  let p2Key = "p2 to ";
  
  let p1Idx = rawData.indexOf(p1Key);
  let p2Idx = rawData.indexOf(p2Key);

  let res: string[] = [];

  if (p1Idx != -1 && p2Idx != -1) {
    let p1Start = p1Idx + p1Key.length;
    let p1End = rawData.indexOf(",", p1Start);
    
    let p2Start = p2Idx + p2Key.length;
    let p2End = rawData.indexOf(",", p2Start);
    if (p2End == -1) p2End = rawData.indexOf(".", p2Start);

    if (p1End != -1 && p2Start != -1) {
      let out1 = rawData.substring(p1Start, p1End).trim();
      let out2 = rawData.substring(p2Start, p2End != -1 ? p2End : rawData.length).trim();

      res = [out1, out2];
    }
  }

  // 2. Updated check for "outcomes: [..]" tag
  let outcomesKey = "outcomes: [";
  let oStart = rawData.indexOf(outcomesKey);
  
  if (oStart != -1) {
    let oEnd = rawData.indexOf("]", oStart);
    if (oEnd != -1) {
      let outcomesStr = rawData.substring(oStart + outcomesKey.length, oEnd);
      let list = outcomesStr.split(",");
      
      if (list.length == 2) {
        let out1 = list[0].trim();
        let out2 = list[1].trim();
        
        res = [out1, out2];
      }
    }
  }

  if (res.length === 2 && isYesNoPair(res[0], res[1])) 
    return res;

  return []; 
}

export function handleQuestionInitialized(event: QuestionInitialized): void {
  let rawData = event.params.ancillaryData.toString();
  let outcomes = extractBinaryOutcomes(rawData);

  // 1. Check if it's a Yes/No market
  if (outcomes.length == 0) {
    // Optional: Delete the bridge here if you want to be 100% clean,
    // but leaving a 32-byte string is very cheap.
    return;
  }

  // 2. Find the ConditionID using our bridge
  let bridge = QuestionIdToConditionId.load(event.params.questionID);
  if (bridge == null) return;

  // 3. Create the MarketMetadata
  let metadata = new MarketMetadata(event.params.questionID);
  metadata.title = extractTitle(rawData);
  metadata.outcomes = outcomes;
  metadata.rawAncillaryData = rawData;
  metadata.save();

  // 4. Create the Question using ConditionID as the ID
  let question = new Question(bridge.conditionId);
  question.questionId = event.params.questionID;
  question.metadata = metadata.id;
  question.blockNumber = event.block.number;
  question.blockTimestamp = event.block.timestamp;
  question.transactionHash = event.transaction.hash;
  question.save();
}

export function handleQuestionResolved(event: QuestionResolvedEvent): void {
  let bridge = QuestionIdToConditionId.load(event.params.questionID);
  if (bridge == null) return;

  // 1. Create the Resolution entity (Linking to the immutable Question)
  let resolution = new QuestionResolution(bridge.conditionId);
  resolution.question = bridge.conditionId;
  resolution.settledPrice = event.params.settledPrice;
  resolution.payouts = event.params.payouts;
  resolution.blockNumber = event.block.number;
  resolution.timestamp = event.block.timestamp;

  // 2. Winner Detection
  let winningOutcome = BigInt.fromI32(-1); // Default for Invalid

  if (event.params.payouts.length >= 2) {
    let p0 = event.params.payouts[0];
    let p1 = event.params.payouts[1];

    if (p1 > p0) {
      winningOutcome = BigInt.fromI32(1); // YES won
    } else if (p0 > p1) {
      winningOutcome = BigInt.fromI32(0); // NO won
    }
  }
  resolution.winningIndex = winningOutcome;
  resolution.save();

  // 3. Process Totals using Caching
  let global = getGlobal();
  let agentCache = new Map<string, TraderAgent>();
  let participantCache = new Map<string, MarketParticipant>();
  let dailyStatsCache = new Map<string, DailyProfitStatistic>();

  // Load the question to get the bets
  let question = Question.load(bridge.conditionId);
  if (question == null) return;

  let bets = question.bets.load();
  for (let i = 0; i < bets.length; i++) {
    let bet = bets[i];
    let agentId = bet.bettor.toHexString();

    let agent = agentCache.has(agentId)
      ? agentCache.get(agentId)!
      : TraderAgent.load(bet.bettor);

    if (agent !== null) {
      // Only settle losses for markets that have a clear winner (0 or 1).
      // If winningOutcome is -1 (Invalid), we skip this block and wait for Payout.
      if (winningOutcome.ge(BigInt.zero()) && !bet.outcomeIndex.equals(winningOutcome)) {

        // Update Settlement Totals (only for losing bets)
        if (!bet.countedInTotal) {
          agent.totalTradedSettled = agent.totalTradedSettled.plus(bet.amount);
          global.totalTradedSettled = global.totalTradedSettled.plus(bet.amount);

          // Update Participant
          let participantId = agentId + "_" + bridge.conditionId.toHexString();
          let participant = participantCache.has(participantId)
            ? participantCache.get(participantId)
            : MarketParticipant.load(participantId);

          if (participant != null) {
            participant.totalTradedSettled = participant.totalTradedSettled.plus(bet.amount);
            participantCache.set(participantId, participant);
          }
          bet.countedInTotal = true;
        }

        // Update Profit Statistics
        if (!bet.countedInProfit) {
          // Get daily statistic for settlement day
          let statId = agentId + "_" + getDayTimestamp(event.block.timestamp).toString();
          let dailyStat = dailyStatsCache.has(statId)
            ? dailyStatsCache.get(statId)!
            : getDailyProfitStatistic(bet.bettor, event.block.timestamp);

          // Record loss
          dailyStat.dailyProfit = dailyStat.dailyProfit.minus(bet.amount);
          // Track which market caused the loss
          addProfitParticipant(dailyStat, bridge.conditionId);

          dailyStatsCache.set(statId, dailyStat);
          bet.countedInProfit = true;
        }

        agentCache.set(agentId, agent);
        bet.save();
      }
    }
  }

  // 4. Finalizing cached data
  saveMapValues(agentCache);
  saveMapValues(participantCache);
  saveMapValues(dailyStatsCache);
  global.save();
}