import {
  assert,
  describe,
  test,
  clearStore,
  afterEach,
} from 'matchstick-as/assembly/index';
import { BigInt } from '@graphprotocol/graph-ts';

import {
  handleCreateMechLM,
  handleCreateMechLMM,
  handlePriceUpdateLM,
  handlePriceUpdateLMM,
  handleRequest,
} from '../src/mapping';
import {
  createCreateMechEvent,
  createRequestEvent,
  createPriceUpdatedLMEvent,
  createPriceUpdatedLMMEvent,
} from './mapping-utils';
import {
  TestAddresses,
  TestValues,
  EXPECTED_DAILY_ID,
} from './test-helpers';

describe('handleCreateMechLM', () => {
  afterEach(() => {
    clearStore();
  });

  test('Creates LegacyMech entity with correct fields', () => {
    let event = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLM(event);

    assert.entityCount('LegacyMech', 1);
    assert.fieldEquals(
      'LegacyMech',
      TestAddresses.MECH.toHexString(),
      'agentId',
      TestValues.AGENT_ID.toString()
    );
    assert.fieldEquals(
      'LegacyMech',
      TestAddresses.MECH.toHexString(),
      'price',
      TestValues.PRICE.toString()
    );
    assert.fieldEquals(
      'LegacyMech',
      TestAddresses.MECH.toHexString(),
      'totalFeesIn',
      '0'
    );
    assert.fieldEquals(
      'LegacyMech',
      TestAddresses.MECH.toHexString(),
      'totalFeesOut',
      '0'
    );
  });

  test('Does not overwrite existing LegacyMech entity', () => {
    let event1 = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLM(event1);

    // Try to create again with different price
    let event2 = createCreateMechEvent(
      TestAddresses.MECH,
      BigInt.fromI32(99),
      TestValues.UPDATED_PRICE
    );
    handleCreateMechLM(event2);

    // Should still have original values
    assert.entityCount('LegacyMech', 1);
    assert.fieldEquals(
      'LegacyMech',
      TestAddresses.MECH.toHexString(),
      'price',
      TestValues.PRICE.toString()
    );
  });
});

describe('handleCreateMechLMM', () => {
  afterEach(() => {
    clearStore();
  });

  test('Creates LegacyMechMarketPlace entity with correct fields', () => {
    let event = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLMM(event);

    assert.entityCount('LegacyMechMarketPlace', 1);
    assert.fieldEquals(
      'LegacyMechMarketPlace',
      TestAddresses.MECH.toHexString(),
      'agentId',
      TestValues.AGENT_ID.toString()
    );
    assert.fieldEquals(
      'LegacyMechMarketPlace',
      TestAddresses.MECH.toHexString(),
      'price',
      TestValues.PRICE.toString()
    );
    assert.fieldEquals(
      'LegacyMechMarketPlace',
      TestAddresses.MECH.toHexString(),
      'totalFeesIn',
      '0'
    );
    assert.fieldEquals(
      'LegacyMechMarketPlace',
      TestAddresses.MECH.toHexString(),
      'totalFeesOut',
      '0'
    );
  });

  test('Does not overwrite existing LegacyMechMarketPlace entity', () => {
    let event1 = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLMM(event1);

    let event2 = createCreateMechEvent(
      TestAddresses.MECH,
      BigInt.fromI32(99),
      TestValues.UPDATED_PRICE
    );
    handleCreateMechLMM(event2);

    assert.entityCount('LegacyMechMarketPlace', 1);
    assert.fieldEquals(
      'LegacyMechMarketPlace',
      TestAddresses.MECH.toHexString(),
      'price',
      TestValues.PRICE.toString()
    );
  });
});

describe('handlePriceUpdateLM', () => {
  afterEach(() => {
    clearStore();
  });

  test('Updates LegacyMech price', () => {
    // First create the mech
    let createEvent = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLM(createEvent);

    // Then update its price
    let priceEvent = createPriceUpdatedLMEvent(
      TestAddresses.MECH,
      TestValues.UPDATED_PRICE
    );
    handlePriceUpdateLM(priceEvent);

    assert.fieldEquals(
      'LegacyMech',
      TestAddresses.MECH.toHexString(),
      'price',
      TestValues.UPDATED_PRICE.toString()
    );
  });

  test('Does nothing for unknown mech', () => {
    let priceEvent = createPriceUpdatedLMEvent(
      TestAddresses.MECH,
      TestValues.UPDATED_PRICE
    );
    handlePriceUpdateLM(priceEvent);

    assert.entityCount('LegacyMech', 0);
  });
});

describe('handlePriceUpdateLMM', () => {
  afterEach(() => {
    clearStore();
  });

  test('Updates LegacyMechMarketPlace price', () => {
    // First create the mech
    let createEvent = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLMM(createEvent);

    // Then update its price
    let priceEvent = createPriceUpdatedLMMEvent(
      TestAddresses.MECH,
      TestValues.UPDATED_PRICE
    );
    handlePriceUpdateLMM(priceEvent);

    assert.fieldEquals(
      'LegacyMechMarketPlace',
      TestAddresses.MECH.toHexString(),
      'price',
      TestValues.UPDATED_PRICE.toString()
    );
  });

  test('Does nothing for unknown mech', () => {
    let priceEvent = createPriceUpdatedLMMEvent(
      TestAddresses.MECH,
      TestValues.UPDATED_PRICE
    );
    handlePriceUpdateLMM(priceEvent);

    assert.entityCount('LegacyMechMarketPlace', 0);
  });
});

