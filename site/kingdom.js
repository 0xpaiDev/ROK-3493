// Kingdom rules: pure functions over plain data. No DOM, no network.
import { rewardItem } from "./rewards.js";

// Weekly Ranking: highest Fort Count first. Ties keep the stored order and share a rank number.
export function rankWeek(entries) {
  const sorted = [...entries].sort((a, b) => b.fortCount - a.fortCount);
  return sorted.map((e) => ({ ...e, rank: 1 + sorted.findIndex((x) => x.fortCount === e.fortCount) }));
}

// Fort Average for one Governor, or null if never ranked. Weeks are in date order.
// The window starts at the Governor's first ranked Fort Week. A Complete Week they are
// missing from counts as 0; a Partial Week counts only when they are ranked in it.
// A week with no completeness set is Complete. The Live Week at `now` is left out until it closes.
export function fortAverage(weeks, characterId, now = Date.now()) {
  weeks = weeks.filter((w) => !isLiveWeek(w.start, now));
  const entryPerWeek = weeks.map((w) => w.entries.find((e) => e.id === characterId));
  const first = entryPerWeek.findIndex(Boolean);
  if (first < 0) return null;
  const counts = entryPerWeek
    .map((e, i) => (e ? e.fortCount : weeks[i].completeness === "partial" ? null : 0))
    .slice(first)
    .filter((n) => n !== null);
  return { average: counts.reduce((a, b) => a + b, 0) / counts.length, weeksCounted: counts.length };
}

// A Fort Week runs from Monday's reset to the next one; its last day is the Sunday.
export function fortWeekEnd(startsOn) {
  const t = new Date(startsOn + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + 6);
  return t.toISOString().slice(0, 10);
}

// The Fort Week a moment falls in: its Monday start and the reset that closes it, the
// Monday 00:00 UTC after fortWeekEnd().
export function fortWeekAt(now) {
  const t = new Date(now);
  t.setUTCHours(0, 0, 0, 0);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  const start = t.toISOString().slice(0, 10);
  const resetsAt = new Date(fortWeekEnd(start) + "T00:00:00Z");
  resetsAt.setUTCDate(resetsAt.getUTCDate() + 1);
  return { start, end: fortWeekEnd(start), resetsAt };
}

// Whether a date (YYYY-MM-DD) is a Monday, the day a Fort Week starts.
export function isFortWeekStart(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && fortWeekAt(day + "T12:00:00Z").start === day;
}

// The Live Week: the Fort Week a moment falls in, whose Weekly Ranking the reader still refreshes.
// It closes at the Monday reset. Comes from the date, never from a stored flag.
export function isLiveWeek(startsOn, now) {
  return fortWeekAt(now).start === startsOn;
}

// A Fort Week the Monday reset has closed: it started before the Live Week. A later week has not even begun.
export function isClosedWeek(startsOn, now) {
  return startsOn < fortWeekAt(now).start;
}

// The Fort Week the home page shows, as an index into `weeks` (date order): the Live Week
// once it has a ranked row, otherwise the last closed Fort Week; -1 when there is neither.
// A week that has not begun is never shown.
export function homeWeek(weeks, now) {
  const live = weeks.findIndex((w) => isLiveWeek(w.start, now) && w.entries.length > 0);
  return live >= 0 ? live : weeks.findLastIndex((w) => isClosedWeek(w.start, now));
}

// "Find your Governor": the ranked entries whose Governor has ever gone by a name containing
// the query (Name History, by Character ID), or whose Character ID contains it. Case-insensitive.
export function findInRanking(ranked, nameHistory, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const names = (id) => nameHistory.filter((n) => n.id === id).map((n) => n.name);
  return ranked.filter((e) => e.id?.includes(q) || [e.name, ...names(e.id)].some((n) => n.toLowerCase().includes(q)));
}

// Farm link suggestions: candidate Farm→Main pairs where one Governor's name is a Main's
// name with a Farm marker added. Suggestions only; nothing is linked without the Council.
const FARM_MARKER = /^(farm|f)?\s*\d*$/;
// A name that already ends like a Farm ("Enes farm", "cciell f4") is not offered as a Main.
const FARM_SHAPED = /(farm|\sf)\s*\d*$/i;

