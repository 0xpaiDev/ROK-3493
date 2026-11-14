// Reads the Kingdom from Supabase with the public key. Read-only: no rules here, only reshaping
// rows into the plain data the pages and the kingdom rules module take.
import { fortWeekEnd, top200 } from "./kingdom.js";

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
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

export async function loadKingdom() {
  const [governors, names, weeks, entries, events, ghEntries, kvk, snapshots, awards, promises] = await Promise.all([
    rows("governor", "select=character_id,current_name,status,kind,main_character_id"),
    rows("governor_name", "select=character_id,name&order=first_seen.asc.nullslast,name.asc"),
    rows("fort_week", "select=starts_on,completeness,read_at&order=starts_on.asc"),
    rows("fort_entry", "select=id,week,character_id,name,fort_count&order=fort_count.desc,tie_order.asc,id.asc"),
    rows("gh_event", "select=id,name,starts_on,ends_on&order=starts_on.asc,id.asc"),
    rows("gh_entry", "select=event_id,place,character_id,name,alliance,golden_heads&order=place.asc"),
    rows("kvk_entry", "select=*&order=rank.asc"),
    rows("roster_snapshot", "select=id,taken_on&order=taken_on.desc&limit=1"),
    rows("weekly_award", "select=week,character_id,place,award,note,weekly_award_item(item,amount)&weekly_award_item.order=id.asc&order=week.desc,place.asc,id.asc"),
    rows("reward_promise", "select=week,intro,paid_on,reward_promise_tier(place,reward,items)&reward_promise_tier.order=position.asc&order=week.desc"),
  ]);
  const latest = snapshots[0];
  const snapshotRows = latest
    ? await rows("roster_snapshot_row", `select=character_id,power,highest_power,resources_gathered&snapshot_id=eq.${latest.id}&order=power.desc.nullslast`)
    : [];
  const governor = new Map(governors.map((g) => [g.character_id, g]));
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

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
  const inTop200 = new Set(top200(snapshotRows.map((r) => ({ id: r.character_id, power: r.power }))));
  const listed = new Set(snapshotRows.map((r) => r.character_id));
  const roster = [
    ...snapshotRows.map((r) => {
      const g = governor.get(r.character_id);
      return {
        id: r.character_id,
        name: g?.current_name,
        status: g ? cap(g.status) : null,
        top200: inTop200.has(r.character_id),
        power: r.power,
        highestPower: r.highest_power,
        resources: r.resources_gathered,
      };
    }),
    ...governors
      .filter((g) => g.status !== "current" && !listed.has(g.character_id))
      .map((g) => ({ id: g.character_id, name: g.current_name, status: cap(g.status), top200: false, power: null, highestPower: null, resources: null })),
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
  };
}
