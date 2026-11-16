// Council admin page: magic-link sign-in, then one Council task at a time from the sidebar.
// Row-level security decides who may write; this page only hides the tasks from non-Council users.
import { createClient, navigatorLock } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./store.js";
import { farmLinkSuggestions, fortWeekAt, fortWeekEnd, isFortWeekStart, rankWeek, namesToMatch, governorsTwice, checkPicks, isLiveWeek, isClosedWeek, checkWeeklyAward, awardsByWeek, parseAwardAmount, awardAmountLabel, awardAmountInput, checkRewardPromise, promiseToStartFrom, ordinal, PAID_ON, MAX_PLACE, mainsRanking, fillWeeklyAwards } from "./kingdom.js";
import { REWARD_ITEMS, rewardItem } from "./rewards.js";

// The auth client serialises its work across tabs with a browser lock, and by default waits for it forever.
// Another admin tab that holds it and never lets go (the tab the magic link was sent from, a tab the browser
// froze in the background) then leaves this one on "Checking sign-in…". Wait at most LOCK_WAIT_MS, then take it.
const LOCK_WAIT_MS = 5000;
async function authLock(name, acquireTimeout, fn) {
  if (acquireTimeout >= 0) return navigatorLock(name, acquireTimeout, fn); // a timed or try-now request: keep the library's way
  try {
    return await navigatorLock(name, LOCK_WAIT_MS, fn);
  } catch (e) {
    if (e?.name !== "AbortError" && !e?.isAcquireTimeout) throw e;
    return navigator.locks.request(name, { steal: true }, fn);
  }
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { lock: authLock } });
const main = document.getElementById("admin");
const who = document.getElementById("who");
const signOut = document.getElementById("sign-out");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gov = (id, name) => `<span class="ell" title="${esc(name)}">${esc(name)}</span><span class="pid">${esc(id)}</span>`;
const dayMonth = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
// A typed "Name (Character ID)" from a datalist, or a bare Character ID.
const typedId = (typed) => typed.match(/\((\d+)\)$/)?.[1] ?? (/^\d+$/.test(typed) ? typed : null);
// An award's reward items: icon, amount and name for each, as the public site shows them.
const rewardItems = (items) => `<span class="reward-items">${items.map((x) => {
  const r = rewardItem(x.item);
  return `<span class="reward-item">${r ? `<img src="${r.icon}" alt="${esc(r.name)}">` : ""}<b class="num">${esc(awardAmountLabel(x.item, x.amount))}</b> ${esc(r?.name ?? x.item)}</span>`;
}).join("")}</span>`;

// Tasks not built yet show their planned steps. Filled in by later tickets of the kingdom-admin line.
const TASKS = [
  { id: "roster", label: "Roster Snapshot" },
  { id: "farm-links", label: "Farm links" },
  { id: "fort-week", label: "Fort Week" },
  { id: "reward-promise", label: "Reward Promise" },
  { id: "gh-event", label: "GH Event", meta: "Top 10, Golden Heads", soon: {
    title: "Log a GH Event", body: "Log a GH Event's top 10 with Golden Heads.",
    steps: [["Name and dates", "One result per GH Event"], ["Enter the top 10", "Matched like a Fort Week"], ["Check Golden Heads", "Prefilled 20/10/5/4×7, editable"]] } },
];

function showSignIn(message = "") {
  who.textContent = "";
  signOut.hidden = true;
  main.innerHTML = `
    <section class="panel admin-signin">
      <h2>Council sign-in</h2>
      <p>Enter your email and we'll send you a sign-in link.</p>
      <form id="signin">
        <label class="field">Email
          <input type="email" name="email" required autocomplete="email" placeholder="you@example.com">
        </label>
        <button class="btn primary" type="submit">Send link</button>
      </form>
      <p class="admin-msg" role="status">${esc(message)}</p>
    </section>`;
  const form = document.getElementById("signin");
  const msg = main.querySelector(".admin-msg");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    const button = form.querySelector("button");
    button.disabled = true;
    const redirect = location.origin + location.pathname;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    button.disabled = false;
    msg.textContent = error ? `Could not send the link: ${error.message}` : `Check ${email} for the sign-in link.`;
  });
}

async function showAdmin(session) {
  who.textContent = session.user.email;
  signOut.hidden = false;
  const { data: council, error } = await supabase.rpc("is_council");
  if (error) {
    main.innerHTML = `<div class="panel empty admin-signin">Could not check the Council list: ${esc(error.message)}</div>`;
    return;
  }
  if (!council) {
    main.innerHTML = `<div class="panel empty admin-signin">${esc(session.user.email)} is not on the Council list, so it cannot change data.</div>`;
    return;
  }
  main.innerHTML = `
    <aside class="admin-side">
      <div class="side-label">Council desk</div>
      <nav class="task-nav" aria-label="Council tasks">${TASKS.map((t) => `
        <a class="task" href="#${t.id}" data-task="${t.id}">
          <span class="task-text"><span class="ell">${esc(t.label)}</span><small class="ell">${esc(t.meta ?? "Loading…")}</small></span>
          <span class="badge${t.soon ? " soon" : ""}">${t.soon ? "Soon" : ""}</span>
        </a>`).join("")}
      </nav>
      <p class="side-note">Character ID is the only key. Nothing here merges two Governors by name.</p>
    </aside>
    <div class="admin-content">${TASKS.map((t) => `
      <section id="task-${t.id}" aria-label="${esc(t.label)}" hidden>${t.soon ? soonHtml(t) : ""}</section>`).join("")}
    </div>`;
  showTask();
  showFarmLinks(document.getElementById("task-farm-links"));
  showFortWeek(document.getElementById("task-fort-week"));
  showRewardPromise(document.getElementById("task-reward-promise"));
  showRoster(document.getElementById("task-roster"));
}

function soonHtml(t) {
  return `<div class="reveal">
    <div class="eyebrow">${esc(t.label)}</div>
    <h1 class="task-title">${esc(t.soon.title)}</h1>
    <p class="task-lede">${esc(t.soon.body)}</p>
    <ol class="plan">${t.soon.steps.map(([title, detail], i) => `
      <li><span class="mono">Step ${i + 1}</span><b>${esc(title)}</b>${esc(detail)}</li>`).join("")}
    </ol>
    <p class="soon-note">Coming soon.</p>
  </div>`;
}