export function farmLinkSuggestions(governors, dismissed = []) {
  const gone = new Set(dismissed.map((d) => d.farmId + ">" + d.mainId));
  const out = [];
  for (const farm of governors) {
    for (const main of governors) {
      if (farm === main || gone.has(farm.id + ">" + main.id) || farm.kind === "farm" || main.kind === "farm" || FARM_SHAPED.test(main.name)) continue;
      const name = farm.name.toLowerCase(), base = main.name.toLowerCase();
      if (!name.startsWith(base)) continue;
      const rest = name.slice(base.length);
      // A digit glued onto a name ending in a digit continues the number (FKK1 → FKK10).
      if (/\d$/.test(base) && /^\d/.test(rest)) continue;
      if (rest.trim() && FARM_MARKER.test(rest.trim())) out.push({ farmId: farm.id, mainId: main.id, reason: `${main.name} + ${farm.name.slice(base.length).trim()}` });
    }
  }
  return out;
}

// Top 200: the Character IDs of the 200 highest-power Governors in a snapshot's rows.
export function top200(rows) {
  return [...rows].sort((a, b) => (b.power ?? 0) - (a.power ?? 0)).slice(0, 200).map((r) => r.id);
}

// Apply a Roster Snapshot: what a new Lilith stats export changes. Takes the Governors (with
// status), Name History, the previous snapshot's rows and the new snapshot. Returns the changes;
// nothing is saved here.
export function applyRosterSnapshot({ governors, nameHistory, previous, snapshot }) {
  const present = new Set(snapshot.rows.map((r) => r.id));
  const wasTop200 = new Set(top200(previous ?? []));
  // The export covers its whole day, so the snapshot's moment is the midnight that ends it.
  // Status precedence: the latest event wins, so a Council change made after that stands.
  const at = new Date(snapshot.takenOn + "T00:00:00Z");
  at.setUTCDate(at.getUTCDate() + 1);
  const statusChanges = [];
  for (const g of governors) {
    if (g.statusSetBy === "council" && new Date(g.statusSetAt) >= at) continue;
    // The export also leaves out inactive Governors, so absence means Inactive, never Migrated:
    // only the Council marks a Governor Migrated.
    if (g.status === "current" && wasTop200.has(g.id) && !present.has(g.id)) statusChanges.push({ id: g.id, name: g.name, to: "inactive" });
    else if (g.status !== "current" && present.has(g.id)) statusChanges.push({ id: g.id, name: g.name, to: "current" });
  }
  const known = new Set(governors.map((g) => g.id));
  const seen = seenPairs(nameHistory);
  const newGovernors = snapshot.rows.filter((r) => !known.has(r.id)).map((r) => ({ id: r.id, name: r.name }));
  const newNames = snapshot.rows
    .filter((r) => !isSeen(seen, r))
    .map((r) => ({ id: r.id, name: r.name, firstSeen: snapshot.takenOn }));
  const byId = new Map(governors.map((g) => [g.id, g]));
  const renames = snapshot.rows
    .filter((r) => byId.has(r.id) && byId.get(r.id).name !== r.name)
    .map((r) => ({ id: r.id, from: byId.get(r.id).name, to: r.name }));
  return { statusChanges, statusSetAt: at.toISOString(), newGovernors, renames, newNames, top200: top200(snapshot.rows) };
}

// Lilith stats export: one sheet, header on row 1, every value text. The filename carries the date
// (3493_YYYYMMDD_…). Takes the filename and the sheet's rows as arrays of cells; columns are found
// by header name. Throws with a sentence the Council can act on.
const EXPORT_COLUMNS = {
  id: "Character ID", name: "Username", power: "Power", highestPower: "Highest Power",
  killPoints: "Total Kill Points", resources: "Resources Gathered", allianceHelps: "Alliance Helps",
};

export function parseStatsExport(filename, cells) {
  const date = filename.match(/^3493_(\d{4})(\d{2})(\d{2})_/);
  if (!date) throw new Error(`"${filename}" is not named like a Lilith stats export (3493_YYYYMMDD_…).`);
  const header = (cells[0] ?? []).map((h) => String(h ?? "").trim());
  const col = {};
  for (const [key, title] of Object.entries(EXPORT_COLUMNS)) {
    col[key] = header.indexOf(title);
    if (col[key] < 0) throw new Error(`The export has no "${title}" column on row 1.`);
  }
  const text = (row, key) => String(row[col[key]] ?? "").trim();
  const num = (row, key) => {
    const t = text(row, key).replace(/,/g, "");
    if (t === "") return null;
    if (!/^\d+$/.test(t)) throw new Error(`Row ${cells.indexOf(row) + 1}: ${EXPORT_COLUMNS[key]} "${text(row, key)}" is not a number.`);
    return Number(t);
  };
  const rows = cells.slice(1).filter((r) => text(r, "id")).map((r) => ({
    id: /^\d+$/.test(text(r, "id")) ? text(r, "id") : num(r, "id"), name: text(r, "name"),
    power: num(r, "power"), highestPower: num(r, "highestPower"), killPoints: num(r, "killPoints"),
    resources: num(r, "resources"), allianceHelps: num(r, "allianceHelps"),
  }));
  return { takenOn: `${date[1]}-${date[2]}-${date[3]}`, rows };
}

