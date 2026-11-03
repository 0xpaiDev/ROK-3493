import { test } from "node:test";
import assert from "node:assert/strict";
import { rankWeek, fortAverage, fortWeekEnd, fortWeekAt, findInRanking, farmLinkSuggestions, applyRosterSnapshot, parseStatsExport, mainsRanking, matchNames, parseFortRows, governorsTwice, moveInTie, newFortNames } from "../site/kingdom.js";

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

const gov = (id, name, kind = "main", mainId = null) => ({ id, name, kind, mainId });

test("a name that is a Main's name plus Farm is suggested as that Main's Farm", () => {
  const governors = [gov("1", "TasteMyFat"), gov("2", "TasteMyFatFarm"), gov("3", "vkreçislaw")];
  assert.deepEqual(farmLinkSuggestions(governors).map((s) => [s.farmId, s.mainId]), [["2", "1"]]);
});

test("a Farm marker can be a number or F plus a number, and case is ignored", () => {
  const governors = [gov("1", "RuTHLess"), gov("2", "RuThLesS F1"), gov("3", "Zhuī Mìng"), gov("4", "Zhuī Mìng 5")];
  assert.deepEqual(farmLinkSuggestions(governors).map((s) => [s.farmId, s.mainId]), [["2", "1"], ["4", "3"]]);
});

test("FKK10 is not suggested as a Farm of FKK1, nor ZARAHHH of ZARAH", () => {
  const governors = [gov("1", "FKK1"), gov("2", "FKK10"), gov("3", "ZARAH"), gov("4", "ZARAHHH")];
  assert.deepEqual(farmLinkSuggestions(governors), []);
});

test("a Farm-shaped name is never suggested as a Main", () => {
  const governors = [gov("1", "Enes"), gov("2", "Enes farm"), gov("3", "Enes farm2")];
  assert.deepEqual(farmLinkSuggestions(governors).map((s) => [s.farmId, s.mainId]), [["2", "1"], ["3", "1"]]);
});

test("a Governor already marked as a Farm is neither suggested again nor offered as a Main", () => {
  const governors = [gov("1", "TasteMyFat"), gov("2", "TasteMyFatFarm", "farm", "1"), gov("3", "Alvaru", "farm"), gov("4", "Alvaru 2")];
  assert.deepEqual(farmLinkSuggestions(governors), []);
});

test("a dismissed pair is not suggested again; other pairs still are", () => {
  const governors = [gov("1", "yuriel"), gov("2", "yuriel3"), gov("3", "yuriel33")];
  const dismissed = [{ farmId: "3", mainId: "1" }];
  assert.deepEqual(farmLinkSuggestions(governors, dismissed).map((s) => [s.farmId, s.mainId]), [["2", "1"]]);
});

test("a suggestion says why: the Main's name plus the Farm marker", () => {
  const [s] = farmLinkSuggestions([gov("1", "RuTHLess"), gov("2", "RuThLesS F1")]);
  assert.equal(s.reason, "RuTHLess + F1");
});

// Roster Snapshots: rows carry Character ID, name and power; Governors carry their status.
const row = (id, power, name = "Gov " + id) => ({ id, name, power });
const member = (id, status = "current", statusSetBy = "snapshot", statusSetAt = "2026-10-26T00:00:00Z") =>
  ({ id, name: "Gov " + id, status, statusSetBy, statusSetAt });
const nov1 = (...rows) => ({ takenOn: "2026-11-01", rows });

test("a Top 200 Governor absent from the new Roster Snapshot becomes Inactive, not Migrated", () => {
  const result = applyRosterSnapshot({
    governors: [member("1"), member("2")],
    nameHistory: [{ id: "1", name: "Gov 1" }, { id: "2", name: "Gov 2" }],
    previous: [row("1", 900), row("2", 800)],
    snapshot: nov1(row("1", 950)),
  });
  assert.deepEqual(result.statusChanges.map((c) => [c.id, c.to]), [["2", "inactive"]]);
});

