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

// The Fort Pause in effect at `now`, { start, end }, or null while Forts run. A pause runs from its start until
// its end, or on while end is null. No Fort Week exists inside one (ADR 0007), so Fort Average needs no rule for it.
export function fortPauseAt(pauses, now) {
  const t = new Date(now).getTime();
  return pauses.find((p) => new Date(p.start).getTime() <= t && (p.end == null || t < new Date(p.end).getTime())) ?? null;
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
// { id, name, kind, mainId, power }, power from the latest Roster Snapshot. Each account is
// suggested as a Farm of the highest-power account its name is directly related to.
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
  // Rule 9: a resource word ending the name, glued or spaced, letters repeated or not (Eren stoneee,
  // J4KUFOOD); "inf" only as its own word.
  const resource = s.match(/^(.*\p{L}.*?)(?:\s*(fo+d+|go+l+d+|sto+n+e+|wo+d+|co+r+n+)|\s+(inf))\s*\d*$/u);
  if (resource) return { root: compact(resource[1]), label: `Resource word "${resource[2] ?? resource[3]}"` };
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
      // What a former name joins on: itself, or its root of at least 3 letters when it looked like a
      // Farm ("Mr Wahab F2" → mrwahab).
      const rootOf = (name) => {
        const root = farmSignal(normaliseName(name))?.root;
        return root && letters(root) >= 3 ? root : null;
      };
      const wasKeys = [...was].flatMap(([k, name]) => [[k, name], [rootOf(name), name]]);
      return { ...g, c, was, wasKeys, signal: signal && letters(signal.root) >= 3 ? signal : null };
    })
    // A name of only tags, symbols or digits says nothing of the person, so it never pairs.
    .filter((p) => letters(p.c) > 0);

  // Edges between directly related names.
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
  // Rank: the highest power, and no power on record ranks below any. Among equals a name that
  // does not look like a Farm goes first, then the lowest Character ID. Negative: x outranks y.
  const rank = (x, y) => (y.power ?? -1) - (x.power ?? -1) || !!x.signal - !!y.signal || (x.id < y.id ? -1 : 1);
  // The reason two names are related, from the rule that joined them directly.
  const reasonBetween = (p, q) => (edges.find(([a, b]) => a === p && b === q) ?? edges.find(([a, b]) => a === q && b === p))[2];

  // A Governor's Main is the highest-ranked account it is directly related to, when that one
  // outranks it. Names are never chained through a third account, so a real Main is not swept
  // under a stronger, unrelated name. A dismissed pair is left out before choosing, so the next
  // related account is offered instead; a Governor that is already a Main of linked Farms stays one.
  const hasFarms = new Set(governors.filter((g) => g.kind === "farm" && g.mainId).map((g) => g.mainId));
  const step = new Map();
  for (const p of people) {
    if (hasFarms.has(p.id)) continue;
    const near = edges.flatMap(([a, b]) => (a === p ? [b] : b === p ? [a] : []));
    const [best] = near.filter((q) => rank(q, p) < 0 && !gone.has(p.id + ">" + q.id)).sort(rank);
    if (best) step.set(p.id, best);
  }

  // When that account is itself suggested as a Farm, the suggestion goes on to its Main, so the
  // Council never links a Farm to a Farm. Ranks only rise along the way, so it ends.
  const suggestions = [];
  for (const p of people) {
    const near = step.get(p.id);
    if (!near) continue;
    let main = near;
    while (step.has(main.id)) main = step.get(main.id);
    if (gone.has(p.id + ">" + main.id)) continue;
    const why = reasonBetween(p, near);
    suggestions.push({ farmId: p.id, mainId: main.id, reason: main === near ? why : `Via ${near.name}: ${why}` });
  }
  return suggestions;
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
  // Its fortCount stays its own. Mains tied on the Group Score share a rank and keep the stored order.
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

// The Character IDs record_live_week gives a reading's rows (live_week_matches in supabase/migrations):
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
// with row an index into rows; rows are the week's read rows { id, name, fortCount, names?, needsId? }. The page's
// preflight: pick_governor refuses the same Picks (tests/pick-cases.json and the shared name-matching cases keep
// the two together). Returns whether the page treats the week as the Live Week, why the Picks can't be saved (a
// sentence for the Council, or null), whether the only reason is that there are none yet, and the names they add
// to Name History, { id, name, firstSeen } with firstSeen the week's Monday.
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

