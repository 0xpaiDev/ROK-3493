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
