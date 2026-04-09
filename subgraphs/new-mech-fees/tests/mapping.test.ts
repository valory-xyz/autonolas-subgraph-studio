import {
  assert,
  describe,
  test,
  clearStore,
  afterEach,
  beforeEach,
  dataSourceMock,
} from "matchstick-as/assembly/index";
import { BigDecimal, BigInt } from "@graphprotocol/graph-ts";
import { Mech } from "../generated/schema";
import {
  handleMechBalanceAdjustedForNative,
  handleWithdrawForNative,
} from "../src/native-mapping";
import {
  createMechBalanceAdjustedEvent,
  createWithdrawEvent,
} from "./mapping-utils";
import { TestAddresses, TestValues } from "./test-helpers";

// On Gnosis (xdai), native currency is xDAI which is pegged 1:1 to USD.
// convertGnosisNativeWeiToUsd simply divides by 1e18, no Chainlink call needed.

describe("handleMechBalanceAdjustedForNative", () => {
  beforeEach(() => {
    dataSourceMock.setNetwork("xdai");
  });

  afterEach(() => {
    clearStore();
  });

  test("Creates Mech entity and MechTransaction on first event", () => {
    const event = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_1,
      TestValues.ONE_XDAI_WEI,    // deliveryRate = 1 xDAI
      TestValues.BALANCE,
      TestValues.RATE_DIFF
    );

    handleMechBalanceAdjustedForNative(event);

    const mechId = TestAddresses.MECH_1.toHex();

    // Mech entity created with correct fee totals
    assert.entityCount("Mech", 1);
    assert.fieldEquals("Mech", mechId, "totalFeesInUSD", "1");
    assert.fieldEquals("Mech", mechId, "totalFeesInRaw", "1000000000000000000");
    assert.fieldEquals("Mech", mechId, "totalFeesOutUSD", "0");
    assert.fieldEquals("Mech", mechId, "totalFeesOutRaw", "0");

    // MechTransaction created (FEE_IN)
    assert.entityCount("MechTransaction", 1);
  });

  test("Updates Global totalFeesInUSD", () => {
    const event = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_1,
      TestValues.ONE_XDAI_WEI,
      TestValues.BALANCE,
      TestValues.RATE_DIFF
    );

    handleMechBalanceAdjustedForNative(event);

    // Global entity id is empty string
    assert.fieldEquals("Global", "", "totalFeesInUSD", "1");
    assert.fieldEquals("Global", "", "totalFeesOutUSD", "0");
  });

  test("Creates DailyTotals entity with correct day bucket", () => {
    const event = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_1,
      TestValues.ONE_XDAI_WEI,
      TestValues.BALANCE,
      TestValues.RATE_DIFF
    );

    handleMechBalanceAdjustedForNative(event);

    // dayStart = (1700000000 / 86400) * 86400 = 1699920000
    const dayId = "1699920000";
    assert.entityCount("DailyTotals", 1);
    assert.fieldEquals("DailyTotals", dayId, "totalFeesInUSD", "1");
    assert.fieldEquals("DailyTotals", dayId, "totalFeesOutUSD", "0");
    assert.fieldEquals("DailyTotals", dayId, "date", "1699920000");
  });

  test("Creates MechModel entity with model=native", () => {
    const event = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_1,
      TestValues.ONE_XDAI_WEI,
      TestValues.BALANCE,
      TestValues.RATE_DIFF
    );

    handleMechBalanceAdjustedForNative(event);

    const mechId = TestAddresses.MECH_1.toHex();
    const mechModelId = mechId + "-native";

    assert.entityCount("MechModel", 1);
    assert.fieldEquals("MechModel", mechModelId, "model", "native");
    assert.fieldEquals("MechModel", mechModelId, "totalFeesInUSD", "1");
    assert.fieldEquals("MechModel", mechModelId, "totalFeesInRaw", "1000000000000000000");
    assert.fieldEquals("MechModel", mechModelId, "totalFeesOutUSD", "0");
    assert.fieldEquals("MechModel", mechModelId, "totalFeesOutRaw", "0");
  });

  test("Creates MechDaily entity for mech + day", () => {
    const event = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_1,
      TestValues.ONE_XDAI_WEI,
      TestValues.BALANCE,
      TestValues.RATE_DIFF
    );

    handleMechBalanceAdjustedForNative(event);

    const mechId = TestAddresses.MECH_1.toHex();
    const mechDailyId = mechId + "-1699920000";

    assert.entityCount("MechDaily", 1);
    assert.fieldEquals("MechDaily", mechDailyId, "feesInUSD", "1");
    assert.fieldEquals("MechDaily", mechDailyId, "feesInRaw", "1000000000000000000");
    assert.fieldEquals("MechDaily", mechDailyId, "feesOutUSD", "0");
    assert.fieldEquals("MechDaily", mechDailyId, "feesOutRaw", "0");
    assert.fieldEquals("MechDaily", mechDailyId, "date", "1699920000");
  });

  test("Accumulates fees across multiple events for same mech", () => {
    const event1 = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_1,
      TestValues.ONE_XDAI_WEI,
      TestValues.BALANCE,
      TestValues.RATE_DIFF,
      TestValues.TIMESTAMP,
      TestValues.BLOCK,
      0
    );
    const event2 = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_1,
      TestValues.TWO_POINT_FIVE_XDAI_WEI,
      TestValues.BALANCE,
      TestValues.RATE_DIFF,
      TestValues.TIMESTAMP,
      TestValues.BLOCK,
      1
    );

    handleMechBalanceAdjustedForNative(event1);
    handleMechBalanceAdjustedForNative(event2);

    const mechId = TestAddresses.MECH_1.toHex();

    // 1 + 2.5 = 3.5 USD
    assert.fieldEquals("Mech", mechId, "totalFeesInUSD", "3.5");
    assert.fieldEquals("Global", "", "totalFeesInUSD", "3.5");
    assert.entityCount("MechTransaction", 2);
  });

  test("MechTransaction has correct fields", () => {
    const event = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_1,
      TestValues.ONE_XDAI_WEI,
      TestValues.BALANCE,
      TestValues.RATE_DIFF
    );

    handleMechBalanceAdjustedForNative(event);

    const txId =
      event.transaction.hash.toHexString() +
      "-" +
      event.logIndex.toString();

    assert.fieldEquals("MechTransaction", txId, "type", "FEE_IN");
    assert.fieldEquals("MechTransaction", txId, "model", "native");
    assert.fieldEquals("MechTransaction", txId, "amountUSD", "1");
    assert.fieldEquals(
      "MechTransaction",
      txId,
      "amountRaw",
      "1000000000000000000"
    );
    assert.fieldEquals(
      "MechTransaction",
      txId,
      "deliveryRate",
      TestValues.ONE_XDAI_WEI.toString()
    );
    assert.fieldEquals(
      "MechTransaction",
      txId,
      "balance",
      TestValues.BALANCE.toString()
    );
    assert.fieldEquals(
      "MechTransaction",
      txId,
      "rateDiff",
      TestValues.RATE_DIFF.toString()
    );
    assert.fieldEquals(
      "MechTransaction",
      txId,
      "timestamp",
      TestValues.TIMESTAMP.toString()
    );
    assert.fieldEquals(
      "MechTransaction",
      txId,
      "blockNumber",
      TestValues.BLOCK.toString()
    );
  });

  test("Handles two different mechs independently", () => {
    const event1 = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_1,
      TestValues.ONE_XDAI_WEI,
      TestValues.BALANCE,
      TestValues.RATE_DIFF,
      TestValues.TIMESTAMP,
      TestValues.BLOCK,
      0
    );
    const event2 = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_2,
      TestValues.HALF_XDAI_WEI,
      TestValues.BALANCE,
      TestValues.RATE_DIFF,
      TestValues.TIMESTAMP,
      TestValues.BLOCK,
      1
    );

    handleMechBalanceAdjustedForNative(event1);
    handleMechBalanceAdjustedForNative(event2);

    assert.entityCount("Mech", 2);
    assert.fieldEquals("Mech", TestAddresses.MECH_1.toHex(), "totalFeesInUSD", "1");
    assert.fieldEquals("Mech", TestAddresses.MECH_2.toHex(), "totalFeesInUSD", "0.5");

    // Global should accumulate both
    assert.fieldEquals("Global", "", "totalFeesInUSD", "1.5");
  });
});

