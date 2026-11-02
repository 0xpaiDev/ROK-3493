// Council admin page: magic-link sign-in, then one Council task at a time from the sidebar.
// Row-level security decides who may write; this page only hides the tasks from non-Council users.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./store.js";
import { farmLinkSuggestions, applyRosterSnapshot, parseStatsExport } from "./kingdom.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const main = document.getElementById("admin");
const who = document.getElementById("who");
const signOut = document.getElementById("sign-out");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gov = (id, name) => `<span class="ell" title="${esc(name)}">${esc(name)}</span><span class="pid">${esc(id)}</span>`;
const dayMonth = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
// A typed "Name (Character ID)" from a datalist, or a bare Character ID.
const typedId = (typed) => typed.match(/\((\d+)\)$/)?.[1] ?? (/^\d+$/.test(typed) ? typed : null);

// Tasks not built yet show their planned steps. Filled in by later tickets of the kingdom-admin line.
const TASKS = [
  { id: "roster", label: "Roster Snapshot" },
  { id: "farm-links", label: "Farm links" },
  { id: "fort-week", label: "Fort Week", meta: "Paste rows, Weekly Awards", soon: {
    title: "Log a Fort Week", body: "Paste a Fort Week's rows and record its Weekly Awards.",
    steps: [["Paste the rows", "Name and Fort Count, from the in-game ranking"], ["Match names", 'Unmatched names stay "needs ID"; ties take Council order'], ["Record Weekly Awards", "Mains only"]] } },
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
  showRoster(document.getElementById("task-roster"), session.user.email);
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

// ---------- Roster Snapshot (ticket 05) ----------
// The rules module parses the export and works out the changes; this section reads, shows and writes.

const SHEETJS = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs";

async function loadRosterState() {
  const [governors, names, latest] = await Promise.all([
    allRows("governor", "character_id,current_name,status,status_set_by,status_set_at"),
    allRows("governor_name", "character_id,name"),
    supabase.from("roster_snapshot").select("id,taken_on").order("taken_on", { ascending: false }).limit(1),
  ]);
  if (latest.error) throw new Error(`roster_snapshot: ${latest.error.message}`);
  const last = latest.data[0] ?? null;
  const previous = [];
  if (last) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("roster_snapshot_row").select("character_id,power").eq("snapshot_id", last.id).range(from, from + 999);
      if (error) throw new Error(`roster_snapshot_row: ${error.message}`);
      previous.push(...data.map((r) => ({ id: r.character_id, power: r.power })));
      if (data.length < 1000) break;
    }
  }
  return {
    last,
    previous,
    governors: governors.map((g) => ({ id: g.character_id, name: g.current_name, status: g.status, statusSetBy: g.status_set_by, statusSetAt: g.status_set_at })),
    nameHistory: names.map((n) => ({ id: n.character_id, name: n.name })),
  };
}

async function readExport(file) {
  const XLSX = await import(SHEETJS);
  const book = XLSX.read(await file.arrayBuffer());
  const sheet = book.Sheets[book.SheetNames[0]];
  return parseStatsExport(file.name, XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }));
}

// The four review groups, in tile order. Each takes the changes and returns { id, name, from? } items.
const REVIEW_GROUPS = [
  { key: "inactive", label: "Become Inactive", hint: "In the last Top 200, missing now",
    items: (c) => c.statusChanges.filter((s) => s.to === "inactive") },
  { key: "back", label: "Back to Current", hint: "Inactive or Migrated before, in this export again",
    items: (c) => c.statusChanges.filter((s) => s.to === "current") },
  { key: "new", label: "New Governors", hint: "Never seen before",
    items: (c) => c.newGovernors },
  { key: "renamed", label: "Renamed", hint: "The new name joins Name History",
    items: (c) => c.renames.map((r) => ({ id: r.id, name: r.to, from: r.from })) },
];

const STEPS = ["Upload export", "Review changes", "Save snapshot"];
const stepsHtml = (current) => `<ol class="steps reveal" aria-label="Steps" style="--d: var(--stagger)">${STEPS.map((s, i) => {
  const state = i < current ? ` class="done"` : i === current ? ` aria-current="step"` : "";
  const mark = i < current
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg><span class="sr-only">Done:</span>`
    : i + 1;
  return `<li${state}><span class="n">${mark}</span>${esc(s)}</li>`;
}).join("")}</ol>`;

const FILE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13l6 5M15 13l-6 5"/></svg>`;

