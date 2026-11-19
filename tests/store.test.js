import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rowsIfTable } from "../site/store.js";

// A read of a table a migration adds: until the migration reaches the database the table is missing
// and the read is empty; any other failure surfaces like every other read.
const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));
const answer = (status, body) => (globalThis.fetch = async () => new Response(JSON.stringify(body), { status }));

test("a table the database doesn't have yet reads as empty", async () => {
  answer(404, { code: "PGRST205", message: "Could not find the table 'public.fort_pause' in the schema cache" });
  assert.deepEqual(await rowsIfTable("fort_pause", "select=starts_at"), []);
});

test("a relation Postgres doesn't know reads as empty", async () => {
  answer(404, { code: "42P01", message: 'relation "public.kvk" does not exist' });
  assert.deepEqual(await rowsIfTable("kvk", "select=id"), []);
});

test("any other failure surfaces", async () => {
  answer(500, { code: "XX000", message: "boom" });
  await assert.rejects(rowsIfTable("kvk", "select=id"), /kvk: 500/);
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(rowsIfTable("fort_pause", "select=starts_at"), /Failed to fetch/);
});

test("a table that is there reads its rows", async () => {
  answer(200, [{ starts_at: "2026-11-01T00:00:00Z", ends_at: null }]);
  assert.deepEqual(await rowsIfTable("fort_pause", "select=starts_at"), [{ starts_at: "2026-11-01T00:00:00Z", ends_at: null }]);
});