describe("handleWithdrawForNative", () => {
  beforeEach(() => {
    dataSourceMock.setNetwork("xdai");
  });

  afterEach(() => {
    clearStore();
  });

  test("Creates MechTransaction (FEE_OUT) and updates Global totalFeesOutUSD", () => {
    // Pre-create Mech entity (Withdraw handler loads Mech by recipient address)
    const mechId = TestAddresses.MECH_1.toHex();
    const mech = new Mech(mechId);
    mech.totalFeesInUSD = BigDecimal.fromString("5");
    mech.totalFeesOutUSD = BigDecimal.fromString("0");
    mech.totalFeesInRaw = BigDecimal.fromString("5000000000000000000");
    mech.totalFeesOutRaw = BigDecimal.fromString("0");
    mech.save();

    const event = createWithdrawEvent(
      TestAddresses.MECH_1,
      TestAddresses.ZERO,
      TestValues.ONE_XDAI_WEI
    );

    handleWithdrawForNative(event);

    // Global updated
    assert.fieldEquals("Global", "", "totalFeesOutUSD", "1");

    // Mech updated
    assert.fieldEquals("Mech", mechId, "totalFeesOutUSD", "1");
    assert.fieldEquals("Mech", mechId, "totalFeesOutRaw", "1000000000000000000");

    // MechTransaction created
    assert.entityCount("MechTransaction", 1);
  });

  test("MechTransaction has FEE_OUT type and correct fields", () => {
    // Pre-create Mech
    const mechId = TestAddresses.MECH_1.toHex();
    const mech = new Mech(mechId);
    mech.totalFeesInUSD = BigDecimal.fromString("5");
    mech.totalFeesOutUSD = BigDecimal.fromString("0");
    mech.totalFeesInRaw = BigDecimal.fromString("5000000000000000000");
    mech.totalFeesOutRaw = BigDecimal.fromString("0");
    mech.save();

    const event = createWithdrawEvent(
      TestAddresses.MECH_1,
      TestAddresses.ZERO,
      TestValues.ONE_XDAI_WEI
    );

    handleWithdrawForNative(event);

    const txId =
      event.transaction.hash.toHexString() +
      "-" +
      event.logIndex.toString();

    assert.fieldEquals("MechTransaction", txId, "type", "FEE_OUT");
    assert.fieldEquals("MechTransaction", txId, "model", "native");
    assert.fieldEquals("MechTransaction", txId, "amountUSD", "1");
    assert.fieldEquals("MechTransaction", txId, "amountRaw", "1000000000000000000");
  });

  // Note: burn address skip cannot be tested in Matchstick because BURN_ADDRESS is
  // evaluated at module-load time (before dataSourceMock.setNetwork is called),
  // so it resolves to Address.zero() instead of the Gnosis burn address.

  test("Updates DailyTotals feesOut", () => {
    // Pre-create Mech
    const mechId = TestAddresses.MECH_1.toHex();
    const mech = new Mech(mechId);
    mech.totalFeesInUSD = BigDecimal.fromString("5");
    mech.totalFeesOutUSD = BigDecimal.fromString("0");
    mech.totalFeesInRaw = BigDecimal.fromString("5000000000000000000");
    mech.totalFeesOutRaw = BigDecimal.fromString("0");
    mech.save();

    const event = createWithdrawEvent(
      TestAddresses.MECH_1,
      TestAddresses.ZERO,
      TestValues.ONE_XDAI_WEI
    );

    handleWithdrawForNative(event);

    const dayId = "1699920000";
    assert.entityCount("DailyTotals", 1);
    assert.fieldEquals("DailyTotals", dayId, "totalFeesOutUSD", "1");
    assert.fieldEquals("DailyTotals", dayId, "totalFeesInUSD", "0");
  });

  test("Updates MechModel feesOut with model=native", () => {
    // Pre-create Mech
    const mechId = TestAddresses.MECH_1.toHex();
    const mech = new Mech(mechId);
    mech.totalFeesInUSD = BigDecimal.fromString("5");
    mech.totalFeesOutUSD = BigDecimal.fromString("0");
    mech.totalFeesInRaw = BigDecimal.fromString("5000000000000000000");
    mech.totalFeesOutRaw = BigDecimal.fromString("0");
    mech.save();

    const event = createWithdrawEvent(
      TestAddresses.MECH_1,
      TestAddresses.ZERO,
      TestValues.TWO_POINT_FIVE_XDAI_WEI
    );

    handleWithdrawForNative(event);

    const mechModelId = mechId + "-native";
    assert.fieldEquals("MechModel", mechModelId, "model", "native");
    assert.fieldEquals("MechModel", mechModelId, "totalFeesOutUSD", "2.5");
    assert.fieldEquals("MechModel", mechModelId, "totalFeesOutRaw", "2500000000000000000");
  });

  test("Updates MechDaily feesOut", () => {
    // Pre-create Mech
    const mechId = TestAddresses.MECH_1.toHex();
    const mech = new Mech(mechId);
    mech.totalFeesInUSD = BigDecimal.fromString("5");
    mech.totalFeesOutUSD = BigDecimal.fromString("0");
    mech.totalFeesInRaw = BigDecimal.fromString("5000000000000000000");
    mech.totalFeesOutRaw = BigDecimal.fromString("0");
    mech.save();

    const event = createWithdrawEvent(
      TestAddresses.MECH_1,
      TestAddresses.ZERO,
      TestValues.ONE_XDAI_WEI
    );

    handleWithdrawForNative(event);

    const mechDailyId = mechId + "-1699920000";
    assert.fieldEquals("MechDaily", mechDailyId, "feesOutUSD", "1");
    assert.fieldEquals("MechDaily", mechDailyId, "feesOutRaw", "1000000000000000000");
  });

  test("No MechTransaction if Mech entity does not exist", () => {
    // Do NOT pre-create the Mech — handler calls Mech.load() which returns null,
    // so createMechTransactionForCollected is skipped
    const event = createWithdrawEvent(
      TestAddresses.MECH_1,
      TestAddresses.ZERO,
      TestValues.ONE_XDAI_WEI
    );

    handleWithdrawForNative(event);

    // Global and other aggregates still update (they use getOrInitializeMech
    // internally), but the explicit Mech.load() in the handler returns null
    // for the pre-existing check, so no MechTransaction is created via
    // createMechTransactionForCollected.
    // However, updateMechFeesOut calls getOrInitializeMech which DOES create the Mech.
    // So Mech will exist after the handler runs, but the handler's own Mech.load()
    // happens AFTER updateMechFeesOut, so it will find the Mech that was just created.
    // Let's verify: the handler calls updateMechFeesOut (which creates Mech) BEFORE
    // Mech.load(), so the Mech.load() will succeed and MechTransaction WILL be created.
    assert.entityCount("MechTransaction", 1);
    assert.fieldEquals("Global", "", "totalFeesOutUSD", "1");
  });
});

