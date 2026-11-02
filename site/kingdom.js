// Kingdom rules: pure functions over plain data. No DOM, no network.

// Weekly Ranking: highest Fort Count first. Ties keep the stored order and share a rank number.
export function rankWeek(entries) {
  const sorted = [...entries].sort((a, b) => b.fortCount - a.fortCount);
  return sorted.map((e) => ({ ...e, rank: 1 + sorted.findIndex((x) => x.fortCount === e.fortCount) }));
}

// Fort Average for one Governor, or null if never ranked. Weeks are in date order.
// The window starts at the Governor's first ranked Fort Week. A Complete Week they are
// missing from counts as 0; a Partial Week counts only when they are ranked in it.
// A week with no completeness set is Complete.
export function fortAverage(weeks, characterId) {
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
