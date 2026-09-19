import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  EventStore,
  EventStoreVersionConflictError,
  EventStorePersistenceError,
  createSupabaseDb,
} from '../event-store.js';
import { InMemoryDb, dbRow } from './in-memory-db.js';

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

/** Minimal chainable supabase-like client for the adapter's read models. */
function createMockClient() {
  const orders = new Map();
  const drivers = new Map();
  const client = {
    orders,
    drivers,
    from(name) {
      if (name === 'orders_read_model') {
        return {
          upsert: async (items) => {
            for (const item of items) orders.set(item.order_id, item);
            return { data: items, error: null };
          },
        };
      }
      if (name === 'drivers_read_model') {
        return {
          upsert: async (items) => {
            for (const item of items) drivers.set(item.driver_id, item);
            return { data: items, error: null };
          },
        };
      }
      return { upsert: async () => ({ data: [], error: null }) };
    },
  };
  return client;
}

/**
 * Faithful mock of the Supabase PostgREST client for event_store.
 *
 * Models real PostgREST semantics:
 * - .upsert() without .select() defaults to Prefer: return=minimal -> { data: null, error: null }
 * - .upsert().select() sends Prefer: return=representation:
 *   - new row inserted -> { data: [row], error: null }
 *   - duplicate onConflict (aggregate_id, version) with ignoreDuplicates: true -> { data: [], error: null }
 * - database errors return { data: null, error: { message, code } }
 */
function createMockSupabaseEventStoreClient({ initialRows = [], errorToThrow = null, latestVersionOverride = undefined } = {}) {
  const store = new Map();
  for (const r of initialRows) store.set(`${r.aggregate_id}\0${r.version}`, r);

  return {
    _store: store,
    from(table) {
      if (table !== 'event_store') {
        return {
          select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
          upsert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
        };
      }
      return {
        select: () => ({
          eq: (_col, val) => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => {
                  if (errorToThrow) return { data: null, error: errorToThrow };
                  if (latestVersionOverride !== undefined) {
                    return { data: latestVersionOverride === null ? null : { version: latestVersionOverride }, error: null };
                  }
                  const rows = [...store.values()].filter((r) => r.aggregate_id === val);
                  return { data: rows.length ? { version: Math.max(...rows.map((r) => r.version)) } : null, error: null };
                },
              }),
            }),
          }),
        }),
        upsert(rows, options = {}) {
          let withSelect = false;
          const builder = {
            select: () => {
              withSelect = true;
              return builder;
            },
            then: (resolve) => {
              if (errorToThrow) return resolve({ data: null, error: errorToThrow });
              if (!withSelect) return resolve({ data: null, error: null });
              const inserted = [];
              for (const row of rows) {
                const key = `${row.aggregate_id}\0${row.version}`;
                if (store.has(key)) {
                  if (!options.ignoreDuplicates) {
                    return resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
                  }
                } else {
                  store.set(key, row);
                  inserted.push(row);
                }
              }
              return resolve({ data: inserted, error: null });
            },
          };
          return builder;
        },
      };
    },
  };
}