// ---------- KvK (kvk SPEC) ----------
// A KvK is { id, name, startsOn, endsOn, powerCutoff, weights, periods }, days as UTC dates (YYYY-MM-DD),
// both ends included. weights are DKP weights { t4Kill, t5Kill, t4Death, t5Death }; periods are its
// Counting Periods [{ startsOn, endsOn }], endsOn null while a period is open.

// The UTC day (YYYY-MM-DD) of a moment, or the day itself when given one.
const utcDay = (now) => (typeof now === "string" ? now : new Date(now).toISOString().slice(0, 10));

// A KvK's state, from the date alone: "upcoming" before its start day, "active" from the start day
// through the end day, "ended" after it.
export function kvkState(kvk, now) {
  const day = utcDay(now);
  return day < kvk.startsOn ? "upcoming" : day <= kvk.endsOn ? "active" : "ended";
}

// The KvK the KvK tab shows: the newest that has started (the Active one, else the last to end), else the
// next to start, else null. KvKs never overlap, so at most one is Active.
export function currentKvk(kvks, now) {
  const day = utcDay(now);
  const started = kvks.filter((k) => k.startsOn <= day).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  const coming = kvks.filter((k) => k.startsOn > day).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return started[0] ?? coming[0] ?? null;
}

// What Home shows, from the Fort Pause switch alone (ADR 0007): Fort Rankings while Forts run,
// { view: "fort", pause: null }; while they are paused, the newest KvK that has started, Active or Ended,
// { view: "kvk", kvk }; paused with no started KvK, Fort Rankings with the pause line, { view: "fort", pause }.
export function homeShows({ pauses, kvks, now }) {
  const pause = fortPauseAt(pauses, now);
  if (!pause) return { view: "fort", pause: null };
  const day = new Date(now).toISOString().slice(0, 10);
  const started = kvks.filter((k) => k.startsOn <= day).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  return started.length ? { view: "kvk", kvk: started[0] } : { view: "fort", pause };
}

// What a new KvK starts with. The database holds the same defaults (kvk in supabase/migrations).
export const KVK_DEFAULTS = Object.freeze({
  powerCutoff: 20_000_000,
  weights: Object.freeze({ t4Kill: 1, t5Kill: 2, t4Death: 4, t5Death: 8 }),
});

// A Governor's DKP: T4 and T5 kills and deaths over the Counting Periods, each times its weight.
// A value not counted yet (null) counts as 0.
export function dkp(row, weights) {
  return (row.t4Kills ?? 0) * weights.t4Kill + (row.t5Kills ?? 0) * weights.t5Kill
    + (row.t4Deaths ?? 0) * weights.t4Death + (row.t5Deaths ?? 0) * weights.t5Death;
}