describe('handleRequest', () => {
  afterEach(() => {
    clearStore();
  });

  test('Adds mech price to totalFeesIn', () => {
    // Create the mech first
    let createEvent = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLM(createEvent);

    // Send a request
    let requestEvent = createRequestEvent(
      TestAddresses.MECH,
      TestAddresses.SENDER,
      TestValues.REQUEST_ID,
      TestValues.REQUEST_DATA,
      TestValues.TIMESTAMP
    );
    handleRequest(requestEvent);

    assert.fieldEquals(
      'LegacyMech',
      TestAddresses.MECH.toHexString(),
      'totalFeesIn',
      TestValues.PRICE.toString()
    );
  });

  test('Accumulates fees across multiple requests', () => {
    let createEvent = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLM(createEvent);

    // Two requests
    let request1 = createRequestEvent(
      TestAddresses.MECH,
      TestAddresses.SENDER,
      TestValues.REQUEST_ID,
      TestValues.REQUEST_DATA,
      TestValues.TIMESTAMP
    );
    handleRequest(request1);

    let request2 = createRequestEvent(
      TestAddresses.MECH,
      TestAddresses.SENDER,
      BigInt.fromI32(2),
      TestValues.REQUEST_DATA,
      TestValues.TIMESTAMP
    );
    handleRequest(request2);

    let expectedFees = TestValues.PRICE.times(BigInt.fromI32(2));
    assert.fieldEquals(
      'LegacyMech',
      TestAddresses.MECH.toHexString(),
      'totalFeesIn',
      expectedFees.toString()
    );
  });

  test('Creates and updates Global entity', () => {
    let createEvent = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLM(createEvent);

    let requestEvent = createRequestEvent(
      TestAddresses.MECH,
      TestAddresses.SENDER,
      TestValues.REQUEST_ID,
      TestValues.REQUEST_DATA,
      TestValues.TIMESTAMP
    );
    handleRequest(requestEvent);

    // Global entity uses empty string as ID
    assert.entityCount('Global', 1);
    assert.fieldEquals(
      'Global',
      '',
      'totalFeesIn',
      TestValues.PRICE.toString()
    );
    assert.fieldEquals(
      'Global',
      '',
      'totalFeesInLegacyMech',
      TestValues.PRICE.toString()
    );
    assert.fieldEquals('Global', '', 'totalFeesOut', '0');
    assert.fieldEquals(
      'Global',
      '',
      'totalFeesInLegacyMechMarketPlace',
      '0'
    );
  });

  test('Creates and updates DailyFees entity', () => {
    let createEvent = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLM(createEvent);

    let requestEvent = createRequestEvent(
      TestAddresses.MECH,
      TestAddresses.SENDER,
      TestValues.REQUEST_ID,
      TestValues.REQUEST_DATA,
      TestValues.TIMESTAMP
    );
    handleRequest(requestEvent);

    assert.entityCount('DailyFees', 1);
    assert.fieldEquals(
      'DailyFees',
      EXPECTED_DAILY_ID,
      'totalFeesInLegacyMech',
      TestValues.PRICE.toString()
    );
    assert.fieldEquals(
      'DailyFees',
      EXPECTED_DAILY_ID,
      'date',
      EXPECTED_DAILY_ID
    );
  });

  test('Creates MechDaily entity', () => {
    let createEvent = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLM(createEvent);

    let requestEvent = createRequestEvent(
      TestAddresses.MECH,
      TestAddresses.SENDER,
      TestValues.REQUEST_ID,
      TestValues.REQUEST_DATA,
      TestValues.TIMESTAMP
    );
    handleRequest(requestEvent);

    let mechDailyId =
      TestAddresses.MECH.toHexString() + '-' + EXPECTED_DAILY_ID;
    assert.entityCount('MechDaily', 1);
    assert.fieldEquals(
      'MechDaily',
      mechDailyId,
      'feesInLegacyMech',
      TestValues.PRICE.toString()
    );
    assert.fieldEquals(
      'MechDaily',
      mechDailyId,
      'agentId',
      TestValues.AGENT_ID.toString()
    );
  });

  test('Does nothing for unknown mech', () => {
    let requestEvent = createRequestEvent(
      TestAddresses.MECH,
      TestAddresses.SENDER,
      TestValues.REQUEST_ID,
      TestValues.REQUEST_DATA,
      TestValues.TIMESTAMP
    );
    handleRequest(requestEvent);

    // No entities should be created (no Global, no DailyFees)
    assert.entityCount('LegacyMech', 0);
    assert.entityCount('Global', 0);
  });

  test('Uses updated price after PriceUpdated event', () => {
    // Create mech with initial price
    let createEvent = createCreateMechEvent(
      TestAddresses.MECH,
      TestValues.AGENT_ID,
      TestValues.PRICE
    );
    handleCreateMechLM(createEvent);

    // Update price
    let priceEvent = createPriceUpdatedLMEvent(
      TestAddresses.MECH,
      TestValues.UPDATED_PRICE
    );
    handlePriceUpdateLM(priceEvent);

    // Send request — should use updated price
    let requestEvent = createRequestEvent(
      TestAddresses.MECH,
      TestAddresses.SENDER,
      TestValues.REQUEST_ID,
      TestValues.REQUEST_DATA,
      TestValues.TIMESTAMP
    );
    handleRequest(requestEvent);

    assert.fieldEquals(
      'LegacyMech',
      TestAddresses.MECH.toHexString(),
      'totalFeesIn',
      TestValues.UPDATED_PRICE.toString()
    );
    assert.fieldEquals(
      'Global',
      '',
      'totalFeesIn',
      TestValues.UPDATED_PRICE.toString()
    );
  });
});