test("an absent Governor who was outside the previous Top 200 is not marked Inactive", () => {
  const previous = Array.from({ length: 201 }, (_, i) => row(String(i + 1), 1000 - i)); // "201" ranks 201st
  const result = applyRosterSnapshot({
    governors: [member("200"), member("201")],
    nameHistory: [],
    previous,
    snapshot: nov1(...previous.filter((r) => r.id !== "200" && r.id !== "201")),
  });
  assert.deepEqual(result.statusChanges.map((c) => [c.id, c.to]), [["200", "inactive"]]);
});

test("an Inactive Governor who reappears in the new Roster Snapshot becomes Current", () => {
  const result = applyRosterSnapshot({
    governors: [member("1"), member("2", "inactive")],
    nameHistory: [],
    previous: [row("1", 900)],
    snapshot: nov1(row("1", 900), row("2", 10)),
  });
  assert.deepEqual(result.statusChanges.map((c) => [c.id, c.to]), [["2", "current"]]);
});

test("a Migrated Governor who reappears in the new Roster Snapshot becomes Current", () => {
  const result = applyRosterSnapshot({
    governors: [member("1"), member("2", "migrated")],
    nameHistory: [],
    previous: [row("1", 900)],
    snapshot: nov1(row("1", 900), row("2", 10)),
  });
  assert.deepEqual(result.statusChanges.map((c) => [c.id, c.to]), [["2", "current"]]);
});

test("the Top 200 is the 200 highest-power Governors of the new Roster Snapshot", () => {
  const rows = Array.from({ length: 202 }, (_, i) => row(String(i + 1), 100 + i)); // "1" and "2" are weakest
  const result = applyRosterSnapshot({ governors: [], nameHistory: [], previous: null, snapshot: nov1(...rows) });
  assert.deepEqual([result.top200.length, result.top200.includes("1"), result.top200.includes("2"), result.top200[0]], [200, false, false, "202"]);
});

test("a name not yet in Name History joins it, dated from the Roster Snapshot", () => {
  const result = applyRosterSnapshot({
    governors: [member("1"), member("2")],
    nameHistory: [{ id: "1", name: "OldTaste" }, { id: "1", name: "TasteMyFat" }, { id: "2", name: "vkreçislaw" }],
    previous: [row("1", 900), row("2", 800)],
    snapshot: nov1(row("1", 900, "OldTaste"), row("2", 800, "vkreçislaw II"), row("3", 50, "Newcomer")),
  });
  assert.deepEqual(result.newNames, [
    { id: "2", name: "vkreçislaw II", firstSeen: "2026-11-01" },
    { id: "3", name: "Newcomer", firstSeen: "2026-11-01" },
  ]);
});

test("a Character ID never seen before joins as a new Current Governor", () => {
  const result = applyRosterSnapshot({ governors: [member("1")], nameHistory: [], previous: [row("1", 900)], snapshot: nov1(row("1", 900), row("3", 50, "Newcomer")) });
  assert.deepEqual(result.newGovernors, [{ id: "3", name: "Newcomer" }]);
});

test("a Governor whose name changed takes the Roster Snapshot's name as its current name", () => {
  const result = applyRosterSnapshot({
    governors: [member("1"), member("2")],
    nameHistory: [],
    previous: [row("1", 900), row("2", 800)],
    snapshot: nov1(row("1", 900), row("2", 800, "vkreçislaw II")),
  });
  assert.deepEqual(result.renames, [{ id: "2", from: "Gov 2", to: "vkreçislaw II" }]);
});

test("a Council status change followed by a Roster Snapshot that disagrees ends with the snapshot's status", () => {
  const result = applyRosterSnapshot({
    governors: [member("1"), member("2", "migrated", "council", "2026-10-30T12:00:00Z")],
    nameHistory: [],
    previous: [row("1", 900)],
    snapshot: nov1(row("1", 900), row("2", 800)),
  });
  assert.deepEqual(result.statusChanges.map((c) => [c.id, c.to]), [["2", "current"]]);
});

