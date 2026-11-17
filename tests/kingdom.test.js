import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankWeek, fortAverage, fortWeekEnd, fortWeekAt, findInRanking, farmLinkSuggestions, top200, mainsRanking, governorsTwice, isFortWeekStart, namesToMatch, isLiveWeek, liveReadingIds, checkWeeklyAward, awardsByWeek, awardsOf, homeWeek, parseAwardAmount, awardAmountLabel, checkRewardPromise, awardAmountInput, livePromise, promiseToStartFrom, ordinal, fillWeeklyAwards, checkPicks } from "../site/kingdom.js";

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

test("FKK1 and FKK10 are both Farms of FKK CATHAY, not one of the other; ZARAHHH is not a Farm of ZARAH", () => {
  const governors = [
    { ...gov("149673994", "FKK CATHAY"), power: 124.2e6 }, { ...gov("151514913", "FKK1"), power: 32.4e6 },
    { ...gov("211854507", "FKK10"), power: 11.0e6 }, gov("3", "ZARAH"), gov("4", "ZARAHHH"),
  ];
  assert.deepEqual(farmLinkSuggestions(governors).map((s) => [s.farmId, s.mainId]), [["151514913", "149673994"], ["211854507", "149673994"]]);
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

test("a suggestion says which rule found it: here the Farm marker", () => {
  const [s] = farmLinkSuggestions([gov("1", "RuTHLess"), gov("2", "RuThLesS F1")]);
  assert.equal(s.reason, 'Farm marker "f1"');
});

// Ticket 14: wider rules. Each Governor carries its power from the latest Roster Snapshot;
// in a suggested group the highest-power account is the Main.
const pgov = (id, name, power) => ({ id, name, kind: "main", mainId: null, power });
const pairs = (list) => list.map((s) => [s.farmId, s.mainId]).sort();

test("normalising drops alliance tags and symbols, folds full-width letters and ignores case", () => {
  const governors = [
    pgov("75711209", "㋛ BiL ㋛", 91.8e6), pgov("92372523", "屮 BiL", 55.0e6), pgov("193098374", "ᵛø cciell", 50.6e6),
    pgov("210712263", "cciell f4", 23.9e6), pgov("14025937", "ＫＭＢ f1", 16.1e6), pgov("3", "kmb", 1e6),
  ];
  assert.deepEqual(pairs(farmLinkSuggestions(governors)), [["210712263", "193098374"], ["3", "14025937"], ["92372523", "75711209"]]);
});

test("names identical after normalising are one group, its highest-power account the Main", () => {
  const governors = [pgov("41810399", "ᵛøDarkBlacK", 40.4e6), pgov("57027433", "ᵛøDarkBlack", 66.7e6), pgov("99299244", "ᵛøDarkBlaCK", 24.8e6)];
  assert.deepEqual(pairs(farmLinkSuggestions(governors)), [["41810399", "57027433"], ["99299244", "57027433"]]);
});

test("the highest-power account is the Main even when its name looks like a Farm; no power never beats power", () => {
  const governors = [pgov("14025937", "ＫＭＢ f1", 16.1e6), pgov("11139139", "ＫＭＢ f2", 7.5e6), pgov("1", "KMB", 2.0e6), pgov("2", "KMB 9", null)];
  assert.deepEqual(pairs(farmLinkSuggestions(governors)), [["1", "14025937"], ["11139139", "14025937"], ["2", "14025937"]]);
});

test("a Farm marker counts anywhere in the name: farm, frm, mini, clone, glued or spaced", () => {
  const governors = [
    pgov("191044511", "ᵛøENES", 63.8e6), pgov("144398884", "Enesfarm7", 25.4e6), pgov("169805414", "Enes farm 3", 1.2e6),
    pgov("184760438", "OzamisFarm", 12.2e6), pgov("189020883", "Ozamis Frm", 10.7e6),
    pgov("179508915", "YEEEE", 84.7e6), pgov("182254461", "Mini YEEEE", 11.9e6),
    pgov("179452862", "azuretf", 6.8e6), pgov("229803024", "azuretf clone1", 1.6e6),
  ];
  assert.deepEqual(pairs(farmLinkSuggestions(governors)), [
    ["144398884", "191044511"], ["169805414", "191044511"], ["182254461", "179508915"], ["189020883", "184760438"], ["229803024", "179452862"],
  ]);
});

test("a letter series ending in F is one group under the account its root starts", () => {
  const governors = [pgov("88693430", "Årtåigē", 101.1e6), pgov("125745217", "Årt・AF", 32.2e6), pgov("88787836", "Årt・BF", 30.7e6), pgov("129680423", "Årt・GF", 6.3e6)];
  assert.deepEqual(pairs(farmLinkSuggestions(governors)), [["125745217", "88693430"], ["129680423", "88693430"], ["88787836", "88693430"]]);
});

test("a Farm's root of at least 4 letters inside another name joins it; a shorter root does not", () => {
  const governors = [
    pgov("164080955", "LordLorenzoniˢ", 91.3e6), pgov("175047993", "MiniLorenzoniˢ", 44.0e6), pgov("175050757", "FarmLorenzoni1", 33.5e6),
    pgov("81275271", "ᵛø HelloCake", 83.7e6), pgov("205406316", "cake f1", 12.8e6),
    pgov("78067532", "BiL F1", 12.6e6), pgov("179538837", "big bill", 4.7e6),
  ];
  assert.deepEqual(pairs(farmLinkSuggestions(governors)), [["175047993", "164080955"], ["175050757", "164080955"], ["205406316", "81275271"]]);
});

test("a name another Governor once went by, plus a Farm marker, is that Governor's Farm", () => {
  const governors = [pgov("8787605", "ᵛø wahab", 63.9e6), pgov("25007784", "Mr Wahab F2", 32.0e6)];
  const history = [{ id: "8787605", name: "Mr Wahab" }, { id: "8787605", name: "ᵛø wahab" }];
  const [s, ...rest] = farmLinkSuggestions(governors, [], history);
  assert.deepEqual([s.farmId, s.mainId, s.reason, rest.length], ["25007784", "8787605", 'Was "Mr Wahab"', 0]);
});

test("the overlap counts a Farm's own former name too, after it was renamed", () => {
  const governors = [pgov("8787605", "ᵛø wahab", 64.8e6), pgov("25007784", "ᵛøwahab   ii", 33.6e6)];
  const history = [{ id: "8787605", name: "Mr Wahab" }, { id: "25007784", name: "Mr Wahab F2" }];
  const [s, ...rest] = farmLinkSuggestions(governors, [], history);
  assert.deepEqual([s.farmId, s.mainId, s.reason, rest.length], ["25007784", "8787605", 'Was "Mr Wahab F2"', 0]);
});

test("a resource word after the root marks a Farm, however many letters it repeats", () => {
  const governors = [
    pgov("154551867", "ᵛø EREN", 78.9e6), pgov("153935494", "Eren cornnn", 7.6e6), pgov("155440734", "Eren stonee", 4.0e6),
    pgov("154636856", "Eren gold", 3.6e6), pgov("191571674", "Eren inf", 37.1e6),
    pgov("177745552", "ᵛø J4KU", 74.3e6), pgov("178893621", "J4KUFOOD", 4.8e6),
  ];
  assert.deepEqual(pairs(farmLinkSuggestions(governors)), [
    ["153935494", "154551867"], ["154636856", "154551867"], ["155440734", "154551867"], ["178893621", "177745552"], ["191571674", "154551867"],
  ]);
});

test("default names never pair, in any language", () => {
  const governors = [
    pgov("179509850", "Governor179509850", 3e6), pgov("179488756", "Governor179488756", 2e6),
    pgov("179451054", "Правитель179451054", 1e6), pgov("179503686", "Правитель179503686", 1e6),
    pgov("179484037", "執政官179484037", 1e6), pgov("179484038", "執政官179484038", 1e6),
    pgov("179509851", "Thống đốc179509851", 1e6), pgov("179509852", "Thống đốc179509852", 1e6),
    pgov("179509853", "Vali179509853", 1e6), pgov("179509854", "Vali179509854", 1e6),
  ];
  assert.deepEqual(farmLinkSuggestions(governors), []);
});

test("F glued after a letter, pc plus a number and a closing fm are Farm markers too", () => {
  const governors = [
    pgov("1", "Stormblessed", 80e6), pgov("2", "StormblessedF1", 10e6), pgov("3", "JADE", 70e6), pgov("4", "JADE pc2", 5e6),
    pgov("5", "Rhaegar", 60e6), pgov("6", "Rhaegar fm", 4e6),
  ];
  assert.deepEqual(pairs(farmLinkSuggestions(governors)), [["2", "1"], ["4", "3"], ["6", "5"]]);
});

test("a numbered series off a shared root is one Main's: acmong2 over Acmong1, Ac mong, acmong52 and acmong3", () => {
  const governors = [
    pgov("179695312", "acmong2", 14.9e6), pgov("179872374", "Acmong1", 11.5e6), pgov("181458933", "Ac mong", 11.4e6),
    pgov("200523736", "acmong52", 2.2e6), pgov("200551343", "acmong3", 2.1e6),
  ];
  assert.deepEqual(pairs(farmLinkSuggestions(governors)), [
    ["179872374", "179695312"], ["181458933", "179695312"], ["200523736", "179695312"], ["200551343", "179695312"],
  ]);
});

test("a Main with its own Farm is not swept under a stronger name only one of its Farms resembles", () => {
  const governors = [pgov("1", "Alexander", 100e6), pgov("2", "Alex F1", 5e6), pgov("3", "Alexis", 50e6), pgov("4", "Alexis farm", 2e6)];
  assert.deepEqual(pairs(farmLinkSuggestions(governors)), [["2", "1"], ["4", "3"]]);
});

test("after a Dismiss the Farm is offered to the next related account, with that pair's own reason", () => {
  const governors = [pgov("1", "Lord Lorenzoni", 100e6), pgov("2", "Lorenzo", 50e6), pgov("3", "Lorenzo F1", 5e6)];
  assert.deepEqual(farmLinkSuggestions(governors).map((s) => [s.farmId, s.mainId, s.reason]), [["3", "1", '"lorenzo" is in Lord Lorenzoni']]);
  assert.deepEqual(farmLinkSuggestions(governors, [{ farmId: "3", mainId: "1" }]).map((s) => [s.farmId, s.mainId, s.reason]), [["3", "2", 'Farm marker "f1"']]);
});

test("a Farm of a suggested Farm goes on to that one's Main, and says through whom", () => {
  const governors = [pgov("1", "Allfather", 100e6), pgov("2", "Odin", 50e6), pgov("3", "Odin F2", 5e6)];
  const history = [{ id: "2", name: "Allfather F1" }];
  assert.deepEqual(farmLinkSuggestions(governors, [], history).map((s) => [s.farmId, s.mainId, s.reason]), [
    ["2", "1", 'Was "Allfather F1"'], ["3", "1", 'Via Odin: Farm marker "f2"'],
  ]);
});

test("a Main of linked Farms is never suggested as a Farm itself", () => {
  const governors = [pgov("1", "Kami", 100e6), { ...pgov("2", "Kami F1", 5e6), kind: "farm", mainId: "1" }, pgov("3", "Kami 2", 200e6)];
  assert.deepEqual(farmLinkSuggestions(governors), []);
});

test("names with no letters left after normalising never pair", () => {
  assert.deepEqual(farmLinkSuggestions([pgov("1", "乄", 3e6), pgov("2", "ᵛø", 2e6), pgov("3", "・", 1e6)]), []);
});

test("a former name's root needs 3 letters, as a current name's does", () => {
  assert.deepEqual(farmLinkSuggestions([pgov("1", "Bob", 100e6), pgov("2", "Al", 5e6)], [], [{ id: "1", name: "Al F2" }]), []);
});

// Top 200: the rules that use it (who becomes Inactive) live in record_roster_snapshot and run
// against tests/roster-snapshot-cases.json in supabase/tests; the site uses top200 for its flag.
const row = (id, power) => ({ id, power });

test("the Top 200 is the 200 highest-power Governors of a Roster Snapshot", () => {
  const rows = Array.from({ length: 202 }, (_, i) => row(String(i + 1), 100 + i)); // "1" and "2" are weakest
  const result = top200(rows);
  assert.deepEqual([result.length, result.includes("1"), result.includes("2"), result[0]], [200, false, false, "202"]);
});

test("a power tie at place 200 goes to the Character ID first as plain text, as in record_roster_snapshot", () => {
  const strong = Array.from({ length: 199 }, (_, i) => row(String(5000 + i), 1000));
  const result = top200([...strong, row("999", 10), row("1200", 10)]);
  assert.deepEqual([result.includes("1200"), result.includes("999")], [true, false]);
});

// ---------- Mains ranking ----------
const main = (id) => ({ id, name: "Gov " + id, kind: "main", mainId: null });
const farm = (id, mainId = null) => ({ id, name: "Gov " + id, kind: "farm", mainId });

test("the default Mains ranking leaves Farms out and ranks the Mains among themselves", () => {
  const governors = [main("a"), farm("f", "a"), main("b")];
  const rows = mainsRanking([entry("a", 30), entry("f", 20), entry("b", 10)], governors);
  assert.deepEqual(rows.map((r) => [r.id, r.rank]), [["a", 1], ["b", 2]]);
});

test("with Farms shown, a Main with 30 forts and two Farms of 10 has a Group Score of 40 and the Mains rerank on it", () => {
  const governors = [main("a"), farm("f1", "a"), farm("f2", "a"), main("b")];
  const rows = mainsRanking([entry("b", 35), entry("a", 30), entry("f1", 10), entry("f2", 10)], governors, { withFarms: true });
  assert.deepEqual(rows.map((r) => [r.id, r.rank, r.groupScore, r.own, r.farms.map((f) => [f.id, f.fortCount])]), [
    ["a", 1, 40, 30, [["f1", 10], ["f2", 10]]],
    ["b", 2, 35, 35, []],
  ]);
});

test("Mains tied on the Group Score keep the Council's order", () => {
  const governors = [main("a"), main("b"), farm("f", "b")];
  const rows = mainsRanking([entry("b", 25), entry("a", 30), entry("f", 10)], governors, { withFarms: true });
  assert.deepEqual(rows.map((r) => [r.id, r.rank, r.groupScore]), [["b", 1, 30], ["a", 1, 30]]);
});

test("a Main with 0 forts and a Farm of 5 has a Group Score of 2.5", () => {
  const governors = [main("a"), main("z"), farm("f", "z")];
  const rows = mainsRanking([entry("a", 3), entry("f", 5)], governors, { withFarms: true });
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.groupScore, r.own, r.rank, r.farms.map((f) => [f.id, f.fortCount])]), [
    ["a", "Gov a", 3, 3, 1, []],
    ["z", "Gov z", 2.5, 0, 2, [["f", 5]]],
  ]);
});