// A day as the KvK checks write it: "9 Jan 2020", as save_kvk does with to_char(day, 'FMDD Mon YYYY').
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const kvkDay = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Why a KvK can't be saved, as a sentence for the Council, or null when it can. others are the KvKs
// already saved, { id, name, startsOn, endsOn }; the one being edited (same id) is never counted against
// itself. The admin page's check before Save: save_kvk refuses the same KvKs with the same sentence
// (tests/kvk-cases.json keeps the two together).
export function checkKvk(kvk, others = []) {
  if (!kvk.name?.trim()) return "A KvK needs a name.";
  if (!isDay(kvk.startsOn) || !isDay(kvk.endsOn)) return "A KvK needs a start day and an end day.";
  if (kvk.endsOn < kvk.startsOn) return `The KvK ends on ${kvkDay(kvk.endsOn)}, before it starts on ${kvkDay(kvk.startsOn)}.`;
  if (!(Number.isInteger(kvk.powerCutoff) && kvk.powerCutoff >= 0)) return "The Power Cutoff is a whole number from 0 up.";
  const w = kvk.weights ?? {};
  if (!["t4Kill", "t5Kill", "t4Death", "t5Death"].every((k) => Number.isFinite(w[k]) && w[k] >= 0)) return "Each DKP weight is a number from 0 up.";
  const days = `the KvK's days, ${kvkDay(kvk.startsOn)} to ${kvkDay(kvk.endsOn)}`;
  const periods = kvk.periods ?? [];
  for (const [i, p] of periods.entries()) {
    const n = i + 1;
    if (!isDay(p.startsOn)) return `Counting Period ${n} needs a start day.`;
    if (p.endsOn != null && p.endsOn < p.startsOn) return `Counting Period ${n} ends on ${kvkDay(p.endsOn)}, before it starts on ${kvkDay(p.startsOn)}.`;
    if (p.startsOn < kvk.startsOn || p.startsOn > kvk.endsOn) return `Counting Period ${n} starts on ${kvkDay(p.startsOn)}, outside ${days}.`;
    if (p.endsOn != null && p.endsOn > kvk.endsOn) return `Counting Period ${n} ends on ${kvkDay(p.endsOn)}, outside ${days}.`;
  }
  // An open period runs to the KvK's end day. Both ends are included, so a shared end day is an overlap.
  const end = (p) => p.endsOn ?? kvk.endsOn;
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const a = periods[i], b = periods[j];
      if (a.startsOn <= end(b) && b.startsOn <= end(a)) {
        return `Counting Periods ${i + 1} and ${j + 1} overlap on ${kvkDay(a.startsOn > b.startsOn ? a.startsOn : b.startsOn)}. No day counts twice.`;
      }
    }
  }
  const clash = others
    .filter((o) => kvk.id == null || o.id !== kvk.id)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
    .find((o) => o.startsOn <= kvk.endsOn && kvk.startsOn <= o.endsOn);
  if (clash) return `Its days overlap ${clash.name}, ${kvkDay(clash.startsOn)} to ${kvkDay(clash.endsOn)}. Only one KvK runs at a time.`;
  return null;
}

// A KvK's table: the Governors of its KvK Start Snapshot at or above its Power Cutoff, ranked by DKP,
// highest first. Ties keep the order given and share a rank. rows are the KvK totals read
// (kvk_standings in supabase/migrations): { id, name, status, startPower, t4Kills, t5Kills, t4Deaths, t5Deaths };
// startPower is null for a Governor counted in a Counting Period but not in the KvK Start Snapshot.
// all ("show all") keeps every row: those below the Power Cutoff and those without starting power too.
// sort is the column ranked on, highest first: "dkp" (the default), "startPower", "t4Kills", "t5Kills",
// "t4Deaths" or "t5Deaths". No starting power ranks below any. "name" lists the Governors A to Z, each
// keeping their DKP rank.
export function kvkStandings(rows, kvk, { all = false, sort = "dkp" } = {}) {
  const taking = rows
    .filter((r) => all || (r.startPower != null && r.startPower >= kvk.powerCutoff))
    .map((r) => ({ ...r, dkp: dkp(r, kvk.weights) }));
  if (sort === "name") return rankWeek(taking, (r) => r.dkp).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "en", { sensitivity: "base" }));
  return rankWeek(taking, (r) => r[sort] ?? -1);
}

// How far a KvK's table has counted at now, given the newest Roster Snapshot's day (newest, null for none).
// Before its first Counting Period starts: { begins } with that period's start day, or null when no period
// is set. From then on: { days }, the Counting Period days from their start up to the newest snapshot, an
// open period running to the KvK's end day at most.
export function kvkCounting(kvk, now, newest) {
  const first = [...kvk.periods].sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  if (!first || utcDay(now) < first.startsOn) return { begins: first?.startsOn ?? null };
  const dayNo = (iso) => Date.parse(iso + "T00:00:00Z") / 864e5;
  const days = kvk.periods.reduce((n, p) => {
    const ends = [p.endsOn ?? kvk.endsOn, newest].filter(Boolean).sort()[0];
    return n + (newest ? Math.max(0, dayNo(ends) - dayNo(p.startsOn) + 1) : 0);
  }, 0);
  return { days };
}

// The KvK tab's list: every KvK newest first, so the upcoming one leads, then the Active one, then the past
// ones. Each comes with its state (kvkState). The carried-over Last KvK table is not a KvK; the tab adds it last.
export function kvkList(kvks, now) {
  return [...kvks].sort((a, b) => b.startsOn.localeCompare(a.startsOn)).map((k) => ({ ...k, state: kvkState(k, now) }));
}