test("a Council status change made after the Roster Snapshot's day stands: the latest event wins", () => {
  const result = applyRosterSnapshot({
    governors: [member("1", "current", "council", "2026-11-02T09:00:00Z"), member("2", "migrated", "council", "2026-11-02T09:00:00Z")],
    nameHistory: [],
    previous: [row("1", 900)],
    snapshot: nov1(row("2", 800)),
  });
  assert.deepEqual(result.statusChanges, []);
});

// The first rows of samples/3493_20261101_20261101_statsExport.xlsx, as the sheet holds them: all text.
const exportHeader = ["Character ID", "Username", "Power", "Highest Power", "Total Kill Points", "Resources Gathered", "Alliance Helps"];

test("a Lilith stats export becomes a Roster Snapshot dated from its filename, with its text values read as numbers", () => {
  const snapshot = parseStatsExport("3493_20261101_20261101_statsExport.xlsx", [
    exportHeader,
    ["149673994", "FKK CATHAY", "124239570", "124247670", "0", "5421254", "67"],
    ["49913581", "Zhuī Mìng", "103571739", "110941449", "0", "19813500", "19"],
  ]);
  assert.deepEqual(snapshot, {
    takenOn: "2026-11-01",
    rows: [
      { id: "149673994", name: "FKK CATHAY", power: 124239570, highestPower: 124247670, killPoints: 0, resources: 5421254, allianceHelps: 67 },
      { id: "49913581", name: "Zhuī Mìng", power: 103571739, highestPower: 110941449, killPoints: 0, resources: 19813500, allianceHelps: 19 },
    ],
  });
});

test("an export value that is not a number is refused, naming its row", () => {
  const cells = [exportHeader, ["149673994", "FKK CATHAY", "12x", "124247670", "0", "5421254", "67"]];
  assert.throws(() => parseStatsExport("3493_20261101_20261101_statsExport.xlsx", cells), /row 2.*Power/i);
});

// ---------- Mains ranking ----------
const main = (id) => ({ id, name: "Gov " + id, kind: "main", mainId: null });
const farm = (id, mainId = null) => ({ id, name: "Gov " + id, kind: "farm", mainId });

test("the default Mains ranking leaves Farms out and ranks the Mains among themselves", () => {
  const governors = [main("a"), farm("f", "a"), main("b")];
  const rows = mainsRanking([entry("a", 30), entry("f", 20), entry("b", 10)], governors);
  assert.deepEqual(rows.map((r) => [r.id, r.rank]), [["a", 1], ["b", 2]]);
});

test("with Farms shown, a Main's Fort Count adds its Farms' and the Mains are reranked by that sum", () => {
  const governors = [main("a"), farm("f1", "a"), farm("f2", "a"), main("b")];
  const rows = mainsRanking([entry("b", 40), entry("a", 30), entry("f1", 25), entry("f2", 5)], governors, { withFarms: true });
  assert.deepEqual(rows.map((r) => [r.id, r.rank, r.fortCount, r.own, r.farms.map((f) => [f.id, f.fortCount])]), [
    ["a", 1, 60, 30, [["f1", 25], ["f2", 5]]],
    ["b", 2, 40, 40, []],
  ]);
});

test("Mains tied on the sum keep the Council's order", () => {
  const governors = [main("a"), main("b"), farm("f", "b")];
  const rows = mainsRanking([entry("b", 20), entry("a", 30), entry("f", 10)], governors, { withFarms: true });
  assert.deepEqual(rows.map((r) => [r.id, r.rank, r.fortCount]), [["b", 1, 30], ["a", 1, 30]]);
});

test("a Main with 0 forts is ranked on its Farms' sum when one of its Farms has forts", () => {
  const governors = [main("a"), main("z"), farm("f", "z")];
  const rows = mainsRanking([entry("a", 30), entry("f", 12)], governors, { withFarms: true });
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.fortCount, r.own, r.rank, r.farms.map((f) => f.id)]), [
    ["a", "Gov a", 30, 30, 1, []],
    ["z", "Gov z", 12, 0, 2, ["f"]],
  ]);
});

