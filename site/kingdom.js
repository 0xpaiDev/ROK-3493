// Kingdom rules: pure functions over plain data. No DOM, no network.
import { rewardItem } from "./rewards.js";

// Weekly Ranking: highest Fort Count first (or highest `by`). Ties keep the stored order and share a rank number.
export function rankWeek(entries, by = (e) => e.fortCount) {
  const sorted = [...entries].sort((a, b) => by(b) - by(a));
  return sorted.map((e) => ({ ...e, rank: 1 + sorted.findIndex((x) => by(x) === by(e)) }));
}

// What a Weekly Ranking row is ranked and shown on: a Main's Group Score in "Main + Farm", else its Fort Count.
export const rowScore = (r) => r.groupScore ?? r.fortCount;

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

// Farm link suggestions: candidate Farm→Main pairs from similar names. Governors are
// { id, name, kind, mainId, power }, power from the latest Roster Snapshot. Related names form a
// group, and every other account in a group is suggested as a Farm of its highest-power account.
// Suggestions only; nothing is linked without the Council. Pairs are always Character IDs.

// Alliance tags and decorative symbols, stripped before NFKC (which would turn ᴰᵁ into "du").
const NAME_TAGS = ["ᵛø", "vø", "93๛", "ღ", "ᴰᵁ", "ᴴᴸ", "ᵀʳ", "ᴬˢʰ"];
const NAME_SYMBOLS = /[乄亗㋛屮メ侍ˢ㋾・]/gu;

// Rule 1: NFKC, lowercase, tags and symbols out, spaces collapsed.
function normaliseName(name) {
  let s = name;
  for (const t of NAME_TAGS) s = s.split(t).join(" ");
  s = s.replace(NAME_SYMBOLS, " ").normalize("NFKC").replace(NAME_SYMBOLS, " ").toLowerCase();
  return s.replace(/\s+/g, " ").trim();
}

const letters = (s) => (s.match(/\p{L}/gu) ?? []).length;
const compact = (s) => s.replace(/\s/g, "");

// What makes a name look like a Farm: its root (the name without the Farm signal), the rule and a label.
// Rule 3: farm (and farmm, farme, farmer, frm), mini, clone anywhere; fm at the end; F plus a number,
// spaced or glued, or a lone spaced F; pc plus a number. A number right after a marker goes with it.
const FARM_MARKER = /(?:farmer|farm+e?|frm|mini|clone)\s*\d*|pc\s*\d+|fm\s*\d*$|(?<=\s|^)f\s*\d*(?=\s|$)|(?<=\p{L})f\d+(?=\s|$)/gu;
function farmSignal(s) {
  const marked = s.replace(FARM_MARKER, " ");
  if (marked !== s) return { root: compact(marked).replace(/\d+$/, ""), label: `Farm marker "${s.match(FARM_MARKER).map((m) => m.trim()).join(" ")}"` };
  // Rule 4: a last word of one letter and F (Årt・AF … Årt・GF).
  const series = s.match(/^(.*\S)\s+\p{L}f$/u);
  if (series) return { root: compact(series[1]), label: `Letter series on "${series[1]}"`, series: true };
  const num = s.match(/^(.*\p{L}.*?)\s*(\d+)$/u);
  if (num) return { root: compact(num[1]), label: `Numbered series on "${num[1]}"`, series: true };
  return null;
}

// Rule 8: the game's default name, a word and digits (Governor179509850, Thống đốc…, 執政官…). It is
// the Governor's own Character ID in every language seen, so that counts too; it says nothing of the person.
const DEFAULT_NAME = /^(governor|thống đốc|vali|правитель)\s*\d+$/u;
const isDefaultName = (g) => DEFAULT_NAME.test(normaliseName(g.name)) || (/^\D+\d+$/u.test(g.name) && g.name.endsWith(g.id));