describe('EventStore adapter', () => {
  test('CASE 11: package exposes ESM exports', async () => {
    assert.equal(typeof EventStore, 'function');
    assert.equal(typeof EventStoreVersionConflictError, 'function');
    assert.equal(typeof EventStorePersistenceError, 'function');
    assert.equal(typeof createSupabaseDb, 'function');
  });

  test('CASE 9: rebuildProjections reconstructs read models from persisted rows', async () => {
    const rows = [
      dbRow({ id: 'a1', type: 'ORDER_CREATED', aggregateId: 'order_rb_a', payload: { customerId: 'ca', amount: 10, pickup: 'p', dropoff: 'd' }, version: 1 }),
      dbRow({ id: 'a2', type: 'ORDER_UPDATED', aggregateId: 'order_rb_a', payload: { amount: 15 }, version: 2 }),
      dbRow({ id: 'b1', type: 'ORDER_CREATED', aggregateId: 'order_rb_b', payload: { customerId: 'cb', amount: 20, pickup: 'p', dropoff: 'd' }, version: 1 }),
      dbRow({ id: 'b2', type: 'DRIVER_ASSIGNED', aggregateId: 'order_rb_b', payload: { orderId: 'order_rb_b', driverId: 'drv_b', assignedAt: 't' }, version: 2 }),
    ];

    const db = new InMemoryDb({ initialEvents: rows });
    const client = createMockClient();
    const store = new EventStore({ db, client, logger: silentLogger });

    const result = await store.rebuildProjections(rows);

    assert.equal(result.aggregates, 2);
    assert.equal(result.orderCount, 2);
    assert.equal(result.driverCount, 1);
    assert.equal(result.eventCount, 4);

    // Read model payload equals the aggregate state, not a single event payload.
    const rmA = client.orders.get('order_rb_a');
    assert.equal(rmA.version, 2);
    assert.equal(rmA.payload.amount, 15);
    assert.equal(rmA.payload.status, 'CREATED');

    const rmB = client.orders.get('order_rb_b');
    assert.equal(rmB.payload.status, 'ASSIGNED');
    assert.equal(rmB.payload.driverId, 'drv_b');

    assert.equal(client.drivers.get('drv_b').order_id, 'order_rb_b');
  });

  test('rebuild honors a valid snapshot and skips covered events', async () => {
    const orderId = 'order_rb_snap_adapter';
    const rows = [
      dbRow({ id: 'e1', type: 'ORDER_CREATED', aggregateId: orderId, payload: { customerId: 'c', amount: 1, pickup: 'p', dropoff: 'd' }, version: 1 }),
      dbRow({ id: 'e2', type: 'ORDER_UPDATED', aggregateId: orderId, payload: { amount: 2 }, version: 2 }),
      dbRow({ id: 'e3', type: 'ORDER_UPDATED', aggregateId: orderId, payload: { amount: 3 }, version: 3 }),
    ];
    const db = new InMemoryDb({
      initialEvents: rows,
      initialSnapshots: [{
        aggregate_id: orderId,
        version: 2,
        state: { id: orderId, version: 2, customerId: 'c', amount: 999, status: 'CREATED' },
        snapshot_version: 1,
      }],
    });
    const client = createMockClient();
    const store = new EventStore({ db, client, logger: silentLogger });

    await store.rebuildProjections(rows);

    const rm = client.orders.get(orderId);
    assert.equal(rm.payload.amount, 3);
    assert.equal(rm.version, 3);
  });

  test('adapter appendEvent converts duplicate version into a typed conflict', async () => {
    const db = new InMemoryDb();
    const client = createMockClient();
    const store = new EventStore({ db, client, logger: silentLogger });

    await store.appendEvent('order_dup', { type: 'ORDER_CREATED', payload: { a: 1 } }, 0);
    await assert.rejects(
      () => store.appendEvent('order_dup', { type: 'ORDER_CREATED', payload: { a: 2 } }, 0),
      (err) => {
        assert.ok(err instanceof EventStoreVersionConflictError);
        assert.equal(err.code, 'EVENT_VERSION_CONFLICT');
        return true;
      }
    );
    assert.equal(db.rawRows('order_dup').length, 1);
  });

  describe('createSupabaseDb adapter contract', () => {
    test('insertEvent returns selected row on successful insert', async () => {
      const client = createMockSupabaseEventStoreClient();
      const adapter = createSupabaseDb(client, silentLogger);
      const row = {
        event_id: 'e1',
        event_type: 'ORDER_CREATED',
        aggregate_id: 'ord_1',
        payload: { amount: 100 },
        version: 1,
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.insertEvent(row);
      assert.ok(result.data, 'data must be returned when .select() is chained');
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].event_id, 'e1');
      assert.equal(result.error, null);
    });

    test('insertEvent returns empty array on duplicate ignore (version conflict)', async () => {
      const client = createMockSupabaseEventStoreClient();
      const adapter = createSupabaseDb(client, silentLogger);
      const row = {
        event_id: 'e1',
        event_type: 'ORDER_CREATED',
        aggregate_id: 'ord_1',
        payload: { amount: 100 },
        version: 1,
        timestamp: new Date().toISOString(),
      };

      await adapter.insertEvent(row);
      const duplicateResult = await adapter.insertEvent({ ...row, event_id: 'e2' });
      assert.ok(Array.isArray(duplicateResult.data));
      assert.equal(duplicateResult.data.length, 0, 'ignored duplicate must yield empty array');
      assert.equal(duplicateResult.error, null);
    });

    test('insertEvent propagates database error from Supabase', async () => {
      const dbError = { message: 'connection failure', code: 'PGRST000' };
      const client = createMockSupabaseEventStoreClient({ errorToThrow: dbError });
      const adapter = createSupabaseDb(client, silentLogger);
      const row = {
        event_id: 'e1',
        event_type: 'ORDER_CREATED',
        aggregate_id: 'ord_1',
        payload: { amount: 100 },
        version: 1,
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.insertEvent(row);
      assert.equal(result.data, null);
      assert.equal(result.error, dbError);
    });
  });

  describe('EventStore with production Supabase adapter semantics', () => {
    test('appendEvent succeeds when Supabase insert returns selected row', async () => {
      const client = createMockSupabaseEventStoreClient();
      const store = new EventStore({ client, logger: silentLogger });

      const event = await store.appendEvent(
        'order_supabase_1',
        { type: 'ORDER_CREATED', payload: { customerId: 'c1', total: 50 } },
        0
      );

      assert.equal(event.aggregateId, 'order_supabase_1');
      assert.equal(event.type, 'ORDER_CREATED');
      assert.equal(event.version, 1);
      assert.equal(event.payload.total, 50);
    });

    test('appendEvent rejects with EventStoreVersionConflictError when duplicate is ignored', async () => {
      // Seed the store with version 1 (committed by a concurrent command)
      const existingRow = {
        event_id: 'e1',
        event_type: 'ORDER_CREATED',
        aggregate_id: 'order_supabase_dup',
        payload: { a: 1 },
        version: 1,
        timestamp: new Date().toISOString(),
      };
      // latestVersionOverride: 0 simulates a stale read where expectedVersion is 0,
      // so the pre-check passes and insertEvent(version 1) is invoked against the database.
      const client = createMockSupabaseEventStoreClient({
        initialRows: [existingRow],
        latestVersionOverride: 0,
      });
      const store = new EventStore({ client, logger: silentLogger });

      // expectedVersion is 0; pre-check passes because fetchLatestVersion returned 0.
      // Next version is calculated as 1. When insertEvent is called with version 1,
      // the unique constraint (aggregate_id, version) triggers ignoreDuplicates: true,
      // returning { data: [], error: null }.
      await assert.rejects(
        () => store.appendEvent(
          'order_supabase_dup',
          { type: 'ORDER_CREATED', payload: { a: 2 } },
          0
        ),
        (err) => {
          assert.ok(err instanceof EventStoreVersionConflictError, `Expected EventStoreVersionConflictError but got ${err?.constructor?.name}`);
          assert.equal(err.code, 'EVENT_VERSION_CONFLICT');
          assert.equal(err.aggregateId, 'order_supabase_dup');
          assert.equal(err.currentVersion, 1);
          assert.match(err.message, /a concurrent command already committed this version/);
          return true;
        }
      );
    });

    test('appendEvent propagates database error as typed persistence error', async () => {
      const dbError = { message: 'relation "event_store" does not exist', code: '42P01' };
      const client = createMockSupabaseEventStoreClient({ errorToThrow: dbError });
      const store = new EventStore({ client, logger: silentLogger });

      await assert.rejects(
        () => store.appendEvent(
          'order_supabase_err',
          { type: 'ORDER_CREATED', payload: { a: 1 } },
          0
        ),
        (err) => {
          assert.ok(err instanceof EventStorePersistenceError, `Expected EventStorePersistenceError but got ${err?.constructor?.name}`);
          assert.equal(err.code, 'EVENT_PERSISTENCE_ERROR');
          assert.equal(err.cause?.code, '42P01');
          assert.equal(err.cause?.message, 'relation "event_store" does not exist');
          return true;
        }
      );
    });
  });
});
