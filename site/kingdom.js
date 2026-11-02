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