// history is Name History, [{ id, name }].
export function farmLinkSuggestions(governors, dismissed = [], history = []) {
  const gone = new Set(dismissed.map((d) => d.farmId + ">" + d.mainId));
  const people = governors
    .filter((g) => g.kind !== "farm" && !isDefaultName(g))
    .map((g) => {
      const s = normaliseName(g.name);
      const signal = farmSignal(s);
      const c = compact(s);
      const was = new Map(history.filter((h) => h.id === g.id).map((h) => [compact(normaliseName(h.name)), h.name]));
      was.delete(c);
      // What a former name joins on: itself, or its root when it looked like a Farm ("Mr Wahab F2" → mrwahab).
      const wasKeys = [...was].flatMap(([k, name]) => [[k, name], [farmSignal(normaliseName(name))?.root, name]]);
      return { ...g, c, was, wasKeys, signal: signal && letters(signal.root) >= 3 ? signal : null };
    });

  // Edges between related names; a group is everything they join.
  const edges = [];
  for (const a of people) {
    for (const b of people) {
      if (a === b) continue;
      // Rule 7: a name b once went by, alone or with a Farm signal (ᵛø wahab was "Mr Wahab" → Mr Wahab F2),
      // or a former name of a's that b goes or went by (ᵛøwahab ii was "Mr Wahab F2").
      const former = b.was.get(a.c) ?? (a.signal && b.was.get(a.signal.root)) ?? a.wasKeys.find(([k]) => k && (k === b.c || b.was.has(k)))?.[1];
      if (former) edges.push([a, b, `Was "${former}"`]);
      else if (a.c === b.c && a.id < b.id) edges.push([a, b, "Same name"]);
      else if (a.signal && (b.c === a.signal.root || b.signal?.root === a.signal.root)) edges.push([a, b, a.signal.label]);
      // Rules 4 and 5: a series root also joins the account whose name starts with it (FKK1 → FKK CATHAY).
      else if (a.signal?.series && !b.signal && b.c.startsWith(a.signal.root)) edges.push([a, b, a.signal.label]);
      // Rule 6: a root of at least 4 letters inside another name (FarmLorenzoni1 → LordLorenzoniˢ).
      else if (a.signal && letters(a.signal.root) >= 4 && b.c.includes(a.signal.root)) edges.push([a, b, `"${a.signal.root}" is in ${b.name}`]);
    }
  }
  const parent = new Map(people.map((p) => [p.id, p.id]));
  const find = (id) => (parent.get(id) === id ? id : find(parent.get(id)));
  for (const [a, b] of edges) parent.set(find(a.id), find(b.id));

  // The Main: the highest power, and no power on record ranks below any. Among equals a name that
  // does not look like a Farm goes first, then the lowest Character ID.
  const groups = new Map();
  for (const p of people) {
    const r = find(p.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p);
  }
  const mainOf = new Map();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const [main] = [...list].sort((x, y) => (y.power ?? -1) - (x.power ?? -1) || !!x.signal - !!y.signal || (x.id < y.id ? -1 : 1));
    for (const p of list) if (p !== main) mainOf.set(p.id, main);
  }

  // Each Farm's reason: the rule that tied it to its Main, else the one that put it in the group.
  const reasonOf = (farm, main) =>
    (edges.find(([a, b]) => a === farm && b === main) ?? edges.find(([a]) => a === farm) ?? edges.find(([, b]) => b === farm))[2];
  return people
    .filter((p) => mainOf.has(p.id) && !gone.has(p.id + ">" + mainOf.get(p.id).id))
    .map((p) => ({ farmId: p.id, mainId: mainOf.get(p.id).id, reason: reasonOf(p, mainOf.get(p.id)) }));
}

// Top 200: the Character IDs of the 200 highest-power Governors in a snapshot's rows. Equal power
// goes by Character ID, compared as plain text, as record_roster_snapshot does when it decides who
// becomes Inactive, so the site's Top 200 is the one the Roster job used.
export function top200(rows) {
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...rows].sort((a, b) => (b.power ?? 0) - (a.power ?? 0) || byId(a, b)).slice(0, 200).map((r) => r.id);
}

