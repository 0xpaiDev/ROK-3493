// Reads the Kingdom from Supabase with the public key. Read-only: no rules here, only reshaping
// rows into the plain data the pages and the kingdom rules module take.
import { fortWeekEnd, currentKvk } from "./kingdom.js";

export const SUPABASE_URL = "https://xjgswlqzdpmnhhnitucr.supabase.co";
// Publishable (anon) key: safe to ship, row-level security only lets it read.
export const SUPABASE_KEY = "sb_publishable_UZPl9wsrFKR7oV1YEAHBbg_AnqyQLSe";

const PAGE = 1000; // PostgREST's default row cap per request

async function rows(table, query) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: SUPABASE_KEY, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) {
      const text = await res.text();
      let code = null;
      try { code = JSON.parse(text).code ?? null; } catch { /* not PostgREST's JSON */ }
      throw Object.assign(new Error(`${table}: ${res.status} ${text}`), { code });
    }
    const page = await res.json();
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

// PostgREST's "no such table" (PGRST205) and Postgres's "no such relation" (42P01).
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

// A read of a table a migration adds: empty while the migration hasn't reached the database yet. Any
// other failure surfaces, like every other read.
export async function rowsIfTable(table, query) {
  try {
    return await rows(table, query);
  } catch (e) {
    if (MISSING_TABLE.has(e.code)) return [];
    throw e;
  }
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// A KvK as the kingdom rules take it (checkKvk, kvkStandings in kingdom.js); the admin page reads it the same way.
export const KVK_SELECT = "id,story,name,starts_on,ends_on,weight_t4_kill,weight_t5_kill,weight_t4_death,weight_t5_death,kvk_counting_period(starts_on,ends_on)";
export const kvkFromRow = (k) => ({
  id: k.id, story: k.story ?? null, name: k.name, startsOn: k.starts_on, endsOn: k.ends_on,
  weights: { t4Kill: Number(k.weight_t4_kill), t5Kill: Number(k.weight_t5_kill), t4Death: Number(k.weight_t4_death), t5Death: Number(k.weight_t5_death) },
  periods: [...(k.kvk_counting_period ?? [])].sort((a, b) => a.starts_on.localeCompare(b.starts_on)).map((p) => ({ startsOn: p.starts_on, endsOn: p.ends_on })),
});
// One Governor's KvK totals, as kvk_standings returns them.
const totalsFromRow = (r) => ({
  id: r.character_id, name: r.name, status: cap(r.status), startPower: r.start_power,
  t4Kills: r.t4_kills, t5Kills: r.t5_kills, t4Deaths: r.t4_deaths, t5Deaths: r.t5_deaths,
});

export async function loadKingdom() {
  const [governors, names, weeks, entries, events, ghEntries, kvk, snapshots, awards, promises, pauses, kvkSetups] = await Promise.all([
    rows("governor", "select=character_id,current_name,status,kind,main_character_id"),
    rows("governor_name", "select=character_id,name&order=first_seen.asc.nullslast,name.asc"),
    rows("fort_week", "select=starts_on,completeness,read_at&order=starts_on.asc"),
    rows("fort_entry", "select=id,week,character_id,name,fort_count&order=fort_count.desc,tie_order.asc,id.asc"),
    rows("gh_event", "select=id,name,starts_on,ends_on&order=starts_on.asc,id.asc"),
    rows("gh_entry", "select=event_id,place,character_id,name,alliance,golden_heads&order=place.asc"),
    rows("kvk_entry", "select=*&order=rank.asc"),
    // Every Roster Snapshot's day, newest first: the days a KvK has counted. Never their daily rows.
    rows("roster_snapshot", "select=id,taken_on&order=taken_on.desc"),
    rows("weekly_award", "select=week,character_id,place,award,note,weekly_award_item(item,amount)&weekly_award_item.order=id.asc&order=week.desc,place.asc,id.asc"),
    rows("reward_promise", "select=week,intro,paid_on,reward_promise_tier(place,reward,items)&reward_promise_tier.order=position.asc&order=week.desc"),
    // Until the Fort Pause migration reaches the database the table is missing: Forts read as running.
    rowsIfTable("fort_pause", "select=starts_at,ends_at&order=starts_at.asc"),
    // Until the KvK migration reaches the database the table is missing: no KvK is set up.
    rowsIfTable("kvk", `select=${KVK_SELECT}&order=starts_on.desc`),
  ]);
  // The KvKs the Council set up, newest first, and the totals of the one the KvK tab shows: one row per
  // Governor in its KvK Start Snapshot, summed in the database (kvk_standings), never the daily rows.
  const kvks = kvkSetups.map(kvkFromRow);
  const shown = currentKvk(kvks, Date.now());
  // Every KvK's totals, for the KvK tab's list: a few KvKs a year, one small read each.
  const tables = await Promise.all(kvks.map((k) => rows("rpc/kvk_standings", `kvk_id=${k.id}`)));
  const kvkTables = Object.fromEntries(kvks.map((k, i) => [k.id, tables[i].map(totalsFromRow)]));
  const totals = shown ? kvkTables[shown.id] : [];
  const latest = snapshots[0];
  const snapshotRows = latest
    ? await rows("roster_snapshot_row", `select=character_id,power,highest_power,resources_gathered&snapshot_id=eq.${latest.id}&order=power.desc.nullslast`)
    : [];
  const governor = new Map(governors.map((g) => [g.character_id, g]));

  const fortWeeks = weeks.map((w) => ({
    start: w.starts_on,
    end: fortWeekEnd(w.starts_on),
    completeness: w.completeness,
    readAt: w.read_at, // when the reader last read it; null for a pasted week
    entries: entries
      .filter((e) => e.week === w.starts_on)
      .map((e) => ({ id: e.character_id, name: e.name, fortCount: e.fort_count, entry: e.id })),
  }));

  const ghEvents = events.map((ev) => ({
    name: ev.name,
    startsOn: ev.starts_on,
    endsOn: ev.ends_on,
    entries: ghEntries
      .filter((e) => e.event_id === ev.id)
      .map((e) => ({ rank: e.place, id: e.character_id, name: e.name, alliance: e.alliance, gh: e.golden_heads })),
  }));

  // The latest Roster Snapshot, plus Inactive and Migrated Governors who are no longer in it. Kill Points and
  // Alliance Helps are stored but not shown: the export reports 0 Kill Points for almost everyone.
  const listed = new Set(snapshotRows.map((r) => r.character_id));
  const roster = [
    ...snapshotRows.map((r) => {
      const g = governor.get(r.character_id);
      return {
        id: r.character_id,
        name: g?.current_name,
        status: g ? cap(g.status) : null,
        power: r.power,
        highestPower: r.highest_power,
        resources: r.resources_gathered,
      };
    }),
    ...governors
      .filter((g) => g.status !== "current" && !listed.has(g.character_id))
      .map((g) => ({ id: g.character_id, name: g.current_name, status: cap(g.status), power: null, highestPower: null, resources: null })),
  ];

  const kvkRows = kvk.map((r) => ({
    status: r.status,
    rank: r.rank,
    id: r.character_id,
    name: r.name,
    power: r.power,
    highestPower: r.highest_power,
    killPoints: r.kill_points,
    resources: r.resources_gathered,
  }));

  const dates = [...fortWeeks.map((w) => w.readAt?.slice(0, 10) ?? w.end), ...events.map((e) => e.ends_on), latest?.taken_on].filter(Boolean).sort();
  return {
    generated: dates.at(-1) ?? new Date().toISOString().slice(0, 10),
    fortWeeks,
    ghEvents,
    kvk: kvkRows,
    // KvKs the Council set up, newest first: { id, story, name, startsOn, endsOn, weights, periods }.
    kvks,
    // The KvK tab's KvK and its totals: { kvkId, rows: [{ id, name, status, startPower, t4Kills, t5Kills, t4Deaths, t5Deaths }] }.
    kvkTotals: shown ? { kvkId: shown.id, rows: totals } : null,
    // Every KvK's totals by KvK id, the same rows as kvkTotals; startPower is null for a Governor counted
    // in a Counting Period but not in the KvK Start Snapshot.
    kvkTables,
    // The newest Roster Snapshot's day (YYYY-MM-DD), null before the first: how far a KvK has counted.
    newestSnapshotOn: latest?.taken_on ?? null,
    // Every Roster Snapshot's day (YYYY-MM-DD), newest first: which Counting Period days a KvK has counted.
    snapshotDays: snapshots.map((s) => s.taken_on),
    roster,
    // Kind and Farm link for the Mains ranking: { id, name, kind, mainId }.
    governors: governors.map((g) => ({ id: g.character_id, name: g.current_name, kind: g.kind, mainId: g.main_character_id })),
    nameHistory: names.map((n) => ({ id: n.character_id, name: n.name })),
    // Weekly Awards { week, id, place, award, note, items }; always a Main's Character ID. items are
    // [{ item, amount }] in the order given; award is the free text, null on an award of items only.
    weeklyAwards: awards.map((a) => ({ week: a.week, id: a.character_id, place: a.place, award: a.award, note: a.note, items: a.weekly_award_item })),
    // Reward Promises { week, intro, paidOn, tiers: [{ place, reward, items }] }, the latest week first.
    // paidOn is "mains" or "main_farm"; each tier pays one place.
    rewardPromises: promises.map((p) => ({ week: p.week, intro: p.intro, paidOn: p.paid_on, tiers: p.reward_promise_tier })),
    // Fort Pauses { start, end } (ADR 0007), oldest first; end is null while Forts are still paused.
    fortPauses: pauses.map((p) => ({ start: p.starts_at, end: p.ends_at })),
  };
}