test("an unlinked Farm is its own unranked row, placed by Fort Count, and the Mains keep their ranks", () => {
  const governors = [main("a"), main("b"), farm("f", "b"), farm("u")];
  const rows = mainsRanking([entry("a", 30), entry("u", 20), entry("b", 10), entry("f", 18)], governors, { withFarms: true });
  assert.deepEqual(rows.map((r) => [r.id, r.rank, r.unlinked ?? false]), [["a", 1, false], ["u", null, true], ["b", 2, false]]);
});

test("a needs-ID entry never collects the unlinked Farms", () => {
  const governors = [main("a"), farm("u")];
  const rows = mainsRanking([entry("a", 30), { id: null, name: "Nameless", fortCount: 25 }, entry("u", 20)], governors, { withFarms: true });
  assert.deepEqual(rows.map((r) => [r.id, r.farms.map((f) => f.id)]), [["a", []], [null, []], ["u", []]]);
});

test("a Governor appearing twice in one Fort Week is caught; needs-ID rows are not", () => {
  const rows = [{ name: "A", fortCount: 9, id: "111" }, { name: "A2", fortCount: 4, id: "111" }, { name: "X", fortCount: 3, id: null }, { name: "X", fortCount: 2, id: null }];
  assert.deepEqual(governorsTwice(rows), ["111"]);
});