// Mains ranking for a Fort Week. Governors are { id, name, kind, mainId }; a Farm's mainId is its
// Farm link. By default Mains rank on their own Fort Counts and Farms are left out. withFarms
// attaches each Main's Farms, gives each Main its Group Score (`own` and `fortCount` keep the
// Main's Fort Count), and reranks the Mains on it.
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
  // A Main's Group Score is its own Fort Count plus half of each Farm's; the Mains rank on it.
  // Its fortCount stays its own. Entry order stays the tie-break, so Mains tied on the Group Score
  // keep the Council's order.
  const scored = [...entries.filter((e) => !farmOf.has(e.id)), ...idle].map((m) => {
    const farms = farmsOf(m.id);
    return { ...m, own: m.fortCount, groupScore: m.fortCount + farms.reduce((a, f) => a + f.fortCount, 0) / 2, farms };
  });
  // An unlinked Farm is its own row with no rank, placed by its Fort Count among the Group Scores:
  // Mains rank only among Mains.
  const unlinked = entries
    .filter((e) => farmOf.has(e.id) && !farmOf.get(e.id))
    .map((e) => ({ ...e, rank: null, unlinked: true, farms: [] }));
  return [...rankWeek(scored, (m) => m.groupScore), ...unlinked].sort((x, y) => rowScore(y) - rowScore(x));
}

// Each Character ID + name pair already in Name History, to tell which names are new.
const seenPairs = (nameHistory) => new Set(nameHistory.map((n) => n.id + "|" + n.name));
const isSeen = (seen, r) => seen.has(r.id + "|" + r.name);

// The names a reading is matched against: Name History { character_id, name } plus each Governor's
// current name { id, name }, which counts as seen before a Roster Snapshot adds it.
export function namesToMatch(governors, nameHistory) {
  return [...nameHistory.map((n) => ({ id: n.character_id, name: n.name })), ...governors];
}

// The Character IDs record_live_week gives a reading's rows (supabase/migrations, the newest Live Week one):
// a row whose spellings (names, or else its name) lead to exactly one Governor in Name History gets that
// Character ID; a name seen under more than one is never guessed between. A name on two rows, a row flagged
// needsId (an older reader), and two rows whose names lead to one Governor all stay "needs ID".
// Rows { name, fortCount, names?, needsId? } in reading order.
export function liveReadingIds(rows, nameHistory) {
  const spellings = (r) => r.names ?? [r.name];
  const onTwoRows = (name) => rows.filter((o) => o.name === name).length > 1;
  const ids = rows.map((r) => {
    if (r.needsId || onTwoRows(r.name)) return null;
    const found = new Set(nameHistory.filter((n) => spellings(r).includes(n.name)).map((n) => n.id));
    return found.size === 1 ? [...found][0] : null;
  });
  return ids.map((id) => (id != null && ids.filter((other) => other === id).length > 1 ? null : id));
}

