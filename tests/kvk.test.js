import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kvkState, dkp, kvkStandings, KVK_DEFAULTS, currentKvk, checkKvk, kvkList, kvkCounting, proposeKvk } from "../site/kingdom.js";

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

test("the KvK list puts the upcoming KvK first, then the Active one, then past ones, newest first, each with its state", () => {
  const older = { name: "Older", startsOn: "2026-01-05", endsOn: "2026-03-01" };
  const list = kvkList([past, older, next, kvk], "2026-12-01");
  assert.deepEqual(list.map((k) => [k.name, k.state]), [["Next", "upcoming"], ["KvK 1", "active"], ["Past", "ended"], ["Older", "ended"]]);
});

test("\"show all\" brings in Governors below the Power Cutoff and those not in the KvK Start Snapshot, ranked with the rest", () => {
  const rows = kvkStandings([gov("at", 20e6, 1, 0, 0, 0), gov("below", 19_999_999, 99, 0, 0, 0), gov("none", null, 3, 0, 0, 0)], k, { all: true });
  assert.deepEqual(rows.map((r) => [r.id, r.rank, r.startPower]), [["below", 1, 19_999_999], ["none", 2, null], ["at", 3, 20e6]]);
});

test("sorted by another column, the table ranks on it, highest first, and ties share a rank", () => {
  const rows = kvkStandings([gov("a", 30e6, 0, 4, 0, 0), gov("b", 25e6, 50, 1, 0, 0), gov("c", 40e6, 0, 4, 9, 0)], k, { sort: "t5Kills" });
  assert.deepEqual(rows.map((r) => [r.id, r.rank]), [["a", 1], ["c", 1], ["b", 3]]);
});

test("sorted by starting power, a Governor without starting power comes last", () => {
  const rows = kvkStandings([gov("none", null, 0, 0, 0, 0), gov("a", 30e6, 0, 0, 0, 0), gov("b", 0, 0, 0, 0, 0)], k, { all: true, sort: "startPower" });
  assert.deepEqual(rows.map((r) => [r.id, r.rank]), [["a", 1], ["b", 2], ["none", 3]]);
});

test("sorted by Governor, the table goes A to Z and each Governor keeps their DKP rank", () => {
  const rows = kvkStandings([{ ...gov("1", 30e6, 5, 0, 0, 0), name: "zed" }, { ...gov("2", 30e6, 9, 0, 0, 0), name: "Ánna" }, { ...gov("3", 30e6, 1, 0, 0, 0), name: "bo" }], k, { sort: "name" });
  assert.deepEqual(rows.map((r) => [r.name, r.rank]), [["Ánna", 1], ["bo", 3], ["zed", 2]]);
});

const counting = { ...k, periods: [{ startsOn: "2026-11-25", endsOn: "2026-11-27" }, { startsOn: "2026-12-01", endsOn: null }] };

// The Roster Snapshot days the store has, newest first, as the site reads them (no daily rows).
const snaps = (...days) => days.sort().reverse();

test("before its first Counting Period starts, a KvK says when counting begins", () => {
  assert.deepEqual(kvkCounting(counting, "2026-11-24", snaps("2026-11-24")), { begins: "2026-11-25" });
});

test("once counting has begun, a KvK counts the Counting Period days that have a Roster Snapshot", () => {
  assert.deepEqual(kvkCounting(counting, "2026-11-26", snaps("2026-11-24", "2026-11-25", "2026-11-26")), { days: 2 });
  assert.deepEqual(kvkCounting(counting, "2026-12-03", snaps("2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-12-01", "2026-12-02")), { days: 5 });
});

test("a Counting Period day with no Roster Snapshot is not counted", () => {
  // 26 Nov was never saved: two of the first period's three days are in the numbers.
  assert.deepEqual(kvkCounting(counting, "2026-11-28", snaps("2026-11-25", "2026-11-27", "2026-11-28")), { days: 2 });
});

test("an open Counting Period counts no further than the KvK's end day", () => {
  const days = [];
  for (let t = Date.parse("2026-11-20"); t <= Date.parse("2027-02-01"); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  assert.deepEqual(kvkCounting(counting, "2027-02-01", snaps(...days)), { days: 3 + 51 });
});

test("once counting has begun with no Roster Snapshot in it yet, a KvK has counted 0 days", () => {
  assert.deepEqual(kvkCounting(counting, "2026-11-26", snaps("2026-11-24")), { days: 0 });
  assert.deepEqual(kvkCounting(counting, "2026-11-26", []), { days: 0 });
});

test("a KvK with no Counting Period set has no day counting begins", () => {
  assert.deepEqual(kvkCounting(k, "2026-12-01", snaps("2026-12-01")), { begins: null });
});

// ---- The KvK setup wizard's proposal (ticket 19) ----

const heroicAnthem = { slug: "heroic-anthem", name: "Heroic Anthem" };

test("the wizard proposes Heroic Anthem from Fri 20 Nov 2026: named for the Story and month, 52 days, one open Counting Period from the first Friday a week in", () => {
  assert.deepEqual(proposeKvk(heroicAnthem, "2026-11-20", null), {
    story: "heroic-anthem", name: "Heroic Anthem · Nov 2026", startsOn: "2026-11-20", endsOn: "2027-01-11",
    periods: [{ startsOn: "2026-11-27", endsOn: null }],
    powerCutoff: 20_000_000, weights: { t4Kill: 1, t5Kill: 2, t4Death: 4, t5Death: 8 },
  });
});

test("a KvK starting on a Sunday gets its Counting Period from the Friday 12 days on", () => {
  const p = proposeKvk(heroicAnthem, "2026-11-22", null);
  assert.deepEqual(p.periods, [{ startsOn: "2026-12-04", endsOn: null }]);
  assert.equal(p.endsOn, "2027-01-13");
});

test("a KvK starting late in December is named for December and runs into the next year", () => {
  const p = proposeKvk({ slug: "song-of-troy", name: "Song of Troy" }, "2026-12-25", null);
  assert.equal(p.name, "Song of Troy · Dec 2026");
  assert.equal(p.story, "song-of-troy");
  assert.equal(p.endsOn, "2027-02-15");
  assert.deepEqual(p.periods, [{ startsOn: "2027-01-01", endsOn: null }]);
});

test("a new KvK carries over the last KvK's Power Cutoff and DKP weights", () => {
  const last = { name: "Old", startsOn: "2026-06-01", endsOn: "2026-07-23", powerCutoff: 25_000_000,
                 weights: { t4Kill: 0, t5Kill: 1, t4Death: 3, t5Death: 6 }, periods: [] };
  const p = proposeKvk(heroicAnthem, "2026-11-20", last);
  assert.equal(p.powerCutoff, 25_000_000);
  assert.deepEqual(p.weights, { t4Kill: 0, t5Kill: 1, t4Death: 3, t5Death: 6 });
});