async function showRoster(section, email, message = "") {
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
  const latest = state.last ? `Latest saved snapshot: ${esc(dayMonth(state.last.taken_on))} ${esc(state.last.taken_on.slice(0, 4))}` : "No Roster Snapshot saved yet";

  // pending: an export that was read and reviewed but not saved yet.
  let pending = null;
  let msgText = message;

  function draw() {
    const p = pending;
    setTaskStatus("roster", p ? "Export ready to save" : state.last ? `Latest ${dayMonth(state.last.taken_on)}` : "No snapshot yet", p ? "Review" : "", p ? "review" : "");
    const groups = p ? REVIEW_GROUPS.map((g) => ({ ...g, list: g.items(p.changes) })) : [];
    const newInTop200 = p ? p.changes.top200.filter((id) => !byId.has(id)).length : 0;
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="reveal">
        <div class="eyebrow">Roster Snapshot</div>
        <h1 class="task-title">${p ? `Review the ${esc(dayMonth(p.snapshot.takenOn))} export` : "Upload the Lilith stats export"}</h1>
        <p class="task-lede">${latest} · <span class="num">${count("inactive")}</span> Inactive · <span class="num">${count("migrated")}</span> Migrated. Nothing changes until you press Save.</p>
      </div>
      ${stepsHtml(p ? 1 : 0)}
      <p class="admin-msg" role="status">${esc(msgText)}</p>
      ${p ? `
        <div class="file-row reveal">
          <span class="file-icon">${FILE_ICON}</span>
          <span class="file-meta">
            <b class="ell" title="${esc(p.fileName)}">${esc(p.fileName)}</b>
            <small>Lilith stats export · dated <b class="mono">${esc(p.snapshot.takenOn)}</b> · <span class="num">${p.snapshot.rows.length}</span> Governors</small>
          </span>
          <label class="btn">Replace file<input type="file" class="sr-only" accept=".xlsx" data-export></label>
        </div>
        <div class="tiles">${groups.map((g, i) => `
          <button type="button" class="tile g-${g.key} reveal" style="--d: calc(var(--stagger) * ${i + 2})" aria-pressed="false" data-filter="${g.key}">
            <span class="lbl"><span class="dot"></span>${esc(g.label)}</span>
            <b class="num">${g.list.length}</b>
            <small>${esc(g.hint)}</small>
          </button>`).join("")}
        </div>
        <div class="groups">${groups.map((g) => `
          <section class="card group g-${g.key}" data-group="${g.key}" aria-label="${esc(g.label)}">
            <div class="group-head">
              <span class="dot"></span>
              <h2>${esc(g.label)} <span class="num">${g.list.length}</span></h2>
              <span class="hint">${esc(g.hint)}</span>
            </div>
            ${g.list.length ? `<ul class="gov-grid">${g.list.map((x) => `
              <li><span class="ell" title="${esc(x.from ? `${x.from} → ${x.name}` : x.name)}">${x.from ? `<s>${esc(x.from)}</s> <span class="faint">→</span> ` : ""}${esc(x.name)}</span><span class="pid">${esc(x.id)}</span></li>`).join("")}
            </ul>` : `<p class="none">None in this export.</p>`}
          </section>`).join("")}
        </div>
        <div class="save-bar" role="region" aria-label="Unsaved Roster Snapshot">
          <span class="pulse unsaved" aria-hidden="true"></span>
          <span class="sum"><b>Not saved yet.</b> <span>${groups[0].list.length} become Inactive · ${groups[1].list.length} back to Current · ${p.changes.newGovernors.length} new · ${p.changes.newNames.length} new names join Name History · ${newInTop200} of the Top 200 are new.</span></span>
          <button class="btn quiet" type="button" data-discard>Discard</button>
          <button class="btn primary" type="button" data-save>Save Roster Snapshot</button>
        </div>`
      : `
        <label class="drop reveal" style="--d: calc(var(--stagger) * 2)">
          <span class="file-icon">${FILE_ICON}</span>
          <b>Drop the Lilith stats export here</b>
          <span class="muted">or <span class="linkish-text">choose a file</span></span>
          <small>3493_YYYYMMDD_….xlsx</small>
          <input type="file" class="sr-only" accept=".xlsx" data-export>
        </label>`}

      <section class="card admin-card">
        <h2>Set a Governor's status by hand</h2>
        <p class="muted">For a Governor the export gets wrong. The latest change wins, so a later Roster Snapshot can overrule this.</p>
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
    wire(body);
  }

  async function takeFile(file) {
    if (!file) return;
    let snapshot;
    try {
      snapshot = await readExport(file);
    } catch (err) {
      msgText = `Could not read the export: ${err.message}`;
      return draw();
    }
    // An older export would rewind statuses the newer one already settled.
    if (state.last && snapshot.takenOn <= state.last.taken_on) {
      msgText = `This export is from ${snapshot.takenOn}; the latest Roster Snapshot is already ${state.last.taken_on}.`;
      return draw();
    }
    const changes = applyRosterSnapshot({ governors: state.governors, nameHistory: state.nameHistory, previous: state.previous, snapshot });
    pending = { fileName: file.name, snapshot, changes };
    msgText = "";
    draw();
  }

  function wire(body) {
    const msg = body.querySelector(".admin-msg");
    body.querySelectorAll("input[data-export]").forEach((input) => input.addEventListener("change", () => takeFile(input.files[0])));

    const drop = body.querySelector(".drop");
    if (drop) {
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); takeFile(e.dataTransfer.files[0]); });
    }

    // A tile shows only its group; pressing it again shows all four.
    const tiles = [...body.querySelectorAll(".tile")];
    tiles.forEach((tile) => tile.addEventListener("click", () => {
      const on = tile.getAttribute("aria-pressed") !== "true";
      tiles.forEach((t) => t.setAttribute("aria-pressed", String(on && t === tile)));
      body.querySelectorAll("[data-group]").forEach((g) => (g.hidden = on && g.dataset.group !== tile.dataset.filter));
    }));

    body.querySelector("[data-discard]")?.addEventListener("click", () => {
      pending = null;
      msgText = "Discarded the export. Nothing was saved.";
      draw();
    });

    body.querySelector("[data-save]")?.addEventListener("click", async (e) => {
      const { snapshot, changes } = pending;
      body.querySelectorAll(".save-bar button").forEach((x) => (x.disabled = true));
      msg.textContent = "Saving…";
      try {
        await saveSnapshot(snapshot, changes, email);
        showRoster(section, email, `Saved the ${snapshot.takenOn} Roster Snapshot: ${snapshot.rows.length} Governors.`);
      } catch (err) {
        body.querySelectorAll(".save-bar button").forEach((x) => (x.disabled = false));
        msg.textContent = `Could not save: ${err.message}`;
      }
    });

    // The matched Governor's Character ID shows before Save is enabled.
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
      // Reload so the counts and a later export's review see the change; an unsaved export is dropped.
      showRoster(section, email, `${g.name} is now ${status[0].toUpperCase() + status.slice(1)}.`);
    });
  }

  draw();
}

