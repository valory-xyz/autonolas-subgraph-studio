import {
  assert,
  describe,
  test,
  clearStore,
  afterEach,
  beforeEach,
  dataSourceMock,
} from "matchstick-as/assembly/index";
import { BigInt } from "@graphprotocol/graph-ts";
import { MechBalanceAdjusted } from "../generated/BalanceTrackerFixedPriceTokenOLAS/BalanceTrackerFixedPriceToken";
import { handleMechBalanceAdjustedForTokenOlas } from "../src/token-olas-mapping";
import { createMechBalanceAdjustedEvent } from "./mapping-utils";
import { TestAddresses, TestValues } from "./test-helpers";

// Regression test: importing token-olas-mapping runs its module-scope
// initializers. Before the fix, those resolved Balancer pool addresses that
// have no Celo (or mainnet) branch in shared/constants.ts, hitting
// log.critical() and aborting the whole module before any handler could
// run. With lazy resolution, module load succeeds and the Celo guard inside
// calculateOlasToUsd() is reached.
describe("token-olas on Celo (no pricing pool)", () => {
  beforeEach(() => {
    dataSourceMock.setNetwork("celo");
  });

  afterEach(() => {
    clearStore();
    dataSourceMock.resetValues();
  });

  test("records raw OLAS with USD = 0 instead of halting", () => {
    const event = changetype<MechBalanceAdjusted>(
      createMechBalanceAdjustedEvent(
        TestAddresses.MECH_1,
        TestValues.DELIVERY_RATE,
        TestValues.BALANCE,
        TestValues.RATE_DIFF
      )
    );

    handleMechBalanceAdjustedForTokenOlas(event);

    const mechId = TestAddresses.MECH_1.toHex();
    assert.fieldEquals("Mech", mechId, "totalFeesInRaw", "1000000000000000000");
    assert.fieldEquals("Mech", mechId, "totalFeesInUSD", "0");
    assert.fieldEquals("MechModel", mechId + "-token-olas", "totalFeesInRaw", "1000000000000000000");
    assert.fieldEquals("MechModel", mechId + "-token-olas", "totalFeesInUSD", "0");
    assert.fieldEquals("Global", "", "totalFeesInUSD", "0");
  });
});