// Mains ranking for a Fort Week. Governors are { id, name, kind, mainId }; a Farm's mainId is its
// Farm link. By default Mains rank on their own Fort Counts and Farms are left out. withFarms
// attaches each Main's Farms, adds their Fort Counts to the Main's (`own` keeps the Main's), and
// reranks the Mains on that sum.
// A ranked Governor not on record ("needs ID") counts as a Main.
export function mainsRanking(entries, governors, { withFarms = false } = {}) {
  const farmOf = new Map(governors.filter((g) => g.kind === "farm").map((g) => [g.id, g.mainId]));
  const mains = rankWeek(entries.filter((e) => !farmOf.has(e.id)));
  if (!withFarms) return mains;
  // A "needs ID" entry has no Character ID, so it can never be any Farm's Main.
  const farmsOf = (id) => (id == null ? [] : entries.filter((e) => farmOf.has(e.id) && farmOf.get(e.id) === id));
  const ranked = new Set(mains.map((m) => m.id));
  // A Main with 0 forts still gets a row when a Farm of its has forts, so the Farm has somewhere to sit.
  const idle = governors
    .filter((g) => g.kind !== "farm" && !ranked.has(g.id) && farmsOf(g.id).length)
    .map((g) => ({ id: g.id, name: g.name, fortCount: 0 }));
  // A Main's Fort Count here is its own plus its Farms'; the Mains rank on that sum.
  // Entry order stays the tie-break, so Mains tied on the sum keep the Council's order.
  const sums = [...entries.filter((e) => !farmOf.has(e.id)), ...idle].map((m) => {
    const farms = farmsOf(m.id);
    return { ...m, own: m.fortCount, fortCount: m.fortCount + farms.reduce((a, f) => a + f.fortCount, 0), farms };
  });
  // An unlinked Farm is its own row in Fort Count order, with no rank: Mains rank only among Mains.
  const unlinked = entries
    .filter((e) => farmOf.has(e.id) && !farmOf.get(e.id))
    .map((e) => ({ ...e, rank: null, unlinked: true, farms: [] }));
  return [...rankWeek(sums), ...unlinked].sort((x, y) => y.fortCount - x.fortCount);
}

// Each Character ID + name pair already in Name History, to tell which names are new.
const seenPairs = (nameHistory) => new Set(nameHistory.map((n) => n.id + "|" + n.name));
const isSeen = (seen, r) => seen.has(r.id + "|" + r.name);

// The names a pasted Fort Week is matched against: Name History { character_id, name } plus each
// Governor's current name { id, name }, which counts as seen before a Roster Snapshot adds it.
export function namesToMatch(governors, nameHistory) {
  return [...nameHistory.map((n) => ({ id: n.character_id, name: n.name })), ...governors];
}

// Name matching for a pasted Fort Week. Takes rows { name, fortCount } and Name History { id, name }.
// Returns each row with the Character ID its name has been seen under, or id null ("needs ID").
// A name seen under more than one Character ID is never guessed between, and a name pasted twice
// leaves every row with it "needs ID": the rows stay apart until the Council picks each Governor.
export function matchNames(rows, nameHistory) {
  const idsOf = (name) => new Set(nameHistory.filter((n) => n.name === name).map((n) => n.id));
  const pastedTwice = (name) => rows.filter((r) => r.name === name).length > 1;
  return rows.map((r) => {
    const ids = idsOf(r.name);
    return { ...r, id: ids.size === 1 && !pastedTwice(r.name) ? [...ids][0] : null };
  });
}

// The Character IDs record_live_week gives a reading's rows (supabase/migrations, the newest Live Week one):
// matchNames, except a row the reader read two ways (needsId) is never matched by spelling, and two rows
// whose names lead to one Governor both stay "needs ID". Rows { name, fortCount, needsId? } in reading order.
export function liveReadingIds(rows, nameHistory) {
  const ids = matchNames(rows, nameHistory).map((r, i) => (rows[i].needsId ? null : r.id));
  return ids.map((id) => (id != null && ids.filter((other) => other === id).length > 1 ? null : id));
}