// Writes in an order that leaves no half snapshot behind: Governors and names first (harmless on
// their own), then the snapshot and its rows (removed again if the rows fail), then statuses.
async function saveSnapshot(snapshot, changes, email) {
  const check = ({ error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); };
  const people = [...changes.newGovernors.map((g) => ({ character_id: g.id, current_name: g.name })),
                  ...changes.renames.map((r) => ({ character_id: r.id, current_name: r.to }))];
  if (people.length) check(await supabase.from("governor").upsert(people, { onConflict: "character_id" }), "Governors");
  if (changes.newNames.length) {
    check(await supabase.from("governor_name").upsert(
      changes.newNames.map((n) => ({ character_id: n.id, name: n.name, first_seen: n.firstSeen })),
      { onConflict: "character_id,name", ignoreDuplicates: true }), "Name History");
  }
  const made = await supabase.from("roster_snapshot").insert({ taken_on: snapshot.takenOn, uploaded_by: email }).select("id").single();
  check(made, "Roster Snapshot");
  const rows = snapshot.rows.map((r) => ({
    snapshot_id: made.data.id, character_id: r.id, power: r.power, highest_power: r.highestPower,
    kill_points: r.killPoints, resources_gathered: r.resources, alliance_helps: r.allianceHelps,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const res = await supabase.from("roster_snapshot_row").insert(rows.slice(i, i + 500));
    if (res.error) {
      await supabase.from("roster_snapshot").delete().eq("id", made.data.id);
      check(res, "Roster Snapshot rows");
    }
  }
  for (const to of ["inactive", "current"]) {
    const ids = changes.statusChanges.filter((c) => c.to === to).map((c) => c.id);
    if (ids.length) {
      check(await supabase.from("governor").update({ status: to, status_set_by: "snapshot", status_set_at: changes.statusSetAt }).in("character_id", ids), "Statuses");
    }
  }
}

signOut.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// Fires once on load (INITIAL_SESSION, after the magic-link hash is read) and on every sign-in or sign-out.
// Deferred with setTimeout: awaiting a Supabase call inside this callback deadlocks the auth client.
supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => (session ? showAdmin(session) : showSignIn()), 0);
});
