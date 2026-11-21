import { test } from "node:test";
import assert from "node:assert/strict";
import { homeShows, homeKvkTop, KVK_DEFAULTS } from "../site/kingdom.js";

// Home follows the Fort Pause switch alone (ADR 0007, kvk SPEC stories 45–48).
const pause = { start: "2026-11-21T18:00:00Z", end: null };
const resumed = { start: "2026-06-01T10:00:00Z", end: "2026-08-01T10:00:00Z" };
const past = { id: 1, name: "KvK Summer", startsOn: "2026-06-01", endsOn: "2026-07-31" };
const kvk = { id: 2, name: "KvK Winter", startsOn: "2026-11-23", endsOn: "2027-01-20" };
const next = { id: 3, name: "KvK Spring", startsOn: "2027-03-01", endsOn: "2027-04-30" };

test("while Forts run, Home shows Fort Rankings, even with a KvK Active", () => {
  assert.deepEqual(homeShows({ pauses: [resumed], kvks: [past, kvk], now: "2026-12-01T00:00:00Z" }), { view: "fort", pause: null });
});

test("while Forts are paused, Home shows the Active KvK", () => {
  assert.deepEqual(homeShows({ pauses: [resumed, pause], kvks: [next, past, kvk], now: "2026-12-01T00:00:00Z" }), { view: "kvk", kvk });
});

test("after the KvK ended, Home keeps showing it until the Council resumes Forts", () => {
  assert.deepEqual(homeShows({ pauses: [pause], kvks: [past, kvk, next], now: "2027-02-10T00:00:00Z" }), { view: "kvk", kvk });
});

test("paused before the KvK starts, Home shows the last KvK that started, not the one to come", () => {
  assert.deepEqual(homeShows({ pauses: [pause], kvks: [past, kvk], now: "2026-11-22T12:00:00Z" }), { view: "kvk", kvk: past });
});

test("paused with no KvK started, Home shows Fort Rankings with the pause line", () => {
  assert.deepEqual(homeShows({ pauses: [pause], kvks: [kvk], now: "2026-11-22T12:00:00Z" }), { view: "fort", pause });
  assert.deepEqual(homeShows({ pauses: [pause], kvks: [], now: "2026-11-22T12:00:00Z" }), { view: "fort", pause });
});

// Home during a Fort Pause (ticket 21): the top 10 Mains by DKP; the KvK tab has the full table.
const standing = (id, t4Kills, startPower = 30e6) => ({ id, name: "Gov " + id, status: "Current", startPower, t4Kills, t5Kills: 0, t4Deaths: 0, t5Deaths: 0 });

test("Home's KvK card shows the top 10 Mains by DKP, never a Farm or an Unmarked Governor", () => {
  const rows = [...Array.from({ length: 12 }, (_, i) => standing(`m${i}`, i)), standing("farm", 100), standing("nobody", 200), standing("late", 50, null)];
  const kinds = new Map(rows.map((r) => [r.id, r.id === "farm" ? "farm" : r.id === "nobody" ? "unmarked" : "main"]));
  const top = homeKvkTop(rows, { weights: KVK_DEFAULTS.weights }, kinds);
  assert.deepEqual(top.map((r) => r.id), ["late", "m11", "m10", "m9", "m8", "m7", "m6", "m5", "m4", "m3"]);
  assert.deepEqual(top.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