test("a Fort Week starts on a Monday; any other day or a malformed date is refused", () => {
  assert.equal(isFortWeekStart("2026-11-02"), true);
  assert.equal(isFortWeekStart("2026-11-03"), false);
  assert.equal(isFortWeekStart("2026-11-2"), false);
  assert.equal(isFortWeekStart(""), false);
});

// The Live Week: the Fort Week the moment falls in, until the Monday reset closes it.
test("on Sunday 15 Nov at 23:59 UTC the week of 9 Nov is the Live Week and the week of 2 Nov is closed", () => {
  const now = new Date("2026-11-15T23:59:00Z");
  assert.deepEqual([isLiveWeek("2026-11-09", now), isLiveWeek("2026-11-02", now)], [true, false]);
});

test("Fort Average leaves the Live Week out until the Monday reset closes it", () => {
  const weeks = [{ start: "2026-11-02", entries: [entry("g", 10)] }, { start: "2026-11-09", entries: [entry("g", 2)] }];
  assert.deepEqual(fortAverage(weeks, "g", new Date("2026-11-10T12:00:00Z")), { average: 10, weeksCounted: 1 });
});

// The shared name-matching cases: the same file runs against record_live_week in Postgres.
const shared = JSON.parse(readFileSync(new URL("./name-matching-cases.json", import.meta.url), "utf8"));
for (const c of shared.cases) {
  test(`shared matching case: ${c.case}`, () => {
    const seen = namesToMatch(c.governors, c.nameHistory.map((n) => ({ character_id: n.id, name: n.name })));
    assert.deepEqual(liveReadingIds(c.rows, seen), c.ids);
  });
  // record_live_week gives nextIds once the Picks are in Name History; checkPicks must refuse exactly the
  // Picks that would not stick.
  if (c.picks) test(`shared Pick case: ${c.case}`, () => {
    const seen = namesToMatch(c.governors, c.nameHistory.map((n) => ({ character_id: n.id, name: n.name })));
    const rows = c.rows.map((r, i) => ({ ...r, id: c.ids[i] }));
    const refused = c.picks.filter((p) => checkPicks({ week: "2026-11-16", rows, picks: [p], nameHistory: seen, governors: c.governors, liveWeek: "2026-11-16", now: tue17 }).problem);
    assert.deepEqual(refused, c.picks.filter((p) => c.nextIds[p.row] !== p.id));
  });
}

