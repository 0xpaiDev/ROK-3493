// Council admin page: magic-link sign-in and a section per Council task.
// Row-level security decides who may write; this page only hides the sections from non-Council users.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./store.js";

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
    form.querySelector("button").disabled = true;
    const redirect = location.origin + location.pathname;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    form.querySelector("button").disabled = false;
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
    <section class="panel" id="${s.id}">
      <div class="panel-head"><h2>${s.title}</h2></div>
      <p class="empty">${s.note} Coming soon.</p>
    </section>`).join("");
}

signOut.addEventListener("click", async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
});

// Fires once on load (INITIAL_SESSION, after the magic-link hash is read) and on every sign-in or sign-out.
supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => (session ? showAdmin(session) : showSignIn()), 0);
});
