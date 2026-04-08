import {
  assert,
  describe,
  test,
  clearStore,
  afterEach,
  createMockedFunction
} from "matchstick-as/assembly/index"
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import {
  handleProposalCreated,
  handleProposalCanceled,
  handleProposalExecuted,
  handleProposalQueued,
  handleProposalThresholdSet,
  handleVoteCast,
  handleVoteCastWithParams,
  handleVotingDelaySet,
  handleVotingPeriodSet
} from "../src/governor-olas"
import {
  createProposalCreatedEvent,
  createProposalCanceledEvent,
  createProposalExecutedEvent,
  createProposalQueuedEvent,
  createVoteCastEvent,
  createVoteCastWithParamsEvent,
  createProposalThresholdSetEvent,
  createVotingDelaySetEvent,
  createVotingPeriodSetEvent
} from "./governor-olas-utils"

const PROPOSER = Address.fromString("0x0000000000000000000000000000000000000001")
const VOTER = Address.fromString("0x0000000000000000000000000000000000000002")
const TARGET = Address.fromString("0x0000000000000000000000000000000000000003")
// Default contract address used by newMockEvent()
const CONTRACT_ADDRESS = Address.fromString("0xa16081f360e3847006db660bae1c6d1b2e17ec2a")
const PROPOSAL_ID = BigInt.fromI32(42)
const QUORUM_VALUE = BigInt.fromI32(1000000)

function mockQuorumCall(startBlock: BigInt): void {
  createMockedFunction(CONTRACT_ADDRESS, "quorum", "quorum(uint256):(uint256)")
    .withArgs([ethereum.Value.fromUnsignedBigInt(startBlock)])
    .returns([ethereum.Value.fromUnsignedBigInt(QUORUM_VALUE)])
}

function createDefaultProposal(): void {
  let event = createProposalCreatedEvent(
    PROPOSAL_ID,
    PROPOSER,
    [TARGET],
    [BigInt.fromI32(0)],
    ["transfer(address,uint256)"],
    [Bytes.fromHexString("0x1234")],
    BigInt.fromI32(100),   // startBlock
    BigInt.fromI32(200),   // endBlock
    "Test proposal"
  )
  handleProposalCreated(event)
}

describe("Governance handlers", () => {
  afterEach(() => {
    clearStore()
  })

  test("ProposalCreated entity stored with correct fields", () => {
    createDefaultProposal()

    assert.entityCount("ProposalCreated", 1)
    let id = PROPOSAL_ID.toString()
    assert.fieldEquals("ProposalCreated", id, "proposalId", PROPOSAL_ID.toString())
    assert.fieldEquals("ProposalCreated", id, "proposer", PROPOSER.toHexString())
    assert.fieldEquals("ProposalCreated", id, "description", "Test proposal")
    assert.fieldEquals("ProposalCreated", id, "startBlock", "100")
    assert.fieldEquals("ProposalCreated", id, "endBlock", "200")
    assert.fieldEquals("ProposalCreated", id, "isExecuted", "false")
    assert.fieldEquals("ProposalCreated", id, "isCancelled", "false")
    assert.fieldEquals("ProposalCreated", id, "isQueued", "false")
    assert.fieldEquals("ProposalCreated", id, "votesFor", "0")
    assert.fieldEquals("ProposalCreated", id, "votesAgainst", "0")
  })

  test("ProposalCanceled sets isCancelled flag", () => {
    createDefaultProposal()
    mockQuorumCall(BigInt.fromI32(100))

    let event = createProposalCanceledEvent(PROPOSAL_ID)
    event.block.number = BigInt.fromI32(150)
    handleProposalCanceled(event)

    assert.entityCount("ProposalCanceled", 1)
    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "isCancelled", "true")
  })

  test("ProposalExecuted sets isExecuted flag", () => {
    createDefaultProposal()
    mockQuorumCall(BigInt.fromI32(100))

    let event = createProposalExecutedEvent(PROPOSAL_ID)
    event.block.number = BigInt.fromI32(150)
    handleProposalExecuted(event)

    assert.entityCount("ProposalExecuted", 1)
    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "isExecuted", "true")
  })

  test("ProposalQueued sets isQueued flag and stores eta", () => {
    createDefaultProposal()
    mockQuorumCall(BigInt.fromI32(100))

    let eta = BigInt.fromI32(1700000000)
    let event = createProposalQueuedEvent(PROPOSAL_ID, eta)
    event.block.number = BigInt.fromI32(150)
    handleProposalQueued(event)

    assert.entityCount("ProposalQueued", 1)
    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "isQueued", "true")
  })

  test("VoteCast for support=1 increments votesFor", () => {
    createDefaultProposal()

    let weight = BigInt.fromI32(500)
    let event = createVoteCastEvent(VOTER, PROPOSAL_ID, 1, weight, "I support this")
    handleVoteCast(event)

    assert.entityCount("VoteCast", 1)
    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "votesFor", "500")
    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "votesAgainst", "0")
  })

  test("VoteCast for support=0 increments votesAgainst", () => {
    createDefaultProposal()

    let weight = BigInt.fromI32(300)
    let event = createVoteCastEvent(VOTER, PROPOSAL_ID, 0, weight, "I oppose this")
    handleVoteCast(event)

    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "votesAgainst", "300")
    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "votesFor", "0")
  })

  test("VoteCast for support=2 (abstain) does not change tallies", () => {
    createDefaultProposal()

    let weight = BigInt.fromI32(200)
    let event = createVoteCastEvent(VOTER, PROPOSAL_ID, 2, weight, "Abstain")
    handleVoteCast(event)

    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "votesFor", "0")
    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "votesAgainst", "0")
  })

  test("Multiple votes accumulate correctly", () => {
    createDefaultProposal()

    let event1 = createVoteCastEvent(VOTER, PROPOSAL_ID, 1, BigInt.fromI32(100), "")
    handleVoteCast(event1)

    let voter2 = Address.fromString("0x0000000000000000000000000000000000000004")
    let event2 = createVoteCastEvent(voter2, PROPOSAL_ID, 1, BigInt.fromI32(250), "")
    handleVoteCast(event2)

    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "votesFor", "350")
  })

  test("VoteCastWithParams does not update vote tallies", () => {
    createDefaultProposal()

    let weight = BigInt.fromI32(500)
    let event = createVoteCastWithParamsEvent(
      VOTER, PROPOSAL_ID, 1, weight, "With params",
      Bytes.fromHexString("0xabcd")
    )
    handleVoteCastWithParams(event)

    assert.entityCount("VoteCastWithParams", 1)
    // Vote tallies should remain zero
    assert.fieldEquals("ProposalCreated", PROPOSAL_ID.toString(), "votesFor", "0")
  })

  test("ProposalThresholdSet creates entity", () => {
    let event = createProposalThresholdSetEvent(
      BigInt.fromI32(100),
      BigInt.fromI32(200)
    )
    handleProposalThresholdSet(event)

    assert.entityCount("ProposalThresholdSet", 1)
  })

  test("VotingDelaySet creates entity", () => {
    let event = createVotingDelaySetEvent(
      BigInt.fromI32(1),
      BigInt.fromI32(2)
    )
    handleVotingDelaySet(event)

    assert.entityCount("VotingDelaySet", 1)
  })

  test("VotingPeriodSet creates entity", () => {
    let event = createVotingPeriodSetEvent(
      BigInt.fromI32(50400),
      BigInt.fromI32(100800)
    )
    handleVotingPeriodSet(event)

    assert.entityCount("VotingPeriodSet", 1)
  })
})