// What the Live Week's rows would be at the reader's next reading: the admin blocks a pick that would not stick.
test("a Council pick sticks at the next reading only for a name one row holds and no other Governor has", () => {
  const seen = [{ id: "1", name: "Known" }, { id: "2", name: "Shared" }, { id: "3", name: "Shared" }];
  const pick = (name, id) => [...seen, { id, name }];
  // An unknown name picked for Governor 9: the next reading matches it.
  assert.deepEqual(liveReadingIds([{ name: "Odd", fortCount: 5 }], pick("Odd", "9")), ["9"]);
  // A name two Governors already hold: picking one of them changes nothing.
  assert.deepEqual(liveReadingIds([{ name: "Shared", fortCount: 5 }], seen), [null]);
  // A name on two rows: picks for both still leave both "needs ID".
  assert.deepEqual(liveReadingIds([{ name: "Twin", fortCount: 5 }, { name: "Twin", fortCount: 4 }], [...pick("Twin", "8"), { id: "9", name: "Twin" }]), [null, null]);
  // A row read two ways: a pick for one of its spellings matches it, unless another spelling is someone else's.
  assert.deepEqual(liveReadingIds([{ name: "Odd", fortCount: 5, names: ["Odd", "Οdd"] }], pick("Odd", "9")), ["9"]);
  assert.deepEqual(liveReadingIds([{ name: "Odd", fortCount: 5, names: ["Odd", "Known"] }], pick("Odd", "9")), [null]);
});