test("an unlinked Farm is its own unranked row, placed by Fort Count, and the Mains keep their ranks", () => {
  const governors = [main("a"), main("b"), farm("u")];
  const rows = mainsRanking([entry("a", 30), entry("u", 20), entry("b", 10)], governors, { withFarms: true });
  assert.deepEqual(rows.map((r) => [r.id, r.rank, r.unlinked ?? false]), [["a", 1, false], ["u", null, true], ["b", 2, false]]);
});

test("a needs-ID entry never collects the unlinked Farms", () => {
  const governors = [main("a"), farm("u")];
  const rows = mainsRanking([entry("a", 30), { id: null, name: "Nameless", fortCount: 25 }, entry("u", 20)], governors, { withFarms: true });
  assert.deepEqual(rows.map((r) => [r.id, r.farms.map((f) => f.id)]), [["a", []], [null, []], ["u", []]]);
});

// Name matching for a pasted Fort Week.
const pasted = (name, fortCount) => ({ name, fortCount });

test("a renamed Governor is matched through Name History", () => {
  const history = [{ id: "111", name: "OldName" }, { id: "111", name: "NewName" }];
  assert.deepEqual(matchNames([pasted("OldName", 12)], history), [{ name: "OldName", fortCount: 12, id: "111" }]);
});

test('an unknown name is left as "needs ID"', () => {
  assert.equal(matchNames([pasted("Stranger", 5)], [{ id: "111", name: "Known" }])[0].id, null);
});

test('a name seen under two Character IDs is left as "needs ID", never guessed', () => {
  const history = [{ id: "111", name: "Twin" }, { id: "222", name: "Twin" }];
  assert.equal(matchNames([pasted("Twin", 9)], history)[0].id, null);
});

test('rows with the same pasted name stay separate rows, each "needs ID"', () => {
  const out = matchNames([pasted("Echo", 30), pasted("Echo", 20)], [{ id: "111", name: "Echo" }]);
  assert.deepEqual(out, [{ name: "Echo", fortCount: 30, id: null }, { name: "Echo", fortCount: 20, id: null }]);
});

test("each pasted line gives a name and its Fort Count", () => {
  assert.deepEqual(parseFortRows("vøDarkBlaCK 42\nFKK 10\t1,204\n\n"), [pasted("vøDarkBlaCK", 42), pasted("FKK 10", 1204)]);
});

test("a pasted line without a Fort Count is refused with its line number", () => {
  assert.throws(() => parseFortRows("Alpha 12\nBravo\n"), { message: 'Line 2 has no Fort Count at the end: "Bravo".' });
});

test("a Governor appearing twice in one Fort Week is caught; needs-ID rows are not", () => {
  const rows = [{ name: "A", fortCount: 9, id: "111" }, { name: "A2", fortCount: 4, id: "111" }, { name: "X", fortCount: 3, id: null }, { name: "X", fortCount: 2, id: null }];
  assert.deepEqual(governorsTwice(rows), ["111"]);
});

test("the Council moves a Governor within its tie, and never past a different Fort Count", () => {
  const rows = [entry("a", 20), entry("b", 10), entry("c", 10)];
  assert.deepEqual(moveInTie(rows, 2, -1).map((e) => e.id), ["a", "c", "b"]);
  assert.deepEqual(moveInTie(rows, 1, -1).map((e) => e.id), ["a", "b", "c"]);
});

test("a name the Council picked a Governor for joins Name History; known names and needs-ID rows do not", () => {
  const rows = [{ name: "Odd Name", fortCount: 9, id: "111" }, { name: "Known", fortCount: 8, id: "222" }, { name: "X", fortCount: 3, id: null }];
  const history = [{ id: "111", name: "Real" }, { id: "222", name: "Known" }];
  assert.deepEqual(newFortNames(rows, history, "2026-11-02"), [{ id: "111", name: "Odd Name", firstSeen: "2026-11-02" }]);
});
