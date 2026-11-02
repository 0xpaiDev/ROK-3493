import { test } from "node:test";
import assert from "node:assert/strict";
import { rankWeek, fortAverage, fortWeekEnd } from "../site/kingdom.js";

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