// Picks: the Council's choice of Governor for a "needs ID" row of a read Fort Week. On Tuesday 17 Nov
// the Live Week is the week of 16 Nov and the week of 9 Nov is closed.
const tue17 = new Date("2026-11-17T12:00:00Z");
const readRows = [{ id: "1", name: "Known", fortCount: 9 }, { id: null, name: "Odd", fortCount: 5 }, { id: null, name: "Other", fortCount: 3 }];
const picksOn = (week, picks, extra = {}) => checkPicks({ week, rows: readRows, picks, nameHistory: [{ id: "1", name: "Known" }],
  governors: [gov("1", "Known"), gov("9", "Real Nine"), gov("8", "Real Eight")], liveWeek: "2026-11-16", now: tue17, ...extra });

test("a Pick puts the row's name into Name History under the picked Governor, on a closed week or the Live Week", () => {
  assert.deepEqual(picksOn("2026-11-09", [{ row: 1, id: "9" }]),
    { live: false, problem: null, nothingYet: false, newNames: [{ id: "9", name: "Odd", firstSeen: "2026-11-09" }] });
  assert.deepEqual(picksOn("2026-11-16", [{ row: 1, id: "9" }]),
    { live: true, problem: null, nothingYet: false, newNames: [{ id: "9", name: "Odd", firstSeen: "2026-11-16" }] });
});

test("with no Picks there is nothing to save yet, on a closed week or the Live Week", () => {
  for (const week of ["2026-11-09", "2026-11-16"]) {
    const out = picksOn(week, []);
    assert.deepEqual([out.problem, out.nothingYet, out.newNames], ['Pick a Governor for a "needs ID" row first.', true, []]);
  }
});

test("the page treats the week its reading was loaded for as the Live Week, and the week now in progress too", () => {
  assert.deepEqual([picksOn("2026-11-16", []).live, picksOn("2026-11-09", []).live], [true, false]);
  // Loaded on Sunday 15 Nov, still open on Tuesday: both weeks are live here, and the reset has passed.
  assert.deepEqual([picksOn("2026-11-09", [], { liveWeek: "2026-11-09" }).live, picksOn("2026-11-16", [], { liveWeek: "2026-11-09" }).live], [true, true]);
});

test("a Pick is refused on a date that is not a Monday", () => {
  assert.equal(picksOn("2026-11-10", [{ row: 1, id: "9" }]).problem, "2026-11-10 is not a Monday. A Fort Week starts on Monday.");
});

test("a Live Week Pick is refused once the Monday reset has passed since the page loaded", () => {
  const out = picksOn("2026-11-09", [{ row: 1, id: "9" }], { liveWeek: "2026-11-09" });
  assert.deepEqual([out.problem, out.nothingYet], ["The Monday reset has passed since this page loaded, so its reading is out of date. Reload the page.", false]);
});

test("a Pick for a Governor already on the week, or the same Governor Picked twice, is refused on either week", () => {
  for (const week of ["2026-11-09", "2026-11-16"]) {
    assert.equal(picksOn(week, [{ row: 1, id: "1" }]).problem, "Known is on more than one row. A Governor appears once per Fort Week.");
    const twice = picksOn(week, [{ row: 1, id: "9" }, { row: 2, id: "9" }]);
    assert.deepEqual([twice.problem, twice.nothingYet], ["Real Nine is on more than one row. A Governor appears once per Fort Week.", false]);
  }
});

test("a Live Week Pick the next reading would not match is refused; on a closed week the same Pick goes through", () => {
  // "Other" is already a name of Governor 8 and Governor 7, so the reading could not match it, and after a
  // Pick for 9 the next reading still finds more than one Governor. "Odd" Picked for 9 would stick.
  const held = { nameHistory: [{ id: "1", name: "Known" }, { id: "8", name: "Other" }, { id: "7", name: "Other" }] };
  assert.equal(picksOn("2026-11-16", [{ row: 1, id: "9" }, { row: 2, id: "8" }], held).problem,
    'Other would still be "needs ID" at the next reading: its name is on another row, as written or as read, or already belongs to another Governor. Clear the Pick and Pick it again once the week closes.');
  // A name another row was only read as: the next reading could not tell the two apart either.
  const misread = [...readRows, { id: null, name: "0dd", fortCount: 2, names: ["0dd", "Odd"] }];
  assert.match(picksOn("2026-11-16", [{ row: 1, id: "9" }], { rows: misread }).problem, /^Odd would still be "needs ID"/);
  assert.equal(picksOn("2026-11-09", [{ row: 2, id: "8" }], held).problem, null);
});