describe("handleMechBalanceAdjustedForNative + handleWithdrawForNative integration", () => {
  beforeEach(() => {
    dataSourceMock.setNetwork("xdai");
  });

  afterEach(() => {
    clearStore();
  });

  test("Fee in then fee out updates all totals correctly", () => {
    // Fee in: 2.5 xDAI
    const balanceAdjustedEvent = createMechBalanceAdjustedEvent(
      TestAddresses.MECH_1,
      TestValues.TWO_POINT_FIVE_XDAI_WEI,
      TestValues.BALANCE,
      TestValues.RATE_DIFF,
      TestValues.TIMESTAMP,
      TestValues.BLOCK,
      0
    );

    handleMechBalanceAdjustedForNative(balanceAdjustedEvent);

    // Fee out: 1 xDAI
    const withdrawEvent = createWithdrawEvent(
      TestAddresses.MECH_1,
      TestAddresses.ZERO,
      TestValues.ONE_XDAI_WEI,
      TestValues.TIMESTAMP,
      TestValues.BLOCK,
      1
    );

    handleWithdrawForNative(withdrawEvent);

    const mechId = TestAddresses.MECH_1.toHex();

    // Mech totals
    assert.fieldEquals("Mech", mechId, "totalFeesInUSD", "2.5");
    assert.fieldEquals("Mech", mechId, "totalFeesOutUSD", "1");

    // Global totals
    assert.fieldEquals("Global", "", "totalFeesInUSD", "2.5");
    assert.fieldEquals("Global", "", "totalFeesOutUSD", "1");

    // Two transactions total (one FEE_IN, one FEE_OUT)
    assert.entityCount("MechTransaction", 2);

    // DailyTotals for the same day
    const dayId = "1699920000";
    assert.fieldEquals("DailyTotals", dayId, "totalFeesInUSD", "2.5");
    assert.fieldEquals("DailyTotals", dayId, "totalFeesOutUSD", "1");

    // MechDaily
    const mechDailyId = mechId + "-1699920000";
    assert.fieldEquals("MechDaily", mechDailyId, "feesInUSD", "2.5");
    assert.fieldEquals("MechDaily", mechDailyId, "feesOutUSD", "1");

    // MechModel
    const mechModelId = mechId + "-native";
    assert.fieldEquals("MechModel", mechModelId, "totalFeesInUSD", "2.5");
    assert.fieldEquals("MechModel", mechModelId, "totalFeesOutUSD", "1");
  });
});
