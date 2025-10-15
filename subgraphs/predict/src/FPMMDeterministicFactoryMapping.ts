import { FixedProductMarketMakerCreation as FixedProductMarketMakerCreationEvent } from "../generated/FPMMDeterministicFactory/FPMMDeterministicFactory";
import {
  ConditionPreparation,
  CreatorAgent,
  FixedProductMarketMakerCreation,
  Question,
} from "../generated/schema";
import { FixedProductMarketMaker as FixedProductMarketMakerTemplate } from "../generated/templates";
import { CREATOR_ADDRESSES, BLACKLISTED_MARKETS } from "./constants";

export function handleFixedProductMarketMakerCreation(
  event: FixedProductMarketMakerCreationEvent
): void {
  let creatorAddressHexString = event.params.creator.toHexString();
  let address = event.params.fixedProductMarketMaker;
  let addressHexString = address.toHexString();

  if (
    // Only save data for our market creators
    CREATOR_ADDRESSES.indexOf(creatorAddressHexString.toLowerCase()) !== -1 &&
    // and not in the black list
    BLACKLISTED_MARKETS.indexOf(addressHexString.toLowerCase()) === -1
  ) {
    let entity = new FixedProductMarketMakerCreation(address);
    entity.creator = event.params.creator;
    entity.conditionalTokens = event.params.conditionalTokens;
    entity.collateralToken = event.params.collateralToken;
    entity.conditionIds = event.params.conditionIds;
    entity.fee = event.params.fee;
    entity.blockNumber = event.block.number;
    entity.blockTimestamp = event.block.timestamp;
    entity.transactionHash = event.transaction.hash;

    let conditionIdStr = event.params.conditionIds[0].toHexString();
    let condition = ConditionPreparation.load(conditionIdStr);
    if (condition) {
      // Log question so we can get the final answer later
      let question = Question.load(condition.questionId.toHexString());
      if (question != null) {
        // Get question title and outcomes
        let fields = question.question.split("\u241f", 4);

        if (fields.length >= 1) {
          entity.question = fields[0];
          if (fields.length >= 2) {
            let outcomes = new Array<string>(0);
            let outcomesData = fields[1].split(',');
            for (let i = 0; i < outcomesData.length; i++) {
              let cleanedOutcome = outcomesData[i]
                .replaceAll('"', '')
                .replaceAll('/', '')
                .trim();
              outcomes.push(cleanedOutcome)
            }
            entity.outcomes = outcomes;
          }
        }

        // Connect question with fpmm
        question.fixedProductMarketMaker = address;
        question.save()
      }
    }

    entity.save();

    let creatorAgent = CreatorAgent.load(creatorAddressHexString);
    if (creatorAgent === null) {
      creatorAgent = new CreatorAgent(creatorAddressHexString);
      creatorAgent.totalQuestions = 0;
      creatorAgent.blockNumber = event.block.number;
      creatorAgent.blockTimestamp = event.block.timestamp;
      creatorAgent.transactionHash = event.transaction.hash;
    }
    creatorAgent.totalQuestions += 1;
    creatorAgent.save();

    FixedProductMarketMakerTemplate.create(address);
  }
}