// The shared closed-week Pick cases: the same file runs against pick_governor in Postgres.
const pickCases = JSON.parse(readFileSync(new URL("./pick-cases.json", import.meta.url), "utf8"));
for (const c of pickCases.cases) {
  test(`shared closed-week Pick case: ${c.case}`, () => {
    const out = checkPicks({ week: "2026-11-09", rows: c.rows, picks: c.picks, nameHistory: [...c.nameHistory, ...c.governors],
      governors: c.governors, liveWeek: "2026-11-16", now: tue17 });
    assert.deepEqual([out.problem, out.newNames], [null, c.newNames.map((n) => ({ ...n, firstSeen: "2026-11-09" }))]);
  });
}

// Weekly Awards: { week, id, place, award, note }. Governors carry their kind.
const award = (id, place = 1, week = "2026-11-02", text = "Legendary King's Chest") => ({ week, id, place, award: text, note: "" });
const awardees = [gov("1", "TasteMyFat"), gov("2", "TasteMyFatFarm", "farm", "1")];
const afterWeek = Date.parse("2026-11-10T12:00:00Z");

test("a Farm cannot receive a Weekly Award", () => {
  assert.match(checkWeeklyAward(award("2"), awardees, afterWeek), /Farm/);
});

test("a Weekly Award needs a Governor on record, picked by Character ID", () => {
  assert.match(checkWeeklyAward(award("99"), awardees, afterWeek), /not on record/);
});

test("a Weekly Award waits until the Monday reset closes its Fort Week", () => {
  const sundayNight = Date.parse("2026-11-08T23:59:00Z");
  assert.match(checkWeeklyAward(award("1"), awardees, sundayNight), /Live Week/);
  // A Fort Week after the Live Week has not even started, so it cannot be awarded either.
  assert.match(checkWeeklyAward(award("1", 1, "2026-11-16"), awardees, afterWeek), /not started/);
  assert.match(checkWeeklyAward(award("1", 1, "2026-11-09"), awardees, afterWeek), /Live Week/);
});

test("a Weekly Award needs a place from 1 up and the award's text", () => {
  assert.deepEqual([award("1", 0), award("1", 1.5), award("1", 2, undefined, "  ")].map((a) => Boolean(checkWeeklyAward(a, awardees, afterWeek))), [true, true, true]);
  assert.equal(checkWeeklyAward(award("1", 2), awardees, afterWeek), null);
});

test("Weekly Awards group by Fort Week, the latest week first and each week in place order", () => {
  const awards = [award("1", 2, "2026-10-26"), award("3", 1, "2026-11-02"), award("4", 1, "2026-10-26"), award("5", 2, "2026-11-02")];
  assert.deepEqual(awardsByWeek(awards).map((w) => [w.week, w.awards.map((a) => a.id)]), [["2026-11-02", ["3", "5"]], ["2026-10-26", ["4", "1"]]]);
});

test("a Governor's popup lists only their Weekly Awards, the latest first", () => {
  const awards = [award("1", 3, "2026-10-26"), award("4", 1, "2026-11-02"), award("1", 1, "2026-11-02")];
  assert.deepEqual(awardsOf(awards, "1").map((a) => [a.week, a.place]), [["2026-11-02", 1], ["2026-10-26", 3]]);
});

const fortWeek = (start, ...entries) => ({ start, completeness: "complete", entries });

test("home shows the Live Week once it has a ranked row", () => {
  const now = "2026-11-14T12:00:00Z";
  const weeks = [fortWeek("2026-11-02", entry("a", 30)), fortWeek("2026-11-09", entry("b", 4))];
  assert.equal(homeWeek(weeks, now), 1);
});

test("home shows the last closed Fort Week while the Live Week has no rows, or there is none", () => {
  const now = "2026-11-14T12:00:00Z";
  const closed = [fortWeek("2026-10-26", entry("a", 12)), fortWeek("2026-11-02", entry("a", 30))];
  assert.deepEqual([homeWeek(closed, now), homeWeek([...closed, fortWeek("2026-11-09")], now)], [1, 1]);
});

test("an award item's amount is typed as a plain number or with a K or M suffix", () => {
  assert.deepEqual(["2", "2M", "1.5m", "2.07M", "500K", "1,200,000"].map(parseAwardAmount), [2, 2000000, 1500000, 2070000, 500000, 1200000]);
});

test("an award item's amount is a whole number above 0", () => {
  assert.deepEqual(["0", "0K", "", "abc", "-2", "1.5", "2B"].map(parseAwardAmount), [null, null, null, null, null, null, null]);
});

test("a King's Chest's amount reads as a count", () => {
  assert.equal(awardAmountLabel("chest-epic", 2), "×2");
});