// The Character IDs on more than one row of a Fort Week. A week holds each Governor once, so these
// block a Pick. "needs ID" rows have no Character ID yet and never count as the same Governor.
export function governorsTwice(rows) {
  const ids = rows.map((r) => r.id).filter((id) => id != null);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

// Picks on a read Fort Week (ADR 0006): the Council's choice of Governor for a "needs ID" row, [{ row, id }]
// with row an index into rows; rows are the week's read rows { id, name, fortCount, names?, needsId? }. Returns whether the page treats the week as the Live Week, why the Picks can't
// be saved (a sentence for the Council, or null), whether the only reason is that there are none yet, and the
// names they add to Name History, { id, name, firstSeen } with firstSeen the week's Monday.
const NO_PICKS = `Pick a Governor for a "needs ID" row first.`;
export function checkPicks({ week, rows, picks, nameHistory, governors, liveWeek, now }) {
  const seen = seenPairs(nameHistory);
  // A name another row carries, or was also read as, may belong to two Governors: under one of them alone,
  // the reader would hand it the other's rows (the same rule as pick_governor).
  const elsewhere = (p) => rows.some((r, i) => i !== p.row && (r.names ?? [r.name]).includes(rows[p.row].name));
  const newNames = picks.filter((p) => !elsewhere(p)).map((p) => ({ id: p.id, name: rows[p.row].name, firstSeen: week }))
    .filter((n) => !isSeen(seen, n));
  // The week the page's reading was loaded for, or the one now in progress: they differ once the reset passes.
  const live = isFortWeekStart(week) && (week === liveWeek || isLiveWeek(week, now));
  const nameOf = (id) => governors.find((g) => g.id === id)?.name ?? id;
  const picked = rows.map((r, i) => ({ ...r, id: picks.find((p) => p.row === i)?.id ?? r.id }));
  const twice = governorsTwice(picked);
  // On the Live Week a Pick only helps if the reader's next reading would match it, by record_live_week's rule.
  const next = live ? liveReadingIds(rows, [...nameHistory, ...newNames]) : [];
  const slips = live ? picks.filter((p) => next[p.row] !== p.id).map((p) => rows[p.row].name) : [];
  const problem = !isFortWeekStart(week) ? `${week || "The date"} is not a Monday. A Fort Week starts on Monday.`
    // A Live Week reading from before the reset is not the week the reader now writes.
    : live && !isLiveWeek(liveWeek, now) ? "The Monday reset has passed since this page loaded, so its reading is out of date. Reload the page."
    : twice.length ? `${twice.map(nameOf).join(", ")} ${twice.length === 1 ? "is" : "are"} on more than one row. A Governor appears once per Fort Week.`
    : slips.length ? `${slips.join(", ")} would still be "needs ID" at the next reading: ${slips.length === 1 ? "its name is" : "their names are"} on another row, as written or as read, or already ${slips.length === 1 ? "belongs" : "belong"} to another Governor. Clear the Pick and Pick it again once the week closes.`
    : !picks.length ? NO_PICKS
    : null;
  const nothingYet = problem === NO_PICKS;
  return { live, problem, nothingYet, newNames };
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

// An amount as an edit form prefills it: the label when it reads back as the same amount, else the exact
// number, so saving an edit never rounds 1234567 to 1.23M. A chest's "×2" is typed as "2".
export function awardAmountInput(itemId, amount) {
  const kind = rewardItem(itemId)?.kind ?? "resource";
  const text = awardAmountLabel(itemId, amount).replace(/^×/, "");
  return parseAwardAmount(text, kind) === amount ? text : String(amount);
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

// Fill: a closed Fort Week's Weekly Awards drafted from its Reward Promise. Takes the promise and the ranking it
// pays on (mainsRanking, plain or withFarms), in ranking order. Places count down that ranking over the rows
// that can receive an award, and the Main at each promised place gets that tier's items and text. A draft only:
// nothing is saved here. Returns { awards: [{ id, place, items, award }], skipped: [{ name, reason }] }.
export function fillWeeklyAwards(promise, ranking) {
  const tierAt = new Map(promise.tiers.map((t) => [t.place, t]));
  const last = Math.max(0, ...tierAt.keys());
  const awards = [], skipped = [];
  let place = 0;
  for (const r of ranking) {
    // Rows below the last promised place move nobody, so they are neither walked nor listed.
    if (place >= last) break;
    // A Weekly Award goes to a Main on record: a "needs ID" row and an unlinked Farm can't take one.
    const reason = r.id == null ? "needs ID" : r.unlinked ? "unlinked Farm" : null;
    if (reason) { skipped.push({ name: r.name, reason }); continue; }
    const t = tierAt.get(++place);
    if (t) awards.push({ id: r.id, place, items: (t.items ?? []).map((x) => ({ ...x })), award: t.reward ?? null });
  }
  return { awards, skipped };
}
