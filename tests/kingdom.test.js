import { test } from "node:test";
import assert from "node:assert/strict";
import { rankWeek, fortAverage, fortWeekEnd, fortWeekAt, findInRanking } from "../site/kingdom.js";

const entry = (id, fortCount) => ({ id, name: "Gov " + id, fortCount });

test("tied Governors share a displayed rank number and keep the stored order", () => {
  const ranked = rankWeek([entry("a", 10), entry("b", 12), entry("c", 10), entry("d", 8)]);
  assert.deepEqual(ranked.map((e) => [e.id, e.rank]), [["b", 1], ["a", 2], ["c", 2], ["d", 4]]);
});

const week = (completeness, ...entries) => ({ completeness, entries });

test("Fort Average starts at the Governor's first ranked Fort Week", () => {
  const weeks = [week("complete", entry("x", 50)), week("complete", entry("g", 10)), week("complete", entry("g", 20))];
  assert.equal(fortAverage(weeks, "g").average, 15);
});

test("a Complete Week the Governor is missing from counts as 0", () => {
  const weeks = [week("complete", entry("g", 10)), week("complete", entry("x", 50)), week("complete", entry("g", 20))];
  assert.equal(fortAverage(weeks, "g").average, 10);
});

test("a Partial Week counts only when the Governor is ranked in it", () => {
  const weeks = [week("complete", entry("g", 10)), week("partial", entry("x", 50)), week("partial", entry("g", 20))];
  assert.equal(fortAverage(weeks, "g").average, 15);
});

test("a Fort Week with no completeness set counts as Complete", () => {
  const weeks = [week("complete", entry("g", 10)), { entries: [entry("x", 50)] }];
  assert.equal(fortAverage(weeks, "g").average, 5);
});

test("a Governor never ranked has no Fort Average", () => {
  const weeks = [week("complete", entry("x", 50)), week("complete", entry("y", 40))];
  assert.equal(fortAverage(weeks, "g"), null);
});

test("a Fort Week starting Monday 26 Oct ends on Sunday 1 Nov", () => {
  assert.equal(fortWeekEnd("2026-10-26"), "2026-11-01");
});

test("on Monday 2 Nov at 10:00 UTC the Fort Week resets on Monday 9 Nov at 00:00 UTC", () => {
  const week = fortWeekAt(new Date("2026-11-02T10:00:00Z"));
  assert.deepEqual([week.start, week.resetsAt.toISOString()], ["2026-11-02", "2026-11-09T00:00:00.000Z"]);
});

const ranking = [
  { id: "176012522", name: "vkreçislaw", fortCount: 205, rank: 1 },
  { id: "136642563", name: "TasteMyFat", fortCount: 137, rank: 2 },
  { id: null, name: "ILLOM", fortCount: 118, rank: 3 },
];

test("Find your Governor matches a former name from Name History, case-insensitively", () => {
  const history = [{ id: "136642563", name: "OldTaste" }, { id: "136642563", name: "TasteMyFat" }];
  assert.deepEqual(findInRanking(ranking, history, "oldtaste").map((e) => [e.rank, e.fortCount]), [[2, 137]]);
});

test("Find your Governor matches a Character ID", () => {
  assert.deepEqual(findInRanking(ranking, [], "176012522").map((e) => e.name), ["vkreçislaw"]);
});