test("a resource's amount reads with K and M", () => {
  assert.deepEqual([[2000000], [1500000], [500000], [750]].map(([n]) => awardAmountLabel("rss-food", n)), ["2M", "1.5M", "500K", "750"]);
});

test("a Weekly Award built from reward items needs no text", () => {
  const items = [{ item: "chest-legendary", amount: 1 }, { item: "rss-food", amount: 2000000 }];
  assert.equal(checkWeeklyAward({ ...award("1", 1, "2026-11-02", ""), items }, awardees, afterWeek), null);
});

test("a Weekly Award refuses an item not on the list and an amount of 0 or less", () => {
  const withItem = (item, amount) => ({ ...award("1"), items: [{ item, amount }] });
  assert.deepEqual([withItem("chest-mythic", 1), withItem("rss-gold", 0), withItem("rss-gold", -5), withItem("rss-gold", 1.5)].map((a) => Boolean(checkWeeklyAward(a, awardees, afterWeek))), [true, true, true, true]);
});

test("a King's Chest's amount is a plain count, never K or M", () => {
  assert.deepEqual([["3", "chest"], ["2M", "chest"], ["2M", "resource"]].map(([t, kind]) => parseAwardAmount(t, kind)), [3, null, 2000000]);
});

test("an award item's amount past what the page can hold exactly is refused", () => {
  assert.deepEqual(["12345678901234567", "99999999999999999999K"].map((t) => parseAwardAmount(t)), [null, null]);
});

test("a resource's amount that rounds up to the next unit reads in that unit", () => {
  assert.deepEqual([999999, 999999999].map((n) => awardAmountLabel("rss-wood", n)), ["1M", "1000M"]);
});

test("an edit form prefills an amount it can save back unchanged, never a rounded label", () => {
  assert.deepEqual([2000000, 1500000, 500000, 750].map((n) => awardAmountInput("rss-food", n)), ["2M", "1.5M", "500K", "750"]);
  assert.deepEqual([1234567, 999999].map((n) => awardAmountInput("rss-food", n)), ["1234567", "999999"]);
  assert.equal(awardAmountInput("chest-epic", 2), "2");
  for (const n of [1234567, 999999, 2070000]) assert.equal(parseAwardAmount(awardAmountInput("rss-gold", n)), n);
});

// Reward Promises. 2026-11-14 is a Saturday in the Fort Week of Monday 9 Nov.
const inWeek = Date.parse("2026-11-14T12:00:00Z");
const promise = (week, ...tiers) => ({ week, intro: null, paidOn: "mains", tiers });
const tier = (place, items = [], reward = null) => ({ place, items, reward });

test("a Reward Promise can be set for the Live Week and later weeks, never a closed one", () => {
  const p = (w) => promise(w, tier(1, [{ item: "chest-legendary", amount: 1 }]));
  assert.equal(checkRewardPromise(p("2026-11-09"), inWeek), null);
  assert.equal(checkRewardPromise(p("2026-11-16"), inWeek), null);
  assert.match(checkRewardPromise(p("2026-11-02"), inWeek), /closed/);
  assert.match(checkRewardPromise(p("2026-11-10"), inWeek), /Monday/);
});

test("each place on a Reward Promise needs items or text, with whole amounts above 0", () => {
  const w = "2026-11-09";
  assert.match(checkRewardPromise(promise(w), inWeek), /at least one place/);
  assert.match(checkRewardPromise(promise(w, tier(1)), inWeek), /1st: pick a reward item/);
  assert.equal(checkRewardPromise(promise(w, tier(10, [], "A shout-out")), inWeek), null);
  assert.match(checkRewardPromise(promise(w, tier(1, [{ item: "gems", amount: 1 }])), inWeek), /not a reward item/);
  assert.match(checkRewardPromise(promise(w, tier(2, [{ item: "chest-epic", amount: null }])), inWeek), /2nd: the amount of Epic Chest is a count/);
  assert.match(checkRewardPromise(promise(w, tier(2, [{ item: "rss-gold", amount: 0 }])), inWeek), /500K or 2M/);
});

test("home shows only the Live Week's Reward Promise", () => {
  const all = [promise("2026-11-02", tier("1st", [], "old")), promise("2026-11-09", tier("1st", [], "now")), promise("2026-11-16", tier("1st", [], "next"))];
  assert.equal(livePromise(all, inWeek).week, "2026-11-09");
  assert.equal(livePromise(all.filter((p) => p.week !== "2026-11-09"), inWeek), null);
});

test("a week with no Reward Promise starts from the latest one before it", () => {
  const all = [promise("2026-10-26"), promise("2026-11-02"), promise("2026-11-23")];
  assert.equal(promiseToStartFrom(all, "2026-11-02").week, "2026-11-02");
  assert.equal(promiseToStartFrom(all, "2026-11-16").week, "2026-11-02");
  assert.equal(promiseToStartFrom(all, "2026-10-19"), null);
});

