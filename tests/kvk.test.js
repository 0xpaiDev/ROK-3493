import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kvkState, dkp, kvkStandings, KVK_DEFAULTS, currentKvk, checkKvk } from "../site/kingdom.js";

const CASES = JSON.parse(readFileSync(new URL("./kvk-cases.json", import.meta.url), "utf8")).cases;

for (const c of CASES) {
  test(`KvK check (shared with save_kvk): ${c.case}`, () => {
    assert.equal(checkKvk(c.kvk, c.others), c.refused);
  });
}

const kvk = { name: "KvK 1", startsOn: "2026-11-23", endsOn: "2027-01-20" };

test("a KvK is Upcoming before its start day, Active from its start day through its end day, Ended after", () => {
  assert.equal(kvkState(kvk, "2026-11-22"), "upcoming");
  assert.equal(kvkState(kvk, "2026-11-23"), "active");
  assert.equal(kvkState(kvk, "2027-01-20"), "active");
  assert.equal(kvkState(kvk, "2027-01-21"), "ended");
});

test("a KvK's state goes by the UTC day of a moment", () => {
  assert.equal(kvkState(kvk, Date.parse("2026-11-22T23:59:59Z")), "upcoming");
  assert.equal(kvkState(kvk, Date.parse("2026-11-23T00:00:00Z")), "active");
  assert.equal(kvkState(kvk, Date.parse("2027-01-21T00:00:00Z")), "ended");
});

const past = { name: "Past", startsOn: "2026-06-01", endsOn: "2026-07-31" };
const next = { name: "Next", startsOn: "2027-03-01", endsOn: "2027-04-30" };

test("the KvK tab shows the Active KvK", () => {
  assert.equal(currentKvk([past, kvk, next], "2026-12-01"), kvk);
});

test("with no Active KvK, the KvK tab shows the newest that has ended, not one still to come", () => {
  assert.equal(currentKvk([next, past], "2026-12-01"), past);
});

test("with only Upcoming KvKs, the KvK tab shows the next one to start", () => {
  assert.equal(currentKvk([next, kvk], "2026-11-01"), kvk);
});

test("with no KvK set up, the KvK tab shows none", () => {
  assert.equal(currentKvk([], "2026-11-01"), null);
});

const gov = (id,startPower, t4Kills, t5Kills, t4Deaths, t5Deaths) => ({ id, name: "Gov " + id, status: "Current", startPower, t4Kills, t5Kills, t4Deaths, t5Deaths });

test("DKP weighs T4 kills, T5 kills, T4 deaths and T5 deaths 1 / 2 / 4 / 8 by default", () => {
  assert.equal(dkp(gov("a", 0, 100, 10, 5, 1), KVK_DEFAULTS.weights), 148);
});

test("DKP follows the KvK's own weights", () => {
  assert.equal(dkp(gov("a", 0, 100, 10, 5, 1), { t4Kill: 0, t5Kill: 1, t4Death: 0.5, t5Death: 10 }), 22.5);
});

test("a Governor's DKP is 0 before any Counting Period has counted", () => {
  assert.equal(dkp(gov("a", 0, null, null, null, null), KVK_DEFAULTS.weights), 0);
});

test("a new KvK takes a 20M Power Cutoff", () => {
  assert.equal(KVK_DEFAULTS.powerCutoff, 20_000_000);
});

const k = { startsOn: "2026-11-23", endsOn: "2027-01-20", powerCutoff: 20_000_000, weights: KVK_DEFAULTS.weights, periods: [] };

test("standings rank by DKP, highest first, with each Governor's DKP", () => {
  const rows = kvkStandings([gov("a", 30e6, 10, 0, 0, 0), gov("b", 25e6, 0, 0, 0, 5), gov("c", 40e6, 0, 3, 0, 0)], k);
  assert.deepEqual(rows.map((r) => [r.id, r.rank, r.dkp]), [["b", 1, 40], ["a", 2, 10], ["c", 3, 6]]);
});

test("standings keep only Governors at or above the Power Cutoff in the KvK Start Snapshot", () => {
  const rows = kvkStandings([gov("at", 20e6, 1, 0, 0, 0), gov("below", 19_999_999, 99, 0, 0, 0), gov("none", null, 99, 0, 0, 0)], k);
  assert.deepEqual(rows.map((r) => r.id), ["at"]);
});

test("Governors tied on DKP share a rank, and the next one skips past them", () => {
  const rows = kvkStandings([gov("a", 30e6, 8, 0, 0, 0), gov("b", 25e6, 0, 0, 2, 0), gov("c", 40e6, 16, 0, 0, 0), gov("d", 21e6, 1, 0, 0, 0)], k);
  assert.deepEqual(rows.map((r) => [r.id, r.rank]), [["c", 1], ["a", 2], ["b", 2], ["d", 4]]);
});
