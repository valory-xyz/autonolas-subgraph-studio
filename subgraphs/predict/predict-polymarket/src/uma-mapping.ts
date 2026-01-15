import { QuestionInitialized } from "../generated/OptimisticOracleV3/OptimisticOracleV3"
import { MarketMetadata } from "../generated/schema"

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

  if (p1Idx != -1 && p2Idx != -1) {
    let p1Start = p1Idx + p1Key.length;
    let p1End = rawData.indexOf(",", p1Start);
    
    let p2Start = p2Idx + p2Key.length;
    let p2End = rawData.indexOf(",", p2Start);
    if (p2End == -1) p2End = rawData.indexOf(".", p2Start);

    if (p1End != -1 && p2Start != -1) {
      let out1 = rawData.substring(p1Start, p1End).trim();
      let out2 = rawData.substring(p2Start, p2End != -1 ? p2End : rawData.length).trim();

      return [out1, out2];
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
        
        return [out1, out2];
      }
    }
  }

  return []; 
}

export function handleQuestionInitialized(event: QuestionInitialized): void {
  let metadata = new MarketMetadata(event.params.questionID)
  
  // The ancillaryData is a hex string of the UTF-8 text
  // format: "q: title: Will BTC hit 100k?, res_data: p1: 0, p2: 1, outcomes: [Yes, No]"
  let rawData = event.params.ancillaryData.toString() 
  
  metadata.title = extractTitle(rawData)
  metadata.outcomes = extractBinaryOutcomes(rawData)
  metadata.save()
}