test("a place reads as an ordinal: 1st, 2nd, 3rd, 11th, 22nd", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111, 112].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th", "112th"]);
});

test("a promise tier pays one place, a whole number from 1 to 1000", () => {
  const w = "2026-11-09", gold = [{ item: "rss-gold", amount: 1e6 }];
  assert.deepEqual([tier(0, gold), tier(1.5, gold), tier(null, gold), tier(1001, gold), tier("6", gold)].map((t) => checkRewardPromise(promise(w, t), inWeek)).map((m) => /Place 1: its place is a whole number from 1 to 1000/.test(m)), [true, true, true, true, true]);
  assert.equal(checkRewardPromise(promise(w, tier(1000, gold)), inWeek), null);
});

test("two tiers of one promise can't pay the same place, but a gap is allowed", () => {
  const w = "2026-11-09", gold = [{ item: "rss-gold", amount: 1e6 }];
  assert.match(checkRewardPromise(promise(w, tier(1, gold), tier(6, gold), tier(6, gold)), inWeek), /6th is promised twice/);
  assert.equal(checkRewardPromise(promise(w, tier(1, gold), tier(2, gold), tier(6, gold)), inWeek), null);
  const fifteen = Array.from({ length: 15 }, (_, i) => tier(i + 1, gold));
  assert.equal(checkRewardPromise(promise(w, ...fifteen), inWeek), null);
});

// Fill: a closed week's Weekly Awards drafted from its Reward Promise and the ranking it pays on.
const gold = (m) => [{ item: "rss-gold", amount: m * 1e6 }];

test("Fill gives the Main at each promised place that tier's items", () => {
  const governors = [main("a"), main("b"), main("c")];
  const ranking = mainsRanking([entry("a", 40), entry("b", 30), entry("c", 20)], governors);
  const { awards, skipped } = fillWeeklyAwards(promise("2026-11-02", tier(1, gold(5)), tier(2, gold(3), "and a shout-out")), ranking);
  assert.deepEqual(awards, [
    { id: "a", place: 1, items: [{ item: "rss-gold", amount: 5e6 }], award: null },
    { id: "b", place: 2, items: [{ item: "rss-gold", amount: 3e6 }], award: "and a shout-out" },
  ]);
  assert.deepEqual(skipped, []);
});

test("Fill gives Mains tied on forts consecutive places in the Council's tie order", () => {
  const governors = [main("a"), main("b"), main("c")];
  const ranking = mainsRanking([entry("b", 30), entry("a", 30), entry("c", 20)], governors);
  const { awards } = fillWeeklyAwards(promise("2026-11-02", tier(1, gold(5)), tier(2, gold(3)), tier(3, gold(1))), ranking);
  assert.deepEqual(awards.map((a) => [a.id, a.place]), [["b", 1], ["a", 2], ["c", 3]]);
});

test('Fill skips "needs ID" rows and unlinked Farms, moves the next Main up and lists each skip', () => {
  const governors = [main("a"), main("b"), main("c"), farm("u")];
  const ranking = mainsRanking([entry("a", 40), { id: null, name: "Nameless", fortCount: 35 }, entry("u", 32), entry("b", 30), entry("c", 20)], governors, { withFarms: true });
  const { awards, skipped } = fillWeeklyAwards(promise("2026-11-02", tier(1, gold(5)), tier(2, gold(3)), tier(3, gold(1))), ranking);
  assert.deepEqual(awards.map((a) => [a.id, a.place]), [["a", 1], ["b", 2], ["c", 3]]);
  assert.deepEqual(skipped, [{ name: "Nameless", reason: "needs ID" }, { name: "Gov u", reason: "unlinked Farm" }]);
});

test("Fill pays nothing for a promised place past the end of the ranking, nor for a gap", () => {
  const governors = [main("a"), main("b"), main("c")];
  const ranking = mainsRanking([entry("a", 40), entry("b", 30), entry("c", 20)], governors);
  const { awards } = fillWeeklyAwards(promise("2026-11-02", tier(1, gold(5)), tier(3, gold(1)), tier(10, gold(1))), ranking);
  assert.deepEqual(awards.map((a) => [a.id, a.place]), [["a", 1], ["c", 3]]);
});

test("Fill on the Main + Farm ranking pays the Mains in Group Score order, never a Farm under its Main", () => {
  const governors = [main("a"), main("b"), farm("f1", "b"), farm("f2", "b")];
  const ranking = mainsRanking([entry("a", 35), entry("b", 30), entry("f1", 10), entry("f2", 10)], governors, { withFarms: true });
  const { awards, skipped } = fillWeeklyAwards({ ...promise("2026-11-02", tier(1, gold(5)), tier(2, gold(3)), tier(3, gold(1))), paidOn: "main_farm" }, ranking);
  assert.deepEqual(awards.map((a) => [a.id, a.place]), [["b", 1], ["a", 2]]);
  assert.deepEqual(skipped, []);
});
