// Council admin page: magic-link sign-in and a section per Council task.
// Row-level security decides who may write; this page only hides the sections from non-Council users.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./store.js";
import { farmLinkSuggestions } from "./kingdom.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const main = document.getElementById("admin");
const who = document.getElementById("who");
const signOut = document.getElementById("sign-out");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Filled in by later tickets of the kingdom-admin line.
const SECTIONS = [
  { id: "fort-week", title: "Fort Week", note: "Paste a Fort Week's rows and record its Weekly Awards." },
  { id: "gh-event", title: "GH Event", note: "Log a GH Event's top 10 with Golden Heads." },
  { id: "roster", title: "Roster Snapshot", note: "Upload the Lilith stats export." },
  { id: "farm-links", title: "Farm links", note: "Link Farms to their Mains." },
];

function showSignIn(message = "") {
  who.textContent = "";
  signOut.hidden = true;
  main.innerHTML = `
    <section class="panel admin-signin">
      <h2>Council sign-in</h2>
      <p>Enter your email and we'll send you a sign-in link.</p>
      <form id="signin">
        <input type="email" name="email" required autocomplete="email" placeholder="you@example.com" aria-label="Email">
        <button type="submit">Send link</button>
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
    main.innerHTML = `<div class="panel empty">Could not check the Council list: ${esc(error.message)}</div>`;
    return;
  }
  if (!council) {
    main.innerHTML = `<div class="panel empty">${esc(session.user.email)} is not on the Council list, so it cannot change data.</div>`;
    return;
  }
  main.innerHTML = SECTIONS.map((s) => `
    <section class="panel" id="${esc(s.id)}">
      <div class="panel-head"><h2>${esc(s.title)}</h2></div>
      <p class="empty">${esc(s.note)} Coming soon.</p>
    </section>`).join("");
  showFarmLinks(document.getElementById("farm-links"));
}

// ---------- Farm links (ticket 06) ----------
// Suggestions come from the kingdom rules module; this section only reads, writes and draws.

async function allRows(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

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
    section.innerHTML = `<div class="panel-head"><h2>Farm links</h2></div><p class="empty">Could not load the Governors: ${esc(e.message)}</p>`;
    return;
  }
  const byId = new Map(governors.map((g) => [g.id, g]));
  const label = (g) => `${g.name} (${g.id})`;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const mains = governors.filter((g) => g.kind === "main").sort(byName);
  const farms = governors.filter((g) => g.kind === "farm").sort(byName);
  const suggestions = farmLinkSuggestions(governors, dismissed);

  // A fresh body per draw, so listeners from the previous draw go with it.
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="panel-head"><h2>Farm links</h2><span class="muted">${farms.length} Farms · ${suggestions.length} suggestions</span></div>
    <p class="admin-msg" role="status">${esc(message)}</p>

    <h3>Suggested from similar names</h3>
    ${suggestions.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Farm</th><th>Main</th><th>Why</th><th></th></tr></thead>
      <tbody>${suggestions.map((s) => `<tr>
        <td>${esc(byId.get(s.farmId).name)} <span class="pid">${esc(s.farmId)}</span></td>
        <td>${esc(byId.get(s.mainId).name)} <span class="pid">${esc(s.mainId)}</span></td>
        <td class="muted">${esc(s.reason)}</td>
        <td class="admin-actions">
          <button class="btn" data-confirm="${esc(s.farmId)}" data-main="${esc(s.mainId)}">Confirm</button>
          <button class="btn" data-dismiss="${esc(s.farmId)}" data-main="${esc(s.mainId)}">Dismiss</button>
        </td></tr>`).join("")}</tbody></table></div>`
    : `<p class="empty">No suggestions left.</p>`}

    <h3>Mark a Governor as a Farm</h3>
    <form id="mark-farm" class="admin-form">
      <input name="farm" list="farm-link-governors" required placeholder="Governor name or Character ID" aria-label="Governor">
      <datalist id="farm-link-governors">${mains.map((g) => `<option value="${esc(label(g))}">`).join("")}</datalist>
      <select name="main" aria-label="Its Main">
        <option value="">Main unknown</option>
        ${mains.map((g) => `<option value="${esc(g.id)}">${esc(label(g))}</option>`).join("")}
      </select>
      <button class="btn" type="submit">Save as Farm</button>
    </form>

    <h3>Farms</h3>
    ${farms.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Farm</th><th>Main</th><th></th></tr></thead>
      <tbody>${farms.map((f) => `<tr>
        <td>${esc(f.name)} <span class="pid">${esc(f.id)}</span></td>
        <td>${f.mainId ? `${esc(byId.get(f.mainId)?.name)} <span class="pid">${esc(f.mainId)}</span>` : `<span class="tag migrated">Main unknown</span>`}</td>
        <td class="admin-actions"><button class="btn" data-unfarm="${esc(f.id)}">Make Main</button></td></tr>`).join("")}</tbody></table></div>`
    : `<p class="empty">No Governor is marked as a Farm yet.</p>`}`;
  section.replaceChildren(body);

  const redraw = (msg) => showFarmLinks(section, msg);

  // Every write goes through here so a refusal shows as a sentence, not a stack trace.
  async function linkFarm(farmId, mainId) {
    const farm = byId.get(farmId);
    const ownFarms = farms.filter((f) => f.mainId === farmId).length;
    if (ownFarms) return redraw(`${farm.name} is the Main of ${ownFarms} Farm(s). Make those Mains first.`);
    const { error } = await supabase.from("governor").update({ kind: "farm", main_character_id: mainId }).eq("character_id", farmId);
    if (error?.code === "23514") return redraw(`${farm.name} holds a Weekly Award, so it stays a Main.`);
    if (error) return redraw(`Could not save ${farm.name}: ${error.message}`);
    redraw(mainId ? `${farm.name} is now a Farm of ${byId.get(mainId).name}.` : `${farm.name} is now a Farm with its Main unknown.`);
  }

  body.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-confirm], button[data-dismiss], button[data-unfarm]");
    if (!b) return;
    body.querySelectorAll("button").forEach((x) => (x.disabled = true));
    if (b.dataset.confirm) return linkFarm(b.dataset.confirm, b.dataset.main);
    if (b.dataset.dismiss) {
      const { error } = await supabase.from("farm_link_dismissal").insert({ farm_character_id: b.dataset.dismiss, main_character_id: b.dataset.main });
      return redraw(error ? `Could not dismiss: ${error.message}` : `Dismissed ${byId.get(b.dataset.dismiss).name} → ${byId.get(b.dataset.main).name}.`);
    }
    const g = byId.get(b.dataset.unfarm);
    const { error } = await supabase.from("governor").update({ kind: "main", main_character_id: null }).eq("character_id", g.id);
    redraw(error ? `Could not save ${g.name}: ${error.message}` : `${g.name} is a Main again.`);
  });

  body.querySelector("#mark-farm").addEventListener("submit", (e) => {
    e.preventDefault();
    const typed = e.target.farm.value.trim();
    const id = typed.match(/\((\d+)\)$/)?.[1] ?? (/^\d+$/.test(typed) ? typed : null);
    const farm = byId.get(id);
    if (!farm || farm.kind !== "main") return redraw(`Pick the Governor from the list: "${typed}" is not a Main on it.`);
    const mainId = e.target.main.value || null;
    if (mainId === farm.id) return redraw(`${farm.name} cannot be its own Main.`);
    body.querySelectorAll("button").forEach((x) => (x.disabled = true));
    linkFarm(farm.id, mainId);
  });
}

signOut.addEventListener("click", async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
});

// Fires once on load (INITIAL_SESSION, after the magic-link hash is read) and on every sign-in or sign-out.
// Deferred with setTimeout: awaiting a Supabase call inside this callback deadlocks the auth client.
supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => (session ? showAdmin(session) : showSignIn()), 0);
});