// The chosen task lives in the URL hash. Anything else there (say the magic link's tokens) means the first task.
function showTask() {
  if (!document.querySelector(".task-nav")) return;
  const id = TASKS.some((t) => "#" + t.id === location.hash) ? location.hash.slice(1) : TASKS[0].id;
  for (const t of TASKS) {
    document.getElementById("task-" + t.id).hidden = t.id !== id;
    const link = document.querySelector(`.task[data-task="${t.id}"]`);
    if (t.id === id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", showTask);

// The sidebar line and badge for a task. kind: "review" for unsaved work, "" for a count.
function setTaskStatus(id, meta, badge = "", kind = "") {
  const link = document.querySelector(`.task[data-task="${id}"]`);
  if (!link) return;
  link.querySelector("small").textContent = meta;
  const b = link.querySelector(".badge");
  b.textContent = badge;
  b.className = "badge" + (kind ? " " + kind : "");
}

async function allRows(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// ---------- Farm links (ticket 06) ----------
// Suggestions come from the kingdom rules module; this section only reads, writes and draws.

// Decisions taken since the page loaded, so a decided row keeps its label and Undo until a reload.
const farmDecisions = new Map(); // "farmId>mainId" → { farmId, mainId, reason, state: "linked" | "dismissed" }
const FARM_PAGE = 20;
let farmShowAll = false;
let farmBarFrom = 0;

async function showFarmLinks(section, message = "") {
  let governors, dismissed;
  try {
    const [g, d] = await Promise.all([
      allRows("governor", "character_id,current_name,kind,main_character_id"),
      allRows("farm_link_dismissal", "farm_character_id,main_character_id"),
    ]);
    governors = g.map((r) => ({ id: r.character_id, name: r.current_name, kind: r.kind, mainId: r.main_character_id }));
    dismissed = d.map((r) => ({ farmId: r.farm_character_id, mainId: r.main_character_id }));
  } catch (e) {
    section.innerHTML = `<div class="eyebrow">Farm links</div><p class="admin-msg" role="status">Could not load the Governors: ${esc(e.message)}</p>`;
    setTaskStatus("farm-links", "Could not load");
    return;
  }
  const byId = new Map(governors.map((g) => [g.id, g]));
  const nameOf = (id) => byId.get(id)?.name ?? id;
  const label = (g) => `${g.name} (${g.id})`;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const mains = governors.filter((g) => g.kind === "main").sort(byName);
  const farms = governors.filter((g) => g.kind === "farm").sort(byName);
  const key = (s) => s.farmId + ">" + s.mainId;

  // Open suggestions plus this page-load's decisions. A decision whose pair is open again
  // (undone elsewhere, say with Make Main) is dropped.
  const open = farmLinkSuggestions(governors, dismissed);
  const openKeys = new Set(open.map(key));
  for (const k of farmDecisions.keys()) if (openKeys.has(k)) farmDecisions.delete(k);
  const items = [...open.map((s) => ({ ...s, state: null })), ...farmDecisions.values()];

  const groups = new Map();
  for (const s of items) {
    if (!groups.has(s.mainId)) groups.set(s.mainId, { mainId: s.mainId, name: nameOf(s.mainId), list: [] });
    groups.get(s.mainId).list.push(s);
  }
  const ordered = [...groups.values()].sort(byName);
  for (const g of ordered) g.list.sort((a, b) => nameOf(a.farmId).localeCompare(nameOf(b.farmId)));

  // Long lists come in pages of whole groups.
  let shown = ordered;
  if (!farmShowAll) {
    shown = [];
    let n = 0;
    for (const g of ordered) {
      if (n >= FARM_PAGE) break;
      shown.push(g);
      n += g.list.length;
    }
  }
  const hiddenCount = items.length - shown.reduce((n, g) => n + g.list.length, 0);

  const linked = [...farmDecisions.values()].filter((s) => s.state === "linked").length;
  const dismissedNow = farmDecisions.size - linked;
  const progress = items.length ? (linked + dismissedNow) / items.length : 0;
  setTaskStatus("farm-links", `${farms.length} Farms`, open.length ? String(open.length) : "");

  // The reason reads "<Main> + F1"; under its Main only the marker is news.
  const marker = (s) => {
    const m = nameOf(s.mainId);
    return s.reason.startsWith(m) ? s.reason.slice(m.length).trim() : s.reason;
  };
  const groupHtml = (g, gi) => {
    const openHere = g.list.filter((s) => !s.state).length;
    const linkedHere = g.list.filter((s) => s.state === "linked").length;
    const summary = linkedHere
      ? `${linkedHere} linked${openHere ? ` · ${openHere} to review` : ""}`
      : `${g.list.length} suggested ${g.list.length === 1 ? "Farm" : "Farms"}`;
    return `<section class="card main-group reveal" style="--d: calc(var(--stagger) * ${Math.min(gi, 8)})" aria-label="Main ${esc(g.name)}">
      <div class="main-head">
        <span class="eyebrow">Main</span>
        <span class="main-who">${gov(g.mainId, g.name)}</span>
        <span class="sum">${esc(summary)}</span>
        ${openHere > 1 ? `<button class="btn sm" type="button" data-confirm-all="${esc(g.mainId)}">Confirm all ${openHere}</button>` : ""}
      </div>
      <ul class="farm-rows">${g.list.map((s) => `
        <li class="farm-row${s.state ? " " + s.state : ""}">
          <svg class="link-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 3v10a4 4 0 0 0 4 4h9M15 13l4 4-4 4"/></svg>
          <span class="who">${gov(s.farmId, nameOf(s.farmId))}</span>
          <span class="why" title="Why it was suggested">${esc(marker(s))}</span>
          <span class="row-actions">${s.state
            ? `<span class="state ${s.state}">${s.state === "linked" ? "Linked" : "Dismissed"}</span>
               <button class="btn quiet sm" type="button" data-undo="${esc(key(s))}">Undo</button>`
            : `<button class="btn sm" type="button" data-confirm="${esc(s.farmId)}" data-main="${esc(s.mainId)}">Confirm</button>
               <button class="btn quiet sm" type="button" data-dismiss="${esc(s.farmId)}" data-main="${esc(s.mainId)}">Dismiss</button>`}
          </span>
        </li>`).join("")}
      </ul>
    </section>`;
  };

  // A fresh body per draw, so listeners from the previous draw go with it.
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="reveal">
      <div class="eyebrow">Farm links</div>
      <h1 class="task-title">Link Farms to their Mains</h1>
      <p class="task-lede">Suggested from similar names, grouped by Main. Nothing links until you confirm. A linked Farm is credited under its Main, never added to its total.</p>
    </div>
    <p class="admin-msg" role="status">${esc(message)}</p>
    ${items.length ? `
      <div class="progress reveal">
        <span class="num"><b>${linked}</b> <span class="muted">linked ·</span> <b>${dismissedNow}</b> <span class="muted">dismissed ·</span> <b>${open.length}</b> <span class="muted">open of ${items.length}</span></span>
        <span class="bar" role="progressbar" aria-label="Suggestions decided" aria-valuemin="0" aria-valuemax="${items.length}" aria-valuenow="${linked + dismissedNow}"><i style="--p: ${farmBarFrom}"></i></span>
      </div>
      <div class="groups">${shown.map(groupHtml).join("")}</div>
      ${hiddenCount > 0 ? `<button class="btn more" type="button" data-show-all>Show the other ${hiddenCount} suggestions</button>` : ""}`
    : `<p class="card none-left">No suggestions left.</p>`}

    <section class="card admin-card">
      <h2>Mark a Governor as a Farm</h2>
      <p class="muted">For a Farm the name suggestions miss. Pick the Governor from the list; its Main can stay unknown.</p>
      <form id="mark-farm" class="fields">
        <label class="field wide">Governor
          <input name="farm" list="farm-link-governors" required placeholder="Name or Character ID" autocomplete="off">
        </label>
        <datalist id="farm-link-governors">${mains.map((g) => `<option value="${esc(label(g))}">`).join("")}</datalist>
        <label class="field">Its Main
          <select name="main">
            <option value="">Main unknown</option>
            ${mains.map((g) => `<option value="${esc(g.id)}">${esc(label(g))}</option>`).join("")}
          </select>
        </label>
        <button class="btn" type="submit">Save as Farm</button>
      </form>
    </section>

    <section class="card admin-card">
      <h2>Farms <span class="faint num">${farms.length}</span></h2>
      ${farms.length ? `<ul class="farm-list">${farms.map((f) => `
        <li>
          <span class="who">${gov(f.id, f.name)}</span>
          <span class="of">${f.mainId ? `<span class="faint">of</span> ${gov(f.mainId, nameOf(f.mainId))}` : `<span class="tag migrated">Main unknown</span>`}</span>
          <button class="btn quiet sm" type="button" data-unfarm="${esc(f.id)}">Make Main</button>
        </li>`).join("")}</ul>`
      : `<p class="muted">No Governor is marked as a Farm yet.</p>`}
    </section>`;
  section.replaceChildren(body);

  // The progress bar eases from where it stood before this draw.
  const bar = body.querySelector(".progress .bar i");
  if (bar) requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty("--p", progress)));
  farmBarFrom = progress;

  const redraw = (msg) => showFarmLinks(section, msg);

  // Every write returns a sentence on refusal, not a stack trace.
  async function linkFarm(farmId, mainId) {
    const farm = byId.get(farmId);
    const ownFarms = farms.filter((f) => f.mainId === farmId).length;
    if (ownFarms) return `${farm.name} is the Main of ${ownFarms} Farm(s). Make those Mains first.`;
    const { error } = await supabase.from("governor").update({ kind: "farm", main_character_id: mainId }).eq("character_id", farmId);
    // 23514 = Postgres check_violation: a Governor with a Weekly Award must stay a Main.
    if (error?.code === "23514") return `${farm.name} holds a Weekly Award, so it stays a Main.`;
    if (error) return `Could not save ${farm.name}: ${error.message}`;
    return null;
  }
  async function makeMain(id) {
    const { error } = await supabase.from("governor").update({ kind: "main", main_character_id: null }).eq("character_id", id);
    return error ? `Could not save ${nameOf(id)}: ${error.message}` : null;
  }
  const suggestion = (farmId, mainId) => items.find((s) => s.farmId === farmId && s.mainId === mainId);

  body.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-confirm], button[data-confirm-all], button[data-dismiss], button[data-undo], button[data-unfarm], button[data-show-all]");
    if (!b) return;
    if (b.hasAttribute("data-show-all")) {
      farmShowAll = true;
      return redraw(message);
    }
    body.querySelectorAll("button").forEach((x) => (x.disabled = true));
    if (b.dataset.confirm) {
      const s = suggestion(b.dataset.confirm, b.dataset.main);
      const err = await linkFarm(s.farmId, s.mainId);
      if (!err) farmDecisions.set(key(s), { ...s, state: "linked" });
      return redraw(err ?? `${nameOf(s.farmId)} is now a Farm of ${nameOf(s.mainId)}.`);
    }
    if (b.dataset.confirmAll) {
      const todo = items.filter((s) => s.mainId === b.dataset.confirmAll && !s.state);
      let done = 0;
      for (const s of todo) {
        const err = await linkFarm(s.farmId, s.mainId);
        if (err) return redraw(`${err} ${done} of ${todo.length} linked before that.`);
        farmDecisions.set(key(s), { ...s, state: "linked" });
        done++;
      }
      return redraw(`${done} Farms linked to ${nameOf(b.dataset.confirmAll)}.`);
    }
    if (b.dataset.dismiss) {
      const s = suggestion(b.dataset.dismiss, b.dataset.main);
      const { error } = await supabase.from("farm_link_dismissal").insert({ farm_character_id: s.farmId, main_character_id: s.mainId });
      if (!error) farmDecisions.set(key(s), { ...s, state: "dismissed" });
      return redraw(error ? `Could not dismiss: ${error.message}` : `Dismissed ${nameOf(s.farmId)} → ${nameOf(s.mainId)}.`);
    }
    if (b.dataset.undo) {
      const s = farmDecisions.get(b.dataset.undo);
      let err;
      if (s.state === "linked") err = await makeMain(s.farmId);
      else {
        const { error } = await supabase.from("farm_link_dismissal").delete().eq("farm_character_id", s.farmId).eq("main_character_id", s.mainId);
        err = error ? `Could not undo: ${error.message}` : null;
      }
      if (!err) farmDecisions.delete(b.dataset.undo);
      return redraw(err ?? `${nameOf(s.farmId)} → ${nameOf(s.mainId)} is open again.`);
    }
    const err = await makeMain(b.dataset.unfarm);
    redraw(err ?? `${nameOf(b.dataset.unfarm)} is a Main again.`);
  });

  body.querySelector("#mark-farm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const typed = e.target.farm.value.trim();
    const farm = byId.get(typedId(typed));
    if (!farm || farm.kind !== "main") return redraw(`Pick the Governor from the list: "${typed}" is not a Main on it.`);
    const mainId = e.target.main.value || null;
    if (mainId === farm.id) return redraw(`${farm.name} cannot be its own Main.`);
    body.querySelectorAll("button").forEach((x) => (x.disabled = true));
    const err = await linkFarm(farm.id, mainId);
    redraw(err ?? (mainId ? `${farm.name} is now a Farm of ${nameOf(mainId)}.` : `${farm.name} is now a Farm with its Main unknown.`));
  });
}

// Throws a Supabase write's error, named for what was being written.
const check = ({ error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); };

// ---------- Fort Week (tickets 08, 17) ----------
// The reader reads every Fort Week (ADR 0006). The Council Picks the Governor for each "needs ID" row it could not
// match; checkPicks in the rules module decides whether the Picks can be saved, and this section reads, shows and writes.

async function loadFortWeekState() {
  const [governors, names, weeks, entries, awards] = await Promise.all([
    allRows("governor", "character_id,current_name,kind,main_character_id"),
    allRows("governor_name", "character_id,name"),
    allRows("fort_week", "starts_on,completeness"),
    allRows("fort_entry", "week"),
    allRows("weekly_award", "id,week,character_id,place,award,note,weekly_award_item(id,item,amount)"),
  ]);
  const saved = new Map();
  for (const e of entries) saved.set(e.week, (saved.get(e.week) ?? 0) + 1);
  const people = governors.map((g) => ({ id: g.character_id, name: g.current_name, kind: g.kind, mainId: g.main_character_id }));
  return {
    governors: people,
    nameHistory: namesToMatch(people, names),
    weeks: new Map(weeks.map((w) => [w.starts_on, { completeness: w.completeness, rows: saved.get(w.starts_on) ?? 0 }])),
    // The Live Week when the page loaded. A page open across the reset still has it; checkPicks then refuses its Picks.
    liveWeek: fortWeekAt(Date.now()).start,
    // Weekly Awards in id order, so equal places keep the order they were given in. `row` is the award's own id.
    awards: awards.sort((a, b) => a.id - b.id).map((a) => ({
      row: a.id, week: a.week, id: a.character_id, place: a.place, award: a.award, note: a.note,
      items: a.weekly_award_item.sort((x, y) => x.id - y.id).map((x) => ({ item: x.item, amount: x.amount })),
    })),
  };
}

// A read Fort Week's rows in ranking order: Fort Count, then the reading's order. `entry` is the row's own id, which a
// closed-week Pick names. A row read more than one way carries its spellings (names); one an older reader flagged
// without them is needsId, which the next reading never matches.
async function loadWeekRows(week) {
  const res = await supabase.from("fort_entry").select("id,character_id,name,fort_count,spellings,read_two_ways").eq("week", week)
    .order("fort_count", { ascending: false }).order("tie_order").order("id");
  check(res, "Fort Week rows");
  return res.data.map((e) => ({ entry: e.id, id: e.character_id, name: e.name, fortCount: e.fort_count,
    ...(e.spellings ? { names: e.spellings } : e.read_two_ways && e.character_id == null ? { needsId: true } : {}) }));
}

// startWeek keeps the Council on the week it was working on after a reload (saving Picks or a Weekly Award, say).
async function showFortWeek(section, message = "", startWeek = null) {
  let state;
  try {
    state = await loadFortWeekState();
  } catch (e) {
    section.innerHTML = `<div class="eyebrow">Fort Week</div><p class="admin-msg" role="status">Could not load the Fort Weeks: ${esc(e.message)}</p>`;
    setTaskStatus("fort-week", "Could not load");
    return;
  }
  const byId = new Map(state.governors.map((g) => [g.id, g]));
  const label = (g) => `${g.name} (${g.id})`;
  const latest = [...state.weeks.keys()].sort().at(-1);

  // The Fort Week that closed last is the usual one to resolve and give Weekly Awards for.
  let week = startWeek ?? fortWeekAt(Date.now() - 7 * 864e5).start;
  let rows = null; // the week's read rows in ranking order; null while they load
  let loadError = "";
  let picks = []; // the Council's Picks, [{ row, id }], row an index into rows
  let msgText = message;
  // One rule decides whether the Picks can be saved: drawing asks it, and so does Save at click time.
  const judge = (now = Date.now()) => checkPicks({ week, rows: rows ?? [], picks, nameHistory: state.nameHistory,
    governors: state.governors, liveWeek: state.liveWeek, now });

  // Loads the week's rows and drops its Picks. A week changed meanwhile drops what came back.
  async function loadRows() {
    const w = week;
    rows = null;
    loadError = "";
    picks = [];
    draw();
    let loaded = [];
    try {
      if (isFortWeekStart(w)) loaded = await loadWeekRows(w);
    } catch (e) {
      loadError = e.message;
    }
    if (week !== w) return;
    rows = loaded;
    draw();
  }

  function draw() {
    const isMonday = isFortWeekStart(week);
    const { live, problem, nothingYet, newNames } = judge();
    const saved = state.weeks.get(week);
    const range = isMonday ? `${dayMonth(week)} – ${dayMonth(fortWeekEnd(week))}` : week;
    const closed = isMonday && !live && isClosedWeek(week, Date.now());
    setTaskStatus("fort-week", picks.length ? "Picks not saved" : latest ? `Latest ${dayMonth(latest)}` : "No week yet",
      picks.length ? "Review" : "", picks.length ? "review" : "");

    const pickOf = (i) => picks.find((p) => p.row === i)?.id;
    const shown = (rows ?? []).map((r, i) => ({ ...r, id: pickOf(i) ?? r.id }));
    const ranked = rankWeek(shown);
    const twice = governorsTwice(shown);
    const needs = (rows ?? []).filter((r) => r.id == null).length;
    // A Pick on a closed week can move who stands at a paid place; nothing changes the awards on its own.
    const awarded = closed && published(week).length > 0;

    const body = document.createElement("div");
    body.innerHTML = `
      <div class="reveal">
        <div class="eyebrow">Fort Week</div>
        <h1 class="task-title">${isMonday ? `Resolve the ${live ? "Live Week" : "week"} of ${esc(dayMonth(week))}` : "Resolve a Fort Week"}</h1>
        <p class="task-lede">The reader reads every Fort Week. Pick the Governor for each "needs ID" row it could not match; nothing changes until you press Save. ${live
          ? "On the Live Week a Pick goes into Name History, and the reader's next reading matches the name. After Sunday's closing reading no reading follows: Pick the row again once the week closes."
          : "On a closed week a Pick sets the row's Character ID and adds its name to Name History, unless another row that week has or was read as the same name."}</p>
      </div>
      <p class="admin-msg" role="status">${esc(msgText)}</p>

      <section class="card admin-card">
        <h2>Pick the week</h2>
        <form id="fw-week" class="fields">
          <label class="field">Fort Week starting
            <input type="date" name="week" value="${esc(week)}" min="2024-01-01" step="7" required>
          </label>
        </form>
        <p class="match">${!isMonday ? "Pick the Monday the Fort Week starts on."
          : rows == null ? "Loading the week's rows…"
          : loadError ? `Could not load the week's rows: ${esc(loadError)}`
          : !rows.length ? (live ? "There is no reading of the Live Week yet: the reader has not sent one, or the page was opened before the Monday reset (reload it)."
            : closed ? `The week of ${esc(range)} has no rows: the reader did not read it.` : `The week of ${esc(range)} has not started yet.`)
          : `Week of ${esc(range)}${live ? ", the reader's latest reading" : saved ? `, ${esc(saved.completeness)}` : ""}: <b class="num">${rows.length}</b> rows, <b class="num">${needs}</b> needs ID.`}</p>
      </section>

      ${rows?.length ? `
      <section class="card admin-card" aria-label="Rows">
        <h2>Rows <span class="faint num">${rows.length}</span></h2>
        <p class="muted"><span class="num">${rows.length - needs}</span> matched · <span class="num">${needs}</span> needs ID. ${needs
          ? `Pick the Governor for a "needs ID" row, or clear the box to leave it.` : `Every row has its Governor.`}</p>
        <datalist id="fw-governors">${state.governors.map((g) => `<option value="${esc(label(g))}">`).join("")}</datalist>
        <ol class="fw-rows">${shown.map((r, i) => {
          const g = r.id != null ? byId.get(r.id) : null;
          return `
          <li class="fw-row${twice.includes(r.id) ? " clash" : ""}">
            <span class="pos num">${ranked[i].rank}</span>
            <span class="who">
              <span class="name"><span class="ell" title="${esc(r.name)}">${esc(r.name)}</span></span>
              ${r.id != null ? `<span class="pid">${esc(r.id)}</span>` : `<span><span class="tag needs-id">needs ID</span></span>`}
            </span>
            <b class="count num">${r.fortCount}</b>
            ${rows[i].id == null ? `<label class="field fw-gov"><span class="sr-only">Governor for row ${i + 1}, ${esc(r.name)}</span>
              <input list="fw-governors" data-row="${i}" value="${g ? esc(label(g)) : ""}" placeholder="Pick a Governor" autocomplete="off">
            </label>` : `<span class="fw-gov"></span>`}
          </li>`;
        }).join("")}
        </ol>
      </section>
      ${picks.length || (live && needs) ? `
      <div class="save-bar" role="region" aria-label="Unsaved Picks">
        <span class="pulse unsaved" aria-hidden="true"></span>
        <span class="sum">${problem
          ? `<b>${nothingYet ? "Nothing to save yet." : "Fix before saving."}</b> <span>${esc(problem)}</span>`
          : live ? `<b>Not saved yet.</b> <span>${newNames.length} ${newNames.length === 1 ? "name goes" : "names go"} into Name History. The Live Week's rows change at the reader's next reading.</span>`
          : `<b>Not saved yet.</b> <span>${picks.length} ${picks.length === 1 ? "row gets its" : "rows get their"} Character ID.${awarded
            ? " This week's Weekly Awards are published: a Pick can change who stands at a paid place." : ""}</span>`}</span>
        <button class="btn quiet" type="button" data-discard>Clear Picks</button>
        <button class="btn primary" type="button" data-save${problem ? " disabled" : ""}>${live ? "Save to Name History" : "Save Picks"}</button>
      </div>` : ""}` : ""}

      ${saved && closed ? awardsCard(week, range) : ""}`;
    section.replaceChildren(body);
    wire(body);
  }

  // Weekly Awards for a saved, closed Fort Week, as a draft that lives on this page only. It opens with the week's
  // published awards; Fill drafts them from the Reward Promise; add, edit and remove change the draft; Publish
  // replaces the week's awards in one call. A reload drops the draft. Only Mains are offered; the rules module
  // refuses a Farm, and the database refuses one too.
  const mains = state.governors.filter((g) => g.kind !== "farm").sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = (id) => byId.get(id)?.name ?? id;
  const published = (w) => (awardsByWeek(state.awards).find((x) => x.week === w)?.awards ?? [])
    .map((a) => ({ id: a.id, place: a.place, award: a.award ?? null, note: a.note ?? null, items: a.items.map((x) => ({ ...x })) }));
  // The draft: the week it is for, its awards in place order, the promise Fill last used, Fill's skips,
  // whether the Council has changed it since it was opened or filled, the award open in the form, and whether
  // a publish of it is on its way, during which nothing may change it.
  let draft = null;
  const openDraft = () => { draft = { week, awards: published(week), filled: null, skipped: [], edited: false, editing: null, publishing: false }; };
  const sameAwards = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Places in order; equal places keep the order they were given in.
  const setDraftAwards = (awards) => { draft.awards = [...awards].sort((a, b) => a.place - b.place); };

  function awardsCard(w, range) {
    if (draft?.week !== w) openDraft();
    const awards = draft.awards;
    const live = published(w);
    const changed = !sameAwards(awards, live);
    const editing = draft.editing != null ? awards[draft.editing] : null;
    const next = Math.max(0, ...awards.map((a) => a.place)) + 1;
    const amounts = editing ? Object.fromEntries(editing.items.map((x) => [x.item, awardAmountInput(x.item, x.amount)])) : {};
    const f = draft.filled;
    return `
      <section class="card admin-card" aria-label="Weekly Awards">
        <h2>Weekly Awards <span class="faint num">${awards.length}</span></h2>
        <p class="muted">Given for ${esc(range)}. A draft: nothing reaches the public site until you press Publish, and a reload starts again from the published awards. Only Mains are on the list: a Farm never receives a Weekly Award.</p>
        <div class="aw-fill">
          <button class="btn" type="button" data-award-fill>Fill from the promise</button>
          <p class="match">${f ? `Filled from the week of <b>${esc(dayMonth(f.week))}</b>'s Reward Promise${f.week === w ? "" : ", the latest before this week"}, paid on the ${esc(PAID_ON_LABEL[f.paidOn] ?? f.paidOn)} ranking.`
            : live.length ? `Opened with the ${live.length} published ${live.length === 1 ? "award" : "awards"}.` : "No awards published for this week yet."}</p>
        </div>
        ${draft.skipped.length ? `<div class="note" role="note"><span><b>Fill skipped ${draft.skipped.length} ${draft.skipped.length === 1 ? "row" : "rows"}</b>, and the next Main moved up: ${draft.skipped.map((s) => `${esc(s.name)} (${esc(s.reason)})`).join(", ")}. Check whether ${draft.skipped.length === 1 ? "it" : "they"} should have had an award.</span></div>` : ""}
        ${awards.length ? `<ol class="aw-rows">${awards.map((a, i) => `
          <li${i === draft.editing ? ' class="editing"' : ""}>
            <span class="place num p${a.place}">${ordinal(a.place)}</span>
            <span class="who">${gov(a.id, nameOf(a.id))}</span>
            <span class="aw">${a.items.length ? rewardItems(a.items) : ""}${a.award ? `<span>${esc(a.award)}</span>` : ""}${a.note ? `<small>${esc(a.note)}</small>` : ""}</span>
            <span class="row-actions">
              <button class="btn quiet sm" type="button" data-award-edit="${i}">Edit<span class="sr-only"> the ${ordinal(a.place)} place award for ${esc(nameOf(a.id))}</span></button>
              <button class="btn quiet sm" type="button" data-award-remove="${i}">Remove<span class="sr-only"> the ${ordinal(a.place)} place award for ${esc(nameOf(a.id))}</span></button>
            </span>
          </li>`).join("")}</ol>` : `<p class="match">The draft has no awards.${live.length ? " Publishing it clears the week." : ""}</p>`}
        <h3 class="aw-form-title">${editing ? `Edit the ${ordinal(editing.place)} place award` : "Add an award"}</h3>
        <datalist id="aw-mains">${mains.map((g) => `<option value="${esc(label(g))}">`).join("")}</datalist>
        <form id="aw-add" class="fields">
          <label class="field narrow">Place
            <input type="number" name="place" min="1" step="1" value="${editing ? editing.place : next}" required>
          </label>
          <label class="field wide">Main
            <input list="aw-mains" name="main" value="${editing ? esc(label(byId.get(editing.id) ?? { name: editing.id, id: editing.id })) : ""}" placeholder="Pick a Main" autocomplete="off" required>
          </label>
          <fieldset class="field reward-pick">
            <legend>Reward items <span class="faint">· type an amount for each item the award gives</span></legend>
            <div class="reward-grid">${REWARD_ITEMS.map((r) => `
              <label class="reward-opt"><img src="${r.icon}" alt="${esc(r.name)}"><span>${esc(r.name)}</span>
                <input name="item-${r.id}" value="${esc(amounts[r.id] ?? "")}" inputmode="decimal" autocomplete="off" placeholder="${r.kind === "chest" ? "1" : "2M"}" aria-describedby="aw-amount-hint"></label>`).join("")}
            </div>
            <small id="aw-amount-hint" class="faint">A chest takes a count. A resource takes a number with K or M, for example 500K or 2M.</small>
          </fieldset>
          <label class="field wide">Other
            <input name="award" value="${esc(editing?.award ?? "")}" placeholder="Optional, for anything not in the list" autocomplete="off">
          </label>
          <label class="field wide">Note
            <input name="note" value="${esc(editing?.note ?? "")}" placeholder="Optional" autocomplete="off">
          </label>
          <button class="btn" type="submit">${editing ? "Save to draft" : "Add to draft"}</button>
          ${editing ? `<button class="btn quiet" type="button" data-award-cancel>Cancel</button>` : ""}
        </form>
      </section>
      ${changed ? `
      <div class="save-bar" role="region" aria-label="Unpublished Weekly Awards">
        <span class="pulse unsaved" aria-hidden="true"></span>
        <span class="sum"><b>Not published.</b> <span>${awards.length
          ? `${awards.length} ${awards.length === 1 ? "award" : "awards"} for ${esc(range)}${live.length ? `, replacing the ${live.length} published` : ""}.`
          : `Publishing clears the week's ${live.length} published ${live.length === 1 ? "award" : "awards"}.`}</span></span>
        <button class="btn quiet" type="button" data-award-discard${draft.publishing ? " disabled" : ""}>Discard</button>
        <button class="btn primary" type="button" data-award-publish${draft.publishing ? " disabled" : ""}>${draft.publishing ? "Publishing…" : "Publish"}</button>
      </div>` : ""}`;
  }

  function wireAwards(body, msg) {
    const form = body.querySelector("#aw-add");
    if (!form) return;
    const redraw = (text) => { msgText = text; draw(); };

    // Nothing changes the draft while it is being published.
    const busy = () => { if (draft.publishing) msg.textContent = "Publishing… wait for it to finish."; return draft.publishing; };

    body.querySelector("[data-award-fill]").addEventListener("click", async (e) => {
      if (busy()) return;
      if (draft.edited && !confirm("Fill replaces the draft, and your changes to it are lost. Fill anyway?")) return;
      // The week and draft Fill was asked for. The page can move on while the rows load: if the week or the
      // draft changed meanwhile, Fill drops what it loaded rather than write one week's winners into another.
      const w = week, d = draft, asked = d.awards;
      e.target.disabled = true;
      msg.textContent = "Filling…";
      let promises, entries;
      try {
        // The week's rows in the Council's order: Fort Count, then tie order, as the public ranking shows them.
        const res = await supabase.from("fort_entry").select("character_id,name,fort_count").eq("week", w)
          .order("fort_count", { ascending: false }).order("tie_order").order("id");
        check(res, "Fort Week rows");
        entries = res.data.map((r) => ({ id: r.character_id, name: r.name, fortCount: r.fort_count }));
        promises = await loadPromises();
      } catch (err) {
        e.target.disabled = false;
        msg.textContent = `Could not fill: ${err.message}`;
        return;
      }
      if (week !== w || draft !== d || d.publishing || !sameAwards(d.awards, asked)) {
        redraw(`The draft changed while Fill was loading, so Fill drafted nothing. Press Fill again to fill the week of ${dayMonth(week)}.`);
        return;
      }
      const promise = promiseToStartFrom(promises, w);
      if (!promise) {
        redraw(`There is no Reward Promise for the week of ${dayMonth(w)} or any week before it, so Fill drafted nothing.`);
        return;
      }
      const ranking = mainsRanking(entries, state.governors, { withFarms: promise.paidOn === "main_farm" });
      const filled = fillWeeklyAwards(promise, ranking);
      setDraftAwards(filled.awards.map((a) => ({ id: a.id, place: a.place, award: a.award ?? null, note: null, items: a.items })));
      Object.assign(draft, { filled: { week: promise.week, paidOn: promise.paidOn }, skipped: filled.skipped, edited: false, editing: null });
      redraw(`Filled ${filled.awards.length} ${filled.awards.length === 1 ? "award" : "awards"} from the week of ${dayMonth(promise.week)}'s Reward Promise. Check the draft, then publish it.`);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy()) return;
      // Each item with an amount typed is on the award, in list order. A typed amount that is not one
      // stays on as null, so the rules module names the item it is wrong for.
      const items = REWARD_ITEMS.filter((r) => form[`item-${r.id}`].value.trim())
        .map((r) => ({ item: r.id, amount: parseAwardAmount(form[`item-${r.id}`].value, r.kind) }));
      const award = { week, id: typedId(form.main.value.trim()), place: Number(form.place.value), award: form.award.value.trim() || null, note: form.note.value.trim() || null, items };
      const problem = checkWeeklyAward(award, state.governors, Date.now());
      if (problem) { msg.textContent = `Could not ${draft.editing != null ? "change" : "add"} the award: ${problem}`; return; }
      const { week: _, ...a } = award;
      const was = draft.editing;
      setDraftAwards(was != null ? draft.awards.map((x, i) => (i === was ? a : x)) : [...draft.awards, a]);
      Object.assign(draft, { edited: true, editing: null });
      redraw(`${was != null ? "Changed" : "Added"} the ${ordinal(a.place)} place award for ${nameOf(a.id)} in the draft. Publish to put it on the public site.`);
    });
    body.querySelector("[data-award-cancel]")?.addEventListener("click", () => { draft.editing = null; redraw(""); });
    body.querySelectorAll("button[data-award-edit]").forEach((b) => b.addEventListener("click", () => {
      if (busy()) return;
      draft.editing = Number(b.dataset.awardEdit);
      redraw("");
      section.querySelector("#aw-add [name=main]")?.focus();
    }));
    body.querySelectorAll("button[data-award-remove]").forEach((b) => b.addEventListener("click", () => {
      if (busy()) return;
      const i = Number(b.dataset.awardRemove), a = draft.awards[i];
      draft.awards = draft.awards.filter((_, k) => k !== i);
      Object.assign(draft, { edited: true, editing: draft.editing === i ? null : draft.editing != null && draft.editing > i ? draft.editing - 1 : draft.editing });
      redraw(`Removed the ${ordinal(a.place)} place award for ${nameOf(a.id)} from the draft.`);
    }));
    body.querySelector("[data-award-discard]")?.addEventListener("click", () => {
      if (busy()) return;
      openDraft();
      redraw("Discarded the draft. The published awards are unchanged.");
    });

    body.querySelector("[data-award-publish]")?.addEventListener("click", async () => {
      if (busy()) return;
      const w = week, d = draft, awards = d.awards;
      const live = published(w);
      for (const a of awards) {
        const problem = checkWeeklyAward({ ...a, week: w }, state.governors, Date.now());
        if (problem) { msg.textContent = `Could not publish the ${ordinal(a.place)} place award for ${nameOf(a.id)}: ${problem}`; return; }
      }
      if (!awards.length && !confirm(`Publish no awards for the week of ${dayMonth(w)}? Its ${live.length} published ${live.length === 1 ? "award leaves" : "awards leave"} the public site.`)) return;
      d.publishing = true;
      redraw("Publishing…");
      // One call replaces the week's awards and their items together (publish_weekly_awards in supabase/migrations).
      const { error } = await supabase.rpc("publish_weekly_awards", {
        week: w, awards: awards.map((a) => ({ character_id: a.id, place: a.place, award: a.award, note: a.note, items: a.items })),
      });
      if (error) {
        d.publishing = false;
        // 23503 = Postgres foreign_key_violation, from one of weekly_award's two foreign keys: the Fort Week
        // (weekly_award_week_fkey: the week was removed while this page was open) or the Main (a Farm, say).
        redraw(error.code !== "23503" ? `Could not publish: ${error.message}. Nothing changed on the public site.`
          : error.message.includes("weekly_award_week_fkey") ? "Could not publish: this Fort Week is no longer saved. Reload the page."
          : "Could not publish: a Governor on the draft is no longer a Main on record, so it cannot receive a Weekly Award. Nothing changed on the public site.");
        return;
      }
      showFortWeek(section, awards.length
        ? `Published ${awards.length} ${awards.length === 1 ? "award" : "awards"} for the week of ${dayMonth(w)}. ${awards.length === 1 ? "It is" : "They are"} on the public site now.`
        : `Cleared the Weekly Awards for the week of ${dayMonth(w)}.`, w);
    });
  }

  function wire(body) {
    const form = body.querySelector("#fw-week");
    const msg = body.querySelector(".admin-msg");
    wireAwards(body, msg);
    // Leaving a week, or saving its Picks, drops its Weekly Awards draft: never mid-publish, and only on a
    // yes when the draft is not published.
    const leaveDraft = () => {
      if (draft?.publishing) { msg.textContent = "Publishing… wait for it to finish."; return false; }
      const unpublished = draft?.week === week && !sameAwards(draft.awards, published(week));
      return !unpublished || confirm(`Leave the week of ${dayMonth(week)}? Its Weekly Awards draft is not published, and it is lost.`);
    };
    const leavePicks = () => !picks.length || confirm(`Leave the week of ${dayMonth(week)}? Its ${picks.length} unsaved ${picks.length === 1 ? "Pick is" : "Picks are"} lost.`);
    form.addEventListener("submit", (e) => e.preventDefault());
    form.week.addEventListener("change", () => {
      if (!leaveDraft() || !leavePicks()) {
        form.week.value = week;
        return;
      }
      week = form.week.value;
      msgText = "";
      loadRows();
    });

    // A Governor picked from the list is the row's Pick; an empty box leaves it "needs ID".
    body.querySelectorAll("input[data-row]").forEach((input) => input.addEventListener("change", () => {
      const i = Number(input.dataset.row);
      const typed = input.value.trim();
      const g = byId.get(typedId(typed));
      picks = [...picks.filter((p) => p.row !== i), ...(g ? [{ row: i, id: g.id }] : [])].sort((a, b) => a.row - b.row);
      msgText = typed && !g ? `"${typed}" is not on the list, so row ${i + 1} stays "needs ID". Pick the Governor from the list.` : "";
      draw();
    }));

    body.querySelector("[data-discard]")?.addEventListener("click", () => {
      picks = [];
      msgText = "Cleared the Picks. Nothing was saved.";
      draw();
    });

    body.querySelector("[data-save]")?.addEventListener("click", async () => {
      // Judged again now, not when the button was drawn: the Monday reset may have passed since.
      const { live, problem, newNames } = judge(Date.now());
      if (problem) { msg.textContent = `Could not save: ${problem}`; return; }
      if (!leaveDraft()) return;
      const w = week, saving = picks, read = rows;
      body.querySelectorAll(".save-bar button").forEach((x) => (x.disabled = true));
      msg.textContent = "Saving…";
      if (live) {
        // Only the reader writes the Live Week (ADR 0002): its Picks go into Name History and nothing else.
        try {
          check(await saveNames(newNames), "Name History");
          showFortWeek(section, `Added ${newNames.length} ${newNames.length === 1 ? "name" : "names"} to Name History. The reader's next reading of the Live Week matches ${newNames.length === 1 ? "it" : "them"}.`, w);
        } catch (err) {
          body.querySelectorAll(".save-bar button").forEach((x) => (x.disabled = false));
          msg.textContent = `Could not save: ${err.message}`;
        }
        return;
      }
      // A closed week: each Pick sets its row and adds its name to Name History in one call (pick_governor).
      const awarded = published(w).length > 0;
      let done = 0;
      for (const p of saving) {
        const { error } = await supabase.rpc("pick_governor", { week: w, entry: read[p.row].entry, character_id: p.id });
        if (error) {
          const why = `Could not save the Pick for ${read[p.row].name}: ${error.message}`;
          if (!done) {
            body.querySelectorAll(".save-bar button").forEach((x) => (x.disabled = false));
            msg.textContent = `${why} Nothing changed.`;
          } else showFortWeek(section, `${why} The ${done} ${done === 1 ? "Pick" : "Picks"} before it ${done === 1 ? "was" : "were"} saved.`, w);
          return;
        }
        done++;
      }
      showFortWeek(section, `Saved ${done} ${done === 1 ? "Pick" : "Picks"} for the week of ${dayMonth(w)}. ${done === 1 ? "It is" : "They are"} on Fort Rankings now.${awarded
        ? " The ranking changed and this week's Weekly Awards are published: check them, and run Fill again if a paid place moved." : ""}`, w);
    });
  }

  loadRows();
}

// Adds the names of Live Week Picks to Name History; a name already there is left alone.
function saveNames(newNames) {
  return supabase.from("governor_name").upsert(
    newNames.map((n) => ({ character_id: n.id, name: n.name, first_seen: n.firstSeen })),
    { onConflict: "character_id,name", ignoreDuplicates: true });
}

// ---------- Reward Promise (ticket 16) ----------
// What each place will get for a Fort Week, set before the week closes. Home shows the Live Week's promise.
// The rules module checks it; this section reads, shows and writes.

async function loadPromises() {
  const rows = await allRows("reward_promise", "week,intro,paid_on,reward_promise_tier(position,place,reward,items)");
  return rows.map((p) => ({
    week: p.week, intro: p.intro, paidOn: p.paid_on,
    tiers: p.reward_promise_tier.sort((a, b) => a.position - b.position).map((t) => ({ place: t.place, reward: t.reward, items: t.items })),
  }));
}

// A tier as the form holds it: its place and amounts as typed, amounts by item id.
const tierToForm = (t) => ({
  place: String(t.place ?? ""), reward: t.reward ?? "",
  amounts: Object.fromEntries((t.items ?? []).map((x) => [x.item, awardAmountInput(x.item, x.amount)])),
});
const BLANK_TIERS = ["1", "2", "3"].map((place) => ({ place, reward: "", amounts: {} }));
const PAID_ON_LABEL = { mains: "Mains", main_farm: "Main + Farm" };
// A place as typed: a number, or null when the box is empty, so the rules module names it.
const placeOf = (text) => (String(text ?? "").trim() === "" ? null : Number(text));

async function showRewardPromise(section, message = "", startWeek = null) {
  let promises;
  try {
    promises = await loadPromises();
  } catch (e) {
    section.innerHTML = `<div class="eyebrow">Reward Promise</div><p class="admin-msg" role="status">Could not load the Reward Promises: ${esc(e.message)}</p>`;
    setTaskStatus("reward-promise", "Could not load");
    return;
  }
  const liveWeek = fortWeekAt(Date.now()).start;
  const live = promises.find((p) => p.week === liveWeek);
  setTaskStatus("reward-promise", live ? `Week of ${dayMonth(liveWeek)} set` : "Live Week not set");

  let week = startWeek ?? liveWeek;
  let msgText = message;
  let intro, paidOn, tiers, from;
  // The editor starts from the week's own promise, else the latest one before it, else 1st / 2nd / 3rd.
  // Starting from another week carries its places and Paid on.
  const load = () => {
    from = promiseToStartFrom(promises, week);
    intro = from?.intro ?? "";
    paidOn = from?.paidOn ?? "mains";
    tiers = from ? from.tiers.map(tierToForm) : BLANK_TIERS.map((t) => ({ ...t, amounts: {} }));
  };
  load();

  // The form's tiers as a promise for the rules module: each item with an amount typed, in list order.
  // A typed amount that is not one stays on as null, so the rules module names the item it is wrong for.
  const asPromise = () => ({
    week, intro, paidOn,
    tiers: tiers.map((t) => ({
      place: placeOf(t.place), reward: t.reward.trim() || null,
      items: REWARD_ITEMS.filter((r) => t.amounts[r.id]?.trim()).map((r) => ({ item: r.id, amount: parseAwardAmount(t.amounts[r.id], r.kind) })),
    })),
  });

  // The place home will show for a tier as typed, or "" while it is not a whole number yet.
  const formPlace = (t) => (Number.isInteger(placeOf(t.place)) && placeOf(t.place) >= 1 ? ordinal(placeOf(t.place)) : "");

  function draw() {
    const saved = promises.find((p) => p.week === week);
    const isMonday = isFortWeekStart(week);
    const problem = checkRewardPromise(asPromise(), Date.now());
    const when = !isMonday ? "Pick the Monday the Fort Week starts on."
      : isLiveWeek(week, Date.now()) ? `The week of ${dayMonth(week)} is the Live Week: its promise shows on home until the Monday reset.`
      : isClosedWeek(week, Date.now()) ? `The week of ${dayMonth(week)} has closed. Give its Weekly Awards on the Fort Week task.`
      : `The week of ${dayMonth(week)} has not started: its promise shows on home from that Monday.`;
    const state = saved ? "Saved. Saving again replaces it."
      : from ? `Not set yet. The form starts from the week of ${dayMonth(from.week)}'s promise.`
      : "Not set yet.";

    const body = document.createElement("div");
    body.innerHTML = `
      <div class="reveal">
        <div class="eyebrow">Reward Promise</div>
        <h1 class="task-title">Promise the week of ${esc(isMonday ? dayMonth(week) : week)}</h1>
        <p class="task-lede">Say what each place will get, so Governors have something to fight for. Home shows the Live Week's promise beside last week's winners. Once the week closes, give the real Weekly Awards on the Fort Week task.</p>
      </div>
      <p class="admin-msg" role="status">${esc(msgText)}</p>

      <section class="card admin-card">
        <h2>Pick the week</h2>
        <form id="rp-week" class="fields" onsubmit="return false">
          <label class="field">Fort Week starting
            <input type="date" name="week" value="${esc(week)}" min="${esc(liveWeek)}" step="7" required>
          </label>
          <label class="field wide">Intro
            <input name="intro" value="${esc(intro)}" placeholder="Optional. Home uses the standing intro without one" autocomplete="off">
          </label>
          <label class="field">Paid on
            <select name="paid-on">${PAID_ON.map((v) => `<option value="${v}"${paidOn === v ? " selected" : ""}>${PAID_ON_LABEL[v]} ranking</option>`).join("")}</select>
          </label>
        </form>
        <p class="match">${esc(when)} ${esc(state)}</p>
      </section>

      <form id="rp-tiers" onsubmit="return false">
      ${tiers.map((t, i) => `
      <section class="card admin-card" aria-label="Place ${i + 1}">
        <div class="fields">
          <label class="field narrow">Place
            <input name="place-${i}" value="${esc(t.place)}" type="number" min="1" max="${MAX_PLACE}" step="1" inputmode="numeric" placeholder="${i + 1}" required>
          </label>
          <label class="field wide">Other
            <input name="reward-${i}" value="${esc(t.reward)}" placeholder="Optional, for anything not in the list" autocomplete="off">
          </label>
          <button class="btn quiet sm" type="button" data-tier-remove="${i}"${tiers.length === 1 ? " disabled" : ""}>Remove<span class="sr-only"> place ${esc(formPlace(t) || i + 1)}</span></button>
          <fieldset class="field reward-pick">
            <legend>Reward items <span class="faint">· type an amount for each item this place gets</span></legend>
            <div class="reward-grid">${REWARD_ITEMS.map((r) => `
              <label class="reward-opt"><img src="${r.icon}" alt="${esc(r.name)}"><span>${esc(r.name)}</span>
                <input name="item-${i}-${r.id}" value="${esc(t.amounts[r.id] ?? "")}" inputmode="decimal" autocomplete="off" placeholder="${r.kind === "chest" ? "1" : "2M"}" aria-describedby="rp-amount-hint"></label>`).join("")}
            </div>
          </fieldset>
        </div>
      </section>`).join("")}
      </form>
      <p><small id="rp-amount-hint" class="faint">A chest takes a count. A resource takes a number with K or M, for example 500K or 2M.</small></p>
      <p><button class="btn" type="button" data-tier-add>Add place</button></p>

      <div class="save-bar" role="region" aria-label="Reward Promise">
        <span class="pulse unsaved" aria-hidden="true"></span>
        <span class="sum">${problem ? `<b>Fix before saving.</b> <span>${esc(problem)}</span>`
          : `<b>${saved ? "Replaces the saved promise." : "Not saved yet."}</b> <span>${tiers.length} ${tiers.length === 1 ? "place" : "places"} for the week of ${esc(dayMonth(week))}${isLiveWeek(week, Date.now()) ? ", on home as soon as it is saved" : ""}.</span>`}</span>
        ${saved ? `<button class="btn quiet" type="button" data-remove>Remove promise</button>` : ""}
        <button class="btn primary" type="button" data-save${problem ? " disabled" : ""}>Save promise</button>
      </div>`;
    section.replaceChildren(body);
    wire(body);
  }

  // Typing keeps the form's values in `tiers`; the save bar's summary redraws only on change, so focus stays put.
  function readForm(body) {
    const f = body.querySelector("#rp-tiers");
    const w = body.querySelector("#rp-week");
    intro = w.intro.value;
    paidOn = w["paid-on"].value || "mains";
    tiers = tiers.map((_, i) => ({
      place: f[`place-${i}`].value, reward: f[`reward-${i}`].value,
      amounts: Object.fromEntries(REWARD_ITEMS.map((r) => [r.id, f[`item-${i}-${r.id}`].value])),
    }));
  }

  function wire(body) {
    const msg = body.querySelector(".admin-msg");
    body.querySelector("#rp-week").week.addEventListener("change", (e) => {
      week = e.target.value;
      msgText = "";
      load();
      draw();
    });
    body.addEventListener("input", () => readForm(body));
    body.addEventListener("change", (e) => {
      if (e.target.name === "week") return;
      readForm(body);
      const problem = checkRewardPromise(asPromise(), Date.now());
      const sum = body.querySelector(".save-bar .sum");
      const saved = promises.find((p) => p.week === week);
      sum.innerHTML = problem ? `<b>Fix before saving.</b> <span>${esc(problem)}</span>`
        : `<b>${saved ? "Replaces the saved promise." : "Not saved yet."}</b> <span>${tiers.length} ${tiers.length === 1 ? "place" : "places"} for the week of ${esc(dayMonth(week))}.</span>`;
      body.querySelector("[data-save]").disabled = !!problem;
    });
    body.querySelector("[data-tier-add]").addEventListener("click", () => {
      readForm(body);
      // The new card takes the place after the highest one, so a standing 1, 2, 3 grows to 4 in one click.
      const next = Math.max(0, ...tiers.map((t) => placeOf(t.place)).filter(Number.isInteger)) + 1;
      tiers.push({ place: String(next), reward: "", amounts: {} });
      draw();
      section.querySelector(`[name="place-${tiers.length - 1}"]`)?.focus();
    });
    body.querySelectorAll("[data-tier-remove]").forEach((b) => b.addEventListener("click", () => {
      readForm(body);
      tiers.splice(Number(b.dataset.tierRemove), 1);
      draw();
    }));
    body.querySelector("[data-save]").addEventListener("click", async (e) => {
      readForm(body);
      const p = asPromise();
      const problem = checkRewardPromise(p, Date.now());
      if (problem) { msg.textContent = `Could not save the promise: ${problem}`; return; }
      e.target.disabled = true;
      msg.textContent = "Saving…";
      // One call replaces the week's promise and its places together (set_reward_promise in supabase/migrations).
      const { error } = await supabase.rpc("set_reward_promise", { week, intro: intro.trim() || null, paid_on: p.paidOn, tiers: p.tiers });
      if (error) { e.target.disabled = false; msg.textContent = `Could not save the promise: ${error.message}`; return; }
      showRewardPromise(section, `Saved the promise for the week of ${dayMonth(week)}.${isLiveWeek(week, Date.now()) ? " It is on home now." : ""}`, week);
    });
    body.querySelector("[data-remove]")?.addEventListener("click", async (e) => {
      if (!confirm(`Remove the promise for the week of ${dayMonth(week)}?${isLiveWeek(week, Date.now()) ? " It leaves home." : ""}`)) return;
      e.target.disabled = true;
      const { error } = await supabase.from("reward_promise").delete().eq("week", week);
      if (error) { e.target.disabled = false; msg.textContent = `Could not remove the promise: ${error.message}`; return; }
      showRewardPromise(section, `Removed the promise for the week of ${dayMonth(week)}.`, week);
    });
  }

  draw();
}

// ---------- Roster Snapshot (ticket 05, ADR 0004) ----------
// The Roster job saves a Roster Snapshot every day from the Lilith stats export, the only writer
// of snapshots. The Council reads when it last did, and sets a Governor's status by hand where
// the export gets it wrong.

// Lilith publishes each day a day or so late. Keep in step with STALE_DAYS in
// tools/fort-reader/roster.py, the age from which the Roster job emails.
const ROSTER_STALE_DAYS = 3;

async function loadRosterState() {
  const [governors, latest] = await Promise.all([
    allRows("governor", "character_id,current_name,status"),
    supabase.from("roster_snapshot").select("taken_on").order("taken_on", { ascending: false }).limit(1),
  ]);
  if (latest.error) throw new Error(`roster_snapshot: ${latest.error.message}`);
  return {
    last: latest.data[0] ?? null,
    governors: governors.map((g) => ({ id: g.character_id, name: g.current_name, status: g.status })),
  };
}

async function showRoster(section, message = "") {
  let state;
  try {
    state = await loadRosterState();
  } catch (e) {
    section.innerHTML = `<div class="eyebrow">Roster Snapshot</div><p class="admin-msg" role="status">Could not load the roster: ${esc(e.message)}</p>`;
    setTaskStatus("roster", "Could not load");
    return;
  }
  const byId = new Map(state.governors.map((g) => [g.id, g]));
  const label = (g) => `${g.name} (${g.id})`;
  const count = (status) => state.governors.filter((g) => g.status === status).length;
  const last = state.last?.taken_on;
  const age = last ? Math.floor((Date.now() - Date.parse(last + "T00:00:00Z")) / 86400000) : null;
  const stale = age === null || age >= ROSTER_STALE_DAYS;
  setTaskStatus("roster", last ? `Latest ${dayMonth(last)}` : "No snapshot yet", stale ? "Review" : "", stale ? "review" : "");

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="reveal">
      <div class="eyebrow">Roster Snapshot</div>
      <h1 class="task-title">${last ? `Latest: ${esc(dayMonth(last))} ${esc(last.slice(0, 4))}` : "No Roster Snapshot saved yet"}</h1>
      <p class="task-lede">The Roster job saves one every day from the Lilith stats export. <span class="num">${count("inactive")}</span> Inactive · <span class="num">${count("migrated")}</span> Migrated.</p>
    </div>
    <p class="admin-msg" role="status">${esc(message)}</p>
    ${stale ? `<div class="note" role="note"><span>${last
      ? `<b>Nothing newer for ${age} days.</b> Lilith may be late with its stats, or the Roster job has stopped.`
      : `<b>The Roster job hasn't saved a snapshot yet.</b>`}</span></div>` : ""}

    <section class="card admin-card">
      <h2>Set a Governor's status by hand</h2>
      <p class="muted">For a Governor the export gets wrong. A daily Roster Snapshot sets a Governor in the export back to Current, so Inactive or Migrated by hand lasts only for a Governor the export leaves out.</p>
      <form id="set-status" class="fields">
        <label class="field wide">Governor
          <input name="gov" list="roster-governors" required placeholder="Name or Character ID" autocomplete="off">
        </label>
        <datalist id="roster-governors">${state.governors.map((g) => `<option value="${esc(label(g))}">`).join("")}</datalist>
        <label class="field">Status
          <select name="status"><option value="current">Current</option><option value="inactive">Inactive</option><option value="migrated">Migrated</option></select>
        </label>
        <button class="btn" type="submit" disabled>Save status</button>
      </form>
      <p class="match" aria-live="polite">Pick a Governor from the list to see its Character ID.</p>
    </section>`;
  section.replaceChildren(body);

  // The matched Governor's Character ID shows before Save is enabled.
  const msg = body.querySelector(".admin-msg");
  const form = body.querySelector("#set-status");
  const match = body.querySelector(".match");
  const save = form.querySelector("button");
  const matched = () => byId.get(typedId(form.gov.value.trim()));
  form.gov.addEventListener("input", () => {
    const g = matched();
    save.disabled = !g;
    match.innerHTML = g
      ? `Matched <b>${esc(g.name)}</b> <span class="pid">${esc(g.id)}</span> · now ${esc(g.status)}`
      : form.gov.value.trim() ? "No Governor matches yet. Pick one from the list." : "Pick a Governor from the list to see its Character ID.";
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const g = matched();
    if (!g) return;
    const status = form.status.value;
    save.disabled = true;
    const { error } = await supabase.from("governor")
      .update({ status, status_set_by: "council", status_set_at: new Date().toISOString() })
      .eq("character_id", g.id);
    if (error) {
      save.disabled = false;
      msg.textContent = `Could not save ${g.name}: ${error.message}`;
      return;
    }
    showRoster(section, `${g.name} is now ${status[0].toUpperCase() + status.slice(1)}.`);
  });
}

signOut.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// Fires once on load (INITIAL_SESSION, after the magic-link hash is read) and on every sign-in or sign-out.
// It also re-announces the same session (SIGNED_IN when the tab becomes visible again, TOKEN_REFRESHED), so
// the page redraws only when who is signed in changes; a redraw would drop unsaved work.
// Deferred with setTimeout: awaiting a Supabase call inside this callback deadlocks the auth client.
let drawnFor; // the signed-in email the page is drawn for; null when signed out
supabase.auth.onAuthStateChange((_event, session) => {
  const email = session?.user.email ?? null;
  if (email === drawnFor) return;
  drawnFor = email;
  setTimeout(() => (session ? showAdmin(session) : showSignIn()), 0);
});