// Pasted Fort Week rows: one Governor per line, the name then its Fort Count as the last number
// on the line (spaces or a tab between, thousands commas allowed). Blank lines are skipped.
export function parseFortRows(text) {
  return text.split(/\r?\n/).flatMap((line, i) => {
    if (!line.trim()) return [];
    const m = line.trim().match(/^(.*\S)\s+([\d,]+)$/);
    if (!m) throw new Error(`Line ${i + 1} has no Fort Count at the end: "${line.trim()}".`);
    return [{ name: m[1], fortCount: Number(m[2].replace(/,/g, "")) }];
  });
}

// The Character IDs on more than one row of a Fort Week. A week holds each Governor once, so these
// block saving. "needs ID" rows have no Character ID yet and never count as the same Governor.
export function governorsTwice(rows) {
  const ids = rows.map((r) => r.id).filter((id) => id != null);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

// Tie order: rows in ranking order; the row at index moves one place up (step -1) or down (+1),
// only past a row with the same Fort Count. The resulting order is the Council's tie order.
export function moveInTie(rows, index, step) {
  const other = index + step;
  if (rows[other]?.fortCount !== rows[index].fortCount) return rows;
  const out = [...rows];
  [out[index], out[other]] = [out[other], out[index]];
  return out;
}

// Names a saved Fort Week adds to Name History: a pasted name on a row with a Character ID that the
// Governor was not yet seen under (the Council picked it). firstSeen is the Fort Week's Monday.
export function newFortNames(rows, nameHistory, week) {
  const seen = seenPairs(nameHistory);
  return rows.filter((r) => r.id != null && !isSeen(seen, r)).map((r) => ({ id: r.id, name: r.name, firstSeen: week }));
}

// Weekly Awards: { week, id, place, award, note, items }, a Fort Week's Monday and the Main's Character ID.
// items are [{ item, amount }], item an id from site/rewards.js; award is free text, optional once there are items.
// Why an award can't be saved, as a sentence for the Council, or null when it can. Farms never receive one.
export function checkWeeklyAward(award, governors, now = Date.now()) {
  const g = governors.find((x) => x.id === award.id);
  if (!g) return award.id ? `Character ID ${award.id} is not on record. Pick the Main from the list.` : "Pick the Main from the list.";
  if (g.kind === "farm") return `${g.name} is a Farm. A Weekly Award goes to a Main.`;
  // The Council gives Weekly Awards after a Fort Week, once its Weekly Ranking is final.
  if (isLiveWeek(award.week, now)) return "This is the Live Week. Weekly Awards are given once the Monday reset closes it.";
  if (!isClosedWeek(award.week, now)) return "This Fort Week has not started yet. Weekly Awards are given once the Monday reset closes it.";
  if (!Number.isInteger(award.place) || award.place < 1) return "The place is a whole number from 1 up.";
  const items = award.items ?? [];
  const unknown = items.find((x) => !rewardItem(x.item));
  if (unknown) return `"${unknown.item}" is not a reward item. Pick a King's Chest or a resource from the list.`;
  const bad = items.find((x) => !Number.isInteger(x.amount) || x.amount < 1);
  if (bad) return rewardItem(bad.item).kind === "chest"
    ? `The amount of ${rewardItem(bad.item).name} is a count from 1 up, for example 2.`
    : `The amount of ${rewardItem(bad.item).name} is a whole number above 0, for example 500K or 2M.`;
  // The reward items are the award; the text is the fallback for anything outside the list.
  if (!items.length && !award.award?.trim()) return "Write what the award is, for example the King's Chests it gives.";
  return null;
}

// Weekly Awards by Fort Week: [{ week, awards }], the latest week first, each week in place order
// (equal places keep the order they were given in). The home page shows the first; past winners are all of them.
export function awardsByWeek(awards) {
  const weeks = [...new Set(awards.map((a) => a.week))].sort().reverse();
  return weeks.map((week) => ({ week, awards: awards.filter((a) => a.week === week).sort((a, b) => a.place - b.place) }));
}

// One Governor's Weekly Awards, by Character ID, the latest Fort Week first.
export function awardsOf(awards, characterId) {
  return awardsByWeek(awards.filter((a) => a.id === characterId)).flatMap((w) => w.awards);
}

// An award item's amount as the Council types it: a whole number, or for a resource a number with a
// K or M suffix ("2M", "1.5k"), thousands commas allowed. A King's Chest (kind "chest") takes a plain
// count, so a stray "2M" is never two million chests. Null when it is not an amount.
export function parseAwardAmount(text, kind = "resource") {
  const m = String(text ?? "").trim().replace(/,/g, "").match(kind === "chest" ? /^(\d+)()$/ : /^(\d+(?:\.\d+)?)([km]?)$/i);
  // Rounded to a millionth first, so 2.07M is 2070000 and not a float a hair below it.
  const n = m && Number((Number(m[1]) * { "": 1, k: 1e3, m: 1e6 }[m[2].toLowerCase()]).toFixed(6));
  // Past a safe integer the page can't hold the amount exactly, so it is refused rather than changed.
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// An award item's amount the way the game writes it: a King's Chest as a count ("×2"), a resource
// with K and M ("2M", "1.5M", "500K").
export function awardAmountLabel(itemId, amount) {
  if (rewardItem(itemId)?.kind === "chest") return "×" + amount;
  // The unit is picked after rounding, so 999999 reads "1M", not "1000K".
  const short = (n) => Number((amount / n).toFixed(2));
  return short(1e6) >= 1 ? short(1e6) + "M" : short(1e3) >= 1 ? short(1e3) + "K" : String(amount);
}

// A place as it is written: 1st, 2nd, 3rd, 11th, 22nd.
export const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");

// The rankings a Reward Promise can pay on: the Mains ranking, or the Main + Farm ranking.
export const PAID_ON = ["mains", "main_farm"];

// The last place a promise tier can name. The database holds places to this, and no ranking runs this long.
export const MAX_PLACE = 1000;

// Reward Promises: { week, intro, paidOn, tiers: [{ place, reward, items }] }, what each place will get for a
// Fort Week, set before the week closes so Governors have something to compete for. A tier pays exactly one
// place, a whole number, so a promise matches the ranking place for place; paidOn is the ranking it pays on,
// "mains" or "main_farm". items are reward items as on a Weekly Award; reward is free text, optional once there
// are items.
// Why a promise can't be saved, as a sentence for the Council, or null when it can.
export function checkRewardPromise(promise, now = Date.now()) {
  if (!isFortWeekStart(promise.week)) return "Pick the Monday the Fort Week starts on.";
  // A promise is made before the reset; once a week closes, the Council gives Weekly Awards instead.
  if (isClosedWeek(promise.week, now)) return "This Fort Week has closed. Give its Weekly Awards on the Fort Week task instead.";
  if (!PAID_ON.includes(promise.paidOn)) return "Say whether the promise pays on the Mains or Main + Farm ranking.";
  const tiers = promise.tiers ?? [];
  if (!tiers.length) return "Add at least one place.";
  for (const [i, t] of tiers.entries()) {
    if (!(Number.isInteger(t.place) && t.place >= 1 && t.place <= MAX_PLACE)) return `Place ${i + 1}: its place is a whole number from 1 to ${MAX_PLACE}.`;
    const place = ordinal(t.place);
    const items = t.items ?? [];
    const unknown = items.find((x) => !rewardItem(x.item));
    if (unknown) return `"${unknown.item}" is not a reward item. Pick a King's Chest or a resource from the list.`;
    const bad = items.find((x) => !Number.isInteger(x.amount) || x.amount < 1);
    if (bad) return rewardItem(bad.item).kind === "chest"
      ? `${place}: the amount of ${rewardItem(bad.item).name} is a count from 1 up, for example 2.`
      : `${place}: the amount of ${rewardItem(bad.item).name} is a whole number above 0, for example 500K or 2M.`;
    if (!items.length && !t.reward?.trim()) return `${place}: pick a reward item or write what it gets.`;
  }
  // No place is promised twice. A gap is fine: nobody there gets an award.
  const twice = tiers.find((t, i) => tiers.findIndex((u) => u.place === t.place) !== i);
  if (twice) return `${ordinal(twice.place)} is promised twice. Each place is promised once.`;
  return null;
}

// The promise home shows: the Live Week's, or null. A closed week's promise is done; its Weekly Awards show instead.
export function livePromise(promises, now) {
  return promises.find((p) => isLiveWeek(p.week, now)) ?? null;
}

// The promise a week's editor starts from: its own, else the latest one before it (a standing promise
// repeats with one save), else null.
export function promiseToStartFrom(promises, week) {
  return promises.find((p) => p.week === week) ?? promises.filter((p) => p.week < week).sort((a, b) => (a.week < b.week ? 1 : -1))[0] ?? null;
}
