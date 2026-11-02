import { rankWeek, fortAverage, fortWeekAt, findInRanking } from "./kingdom.js";
import { loadKingdom } from "./store.js";

(async () => {
  const C = window.KD_CONTENT || { news: [] };
  const app = document.getElementById("app");
  const dlg = document.getElementById("governor");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const d = (iso) => new Date(iso + "T00:00:00");
  const fmtDay = (iso) => { const x = d(iso); return `${x.getDate()} ${MON[x.getMonth()]}`; };
  const fmtRange = (w) => `${fmtDay(w.start)} – ${fmtDay(w.end)}`;
  const isoWeek = (iso) => {
    const t = d(iso); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
    const y = new Date(t.getFullYear(), 0, 4);
    return 1 + Math.round(((t - y) / 864e5 - 3 + ((y.getDay() + 6) % 7)) / 7);
  };
  const big = (n) => {
    if (n == null) return "–";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  };
  const one = (n) => (Math.round(n * 10) / 10).toLocaleString("en");
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  const pad = (n) => String(n).padStart(2, "0");
  const deltaHtml = (v, isNew) => {
    if (isNew) return `<span class="delta new">NEW</span>`;
    if (v == null) return `<span class="delta flat"></span>`;
    if (v === 0) return `<span class="delta flat">±0</span>`;
    return v > 0 ? `<span class="delta up">▲ ${v}</span>` : `<span class="delta down">▼ ${-v}</span>`;
  };
  const who = (g, cls = "") => `<button class="linkish ${cls}" data-gov="${esc(g.key)}">${esc(g.name)}</button>`;
  const PLACE = ["first", "second", "third"];
  const ICON_INFO = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E9C46A" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>`;
  const ICON_GO = `<svg class="go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C3A6FF" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;

  // ---------- countdown to the Fort Week reset (top bar and stat strip) ----------
  const pill = document.getElementById("reset-pill");
  function tick() {
    const wk = fortWeekAt(Date.now());
    const left = Math.max(0, wk.resetsAt - Date.now());
    const text = `${Math.floor(left / 864e5)}d ${pad(Math.floor(left / 36e5) % 24)}h ${pad(Math.floor(left / 6e4) % 60)}m`;
    document.getElementById("reset-label").textContent = `Week ${isoWeek(wk.start)} closes in`;
    document.getElementById("countdown").textContent = text;
    pill.hidden = false;
    document.querySelectorAll("[data-countdown]").forEach((el) => (el.textContent = text));
    return wk;
  }
  tick();
  setInterval(tick, 30000);

  let D;
  try {
    D = await loadKingdom();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="wrap page"><div class="card empty">The Kingdom data could not be loaded. Try again in a minute.</div></div>`;
    return;
  }

  // ---------- Governors keyed by Character ID ----------
  const weeks = D.fortWeeks;
  const governors = new Map();
  const get = (id, name) => {
    const key = id || "name:" + name;
    if (!governors.has(key)) governors.set(key, { key, id, names: [], fort: Array(weeks.length).fill(null), gh: [], kvk: null, roster: null });
    const g = governors.get(key);
    if (name && !g.names.includes(name)) g.names.push(name);
    return g;
  };
  D.roster.forEach((r) => (get(r.id, r.name).roster = r));
  D.kvk.forEach((r) => (get(r.id, r.name).kvk = r));
  D.ghEvents.forEach((ev) => (ev.label = `${fmtDay(ev.startsOn)}–${fmtDay(ev.endsOn)} ${ev.endsOn.slice(0, 4)}`));
  D.ghEvents.forEach((ev) => ev.entries.forEach((e) => get(e.id, e.name).gh.push({ ...e, label: ev.label })));
  const ranked = weeks.map((w) => rankWeek(w.entries));
  ranked.forEach((entries, i) => entries.forEach((e) => (get(e.id, e.name).fort[i] = e)));
  // Name History only adds names to Governors already shown somewhere.
  D.nameHistory.forEach((n) => governors.has(n.id) && get(n.id, n.name));

  for (const g of governors.values()) {
    // Most recent fort name wins, then roster, then whatever we saw first.
    const lastFort = [...g.fort].reverse().find(Boolean);
    g.name = lastFort?.name || g.roster?.name || g.names[0];
    const counts = g.fort.filter(Boolean).map((e) => e.fortCount);
    g.played = counts.length;
    g.total = counts.reduce((a, b) => a + b, 0);
    // A Governor without a Character ID ("needs ID") gets no average: never match by name.
    g.avg = g.id ? fortAverage(weeks, g.id)?.average ?? null : null;
    g.best = g.played ? Math.max(...counts) : 0;
    g.last = g.fort[weeks.length - 1]?.fortCount ?? null;
  }
  const fortGovernors = [...governors.values()].filter((g) => g.played);
  const byKey = (k) => governors.get(k);

  const weekRows = (i) => ranked[i].map((e) => {
    const g = get(e.id, e.name);
    const prev = i > 0 ? g.fort[i - 1] : null;
    const tie = ranked[i].some((o) => o !== e && o.fortCount === e.fortCount);
    return { g, e, tie, delta: prev ? e.fortCount - prev.fortCount : null, isNew: i > 0 && !prev };
  });

  // ---------- views ----------
  const state = { fortView: "weekly", fortWeek: weeks.length - 1, avgSort: "avg", rosterQ: "", rosterSort: "power", rosterLimit: 50, kvkFilter: "all", find: "" };

  function podium(rows) {
    const step = (r, place) => {
      if (!r) return `<div class="step ${PLACE[place]}"></div>`;
      const note = r.tie ? "forts · tie" : place === 0 ? "forts · Champion" : "forts";
      return `
        <div class="step ${PLACE[place]}">
          <div class="medal" aria-label="Rank ${r.e.rank}">${r.e.rank}</div>
          <div class="step-who">${who(r.g)}<span class="pid">${r.g.id ? esc(r.g.id) : "needs ID"}</span></div>
          <div class="step-block"><b class="num" data-count="${r.e.fortCount}">${r.e.fortCount}</b><small>${note}</small></div>
        </div>`;
    };
    return `<div class="podium">${step(rows[1], 1)}${step(rows[0], 0)}${step(rows[2], 2)}</div>`;
  }

  function rankList(rows, { limit = Infinity, deltas = false, stagger = false } = {}) {
    const top = rows[0]?.e.fortCount || 1;
    return `<ol class="rank-list">${rows.slice(0, limit).map((r, n) => {
      const place = r.e.rank <= 3 ? PLACE[r.e.rank - 1] : "";
      const cls = ["row", place, deltas && "with-delta", stagger && "reveal"].filter(Boolean).join(" ");
      const tie = r.tie ? `<span class="tag tie" title="Tied on ${r.e.fortCount} forts. The Council set this order.">Tie<span class="long"> · Council order</span></span>` : "";
      return `
      <li class="${cls}"${stagger ? ` style="--d:${700 + n * 70}ms"` : ""}>
        <span class="pos num">${r.e.rank}</span>
        <span class="row-main">
          <span class="row-name">${who(r.g)}${tie}</span>
          <span class="bar"><i style="width:${(r.e.fortCount / top) * 100}%;animation-delay:${900 + Math.min(n, 15) * 90}ms"></i></span>
        </span>
        <b class="count num">${r.e.fortCount}</b>
        ${deltas ? deltaHtml(r.delta, r.isNew) : ICON_GO}
      </li>`;
    }).join("")}</ol>`;
  }

  const partialNote = `<div class="note">${ICON_INFO}<span>Partial Week: this saved ranking is incomplete. A Governor missing from it has an unknown Fort Count, not 0, and their Fort Average is unaffected.</span></div>`;

  function home() {
    if (!weeks.length) return `<div class="wrap page"><div class="card empty">No Fort Week has been logged yet.</div></div>`;
    const i = weeks.length - 1, w = weeks[i], rows = weekRows(i), wn = isoWeek(w.start);
    const now = fortWeekAt(Date.now()), nowN = isoWeek(now.start);
    const total = w.entries.reduce((a, e) => a + e.fortCount, 0);
    const count = w.entries.length;
    const partial = w.completeness === "partial";
    const leaders = rows.filter((r) => r.e.rank === 1);
    const lead = leaders[0];
    const headline = !lead ? `Week ${wn} is waiting for its first fort.`
      : leaders.length > 1
        ? `${leaders.map((r) => esc(r.g.name)).join(" and ")} tie for the week with <em>${lead.e.fortCount} forts.</em>`
        : `${esc(lead.g.name)} takes the week with <em>${lead.e.fortCount} forts.</em>`;
    const reset = now.resetsAt;
    const R = C.rewards;

    return `
      <section class="hero">
        <div class="glow" aria-hidden="true"></div>
        <svg class="orbit" viewBox="0 0 1440 640" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <g class="spin-a"><circle cx="1060" cy="720" r="520" fill="none" stroke="#A57BFF" stroke-opacity=".10"/><circle cx="540" cy="720" r="3" fill="#C3A6FF" fill-opacity=".7"/></g>
          <g class="spin-b"><circle cx="1060" cy="720" r="380" fill="none" stroke="#A57BFF" stroke-opacity=".14" stroke-dasharray="2 6"/><circle cx="1440" cy="720" r="2.5" fill="#E9C46A" fill-opacity=".8"/></g>
          <circle cx="1060" cy="720" r="250" fill="none" stroke="#A57BFF" stroke-opacity=".18"/>
        </svg>
        <div class="wrap hero-grid">
          <div class="hero-copy">
            <div class="week-meta reveal" style="--d:60ms">
              <span class="eyebrow">Fort Week ${wn}</span><span aria-hidden="true">·</span><span>${fmtRange(w)}</span>
              ${partial ? `<span class="tag partial" title="This saved Weekly Ranking is known to be incomplete">Partial Week</span>` : ""}
            </div>
            <h1 class="reveal" style="--d:140ms">${headline}</h1>
            <p class="hero-sub reveal" style="--d:220ms">${count} Governors ranked in Week ${wn}. Find yourself in the Weekly Ranking${nowN === wn ? "" : `, then go take Week ${nowN}`}.</p>
            <div class="find reveal" style="--d:300ms">
              <label for="find">Find your Governor</label>
              <div class="search-box">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A79FBC" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
                <input id="find" type="search" placeholder="Name or Character ID" autocomplete="off" spellcheck="false" value="${esc(state.find)}" aria-describedby="find-out">
                <span class="kbd" aria-hidden="true">/</span>
              </div>
              <div class="find-out" id="find-out" aria-live="polite">${findResults(state.find)}</div>
            </div>
          </div>
          <div class="hero-podium">
            ${lead ? `<div class="podium-actions reveal" style="--d:400ms"><button class="btn" data-share>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>
              Share the Week ${wn} podium</button></div>` : ""}
            ${podium(rows)}
          </div>
        </div>
      </section>

      <section class="wrap" aria-label="Week ${wn} in numbers">
        <div class="stats">
          <div class="stat reveal" style="--d:380ms"><div class="label">Forts killed</div><div class="value num" data-count="${total}">${total.toLocaleString("en")}</div><div class="sub">Week ${wn}, all Governors</div></div>
          <div class="stat reveal" style="--d:440ms"><div class="label">Governors ranked</div><div class="value num" data-count="${count}">${count}</div><div class="sub">Mains and Farms</div></div>
          <div class="stat reveal" style="--d:500ms"><div class="label">Average Fort Count</div><div class="value num" data-count="${count ? Math.round(total / count) : 0}">${count ? Math.round(total / count) : "–"}</div><div class="sub">per ranked Governor</div></div>
          <div class="stat reveal" style="--d:560ms"><div class="label">Next reset</div><div class="value mono num" data-countdown>${document.getElementById("countdown").textContent}</div><div class="sub">${DAY[reset.getUTCDay()]} ${reset.getUTCDate()} ${MON[reset.getUTCMonth()]} · 00:00 UTC</div></div>
        </div>
      </section>

      <section class="wrap body-grid">
        <div class="card ranking reveal" style="--d:620ms">
          <div class="card-head">
            <div><div class="eyebrow">Weekly Ranking</div><h2>Week ${wn}, top ${Math.min(10, count)}</h2></div>
            <a href="#fort">All ${count} Governors →</a>
          </div>
          ${partial ? partialNote : ""}
          ${rankList(rows, { limit: 10, stagger: true })}
        </div>

        <div class="side">
          ${R ? `<section class="card award shine reveal" style="--d:700ms">
            <div class="award-head"><span class="eyebrow">Weekly Award · Week ${nowN}</span>${R.draft ? '<span class="tag draft">Draft</span>' : ""}</div>
            <h2>${esc(R.title)}</h2>
            <p>${esc(R.intro)}</p>
            <ul class="tiers">${R.tiers.map((t) => `<li><span class="place">${esc(t.place)}</span><span class="reward">${esc(t.reward)}</span></li>`).join("")}</ul>
            ${R.rules?.length ? `<ul class="rules">${R.rules.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          </section>` : ""}
          <section class="card reveal" style="--d:780ms">
            <h2>Kingdom news</h2>
            <div class="news-list">${C.news.map((n) => `
              <article>
                <div class="meta"><span>${fmtDay(n.date)} · ${esc(n.tag)}</span>${n.draft ? '<span class="tag draft">Draft</span>' : ""}</div>
                <h3>${esc(n.title)}</h3><p>${esc(n.body)}</p>
              </article>`).join("") || '<div class="empty">No news yet</div>'}</div>
          </section>
        </div>
      </section>`;
  }

  // "Find your Governor": the query is only ever written into HTML through esc().
  function findResults(query) {
    const q = query.trim();
    if (!q || !weeks.length) return "";
    const i = weeks.length - 1, wn = isoWeek(weeks[i].start);
    const hits = findInRanking(ranked[i], D.nameHistory, q);
    if (!hits.length) {
      return q.length < 2 ? "" : `<p class="find-none">No Governor in the Week ${wn} Weekly Ranking matches “${esc(q)}”. <a href="#fort">Search Fort Rankings →</a></p>`;
    }
    return hits.slice(0, 3).map((e) => {
      const g = get(e.id, e.name);
      return `<button class="find-hit" data-gov="${esc(g.key)}">
        <span class="r num">#${e.rank}</span>
        <span class="who"><b class="ell">${esc(g.name)}</b><small>${g.id ? "Character ID " + esc(g.id) : "needs ID"}</small></span>
        <span class="fc"><b class="num">${e.fortCount}</b><small>forts</small></span>
      </button>`;
    }).join("") + (hits.length > 3 ? `<p class="find-more">${hits.length - 3} more match. Keep typing, or <a href="#fort">open the Weekly Ranking →</a></p>` : "");
  }

  function fort() {
    const head = `
      <div class="section-head reveal">
        <div><div class="eyebrow">Fort grind</div><h1>Fort Rankings</h1>
          <p class="muted">${state.fortView === "weekly" ? "Weekly Rankings. Arrows compare each Governor to their own previous week." : "Every logged Fort Week. A Fort Average starts at each Governor's first ranked week: a missed Complete Week counts as 0, a Partial Week counts only when ranked."}</p></div>
        <div class="seg" role="group" aria-label="View">
          <button data-fortview="weekly" class="${state.fortView === "weekly" ? "on" : ""}" aria-pressed="${state.fortView === "weekly"}">Weekly</button>
          <button data-fortview="avg" class="${state.fortView === "avg" ? "on" : ""}" aria-pressed="${state.fortView === "avg"}">Averages</button>
        </div>
      </div>`;

    if (state.fortView === "weekly") {
      const i = state.fortWeek, w = weeks[i];
      const chips = weeks.map((wk, n) => `<button class="chip ${n === i ? "on" : ""}" data-week="${n}" aria-pressed="${n === i}"><b>Week ${isoWeek(wk.start)}</b><small>${fmtRange(wk)}</small></button>`).reverse().join("");
      return `<div class="wrap page">${head}
        <div class="chips">${chips}</div>
        <section class="card ranking">
          <div class="card-head">
            <div><div class="eyebrow">Weekly Ranking</div><h2>Week ${isoWeek(w.start)} · ${fmtRange(w)}</h2></div>
            <span class="muted">${w.entries.length} ranked</span>
          </div>
          ${w.completeness === "partial" ? partialNote : ""}
          ${rankList(weekRows(i), { deltas: true })}
        </section></div>`;
    }

    const sorters = { avg: (g) => g.avg ?? -1, best: (g) => g.best, total: (g) => g.total, played: (g) => g.played * 1e6 + (g.avg ?? 0), last: (g) => g.last ?? -1 };
    const list = [...fortGovernors].sort((a, b) => sorters[state.avgSort](b) - sorters[state.avgSort](a));
    const maxCount = Math.max(...fortGovernors.map((g) => g.best));
    const th = (k, label) => `<th class="r ${state.avgSort === k ? "sorted" : ""}"><button data-avgsort="${k}">${label}</button></th>`;
    return `<div class="wrap page">${head}
      <section class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Governor</th>${th("avg", "Fort Average")}${th("best", "Best")}${th("total", "Total")}${th("played", "Weeks")}${th("last", "Last week")}<th>Trend</th></tr></thead>
          <tbody>${list.map((g, n) => `<tr>
            <td class="faint num mono">${n + 1}</td>
            <td class="name-cell">${who(g)}</td>
            <td class="r num">${g.avg != null ? `<b>${one(g.avg)}</b>` : '<span class="muted" title="needs ID">–</span>'}</td>
            <td class="r num">${g.best}</td>
            <td class="r num">${g.total}</td>
            <td class="r num">${g.played}/${weeks.length}</td>
            <td class="r num">${g.last ?? '<span class="muted">–</span>'}</td>
            <td><span class="spark" title="${g.fort.map((e, k) => `Week ${isoWeek(weeks[k].start)}: ${e ? e.fortCount : "–"}`).join(" · ")}">${g.fort.map((e) => e ? `<i style="height:${Math.max(3, (e.fortCount / maxCount) * 22)}px"></i>` : `<i class="miss"></i>`).join("")}</span></td>
          </tr>`).join("")}</tbody>
        </table></div>
      </section></div>`;
  }

  function events() {
    const kvk = D.kvk.filter((r) => state.kvkFilter === "all" || r.status.toLowerCase() === state.kvkFilter);
    return `<div class="wrap page">
      <div class="section-head reveal"><div><div class="eyebrow">Events</div><h1>GH Events &amp; KvK</h1></div></div>
      <div class="split">
        <div class="grid">${D.ghEvents.map((ev) => `
          <section class="card">
            <div class="card-head"><div><div class="eyebrow">${esc(ev.name)}</div><h2>${esc(ev.label)}</h2></div></div>
            <ol class="mini-list">${ev.entries.map((e) => {
              const g = e.id ? byKey(e.id) : get(null, e.name);
              return `<li><span class="i num">${e.rank}</span>${who(g)}${e.alliance ? `<span class="tag">${esc(e.alliance)}</span>` : ""}<b class="num" style="min-width:52px;text-align:right">${e.gh} GH</b></li>`;
            }).join("")}</ol>
          </section>`).join("")}
        </div>
        <section class="card">
          <div class="card-head"><div><div class="eyebrow">Hall of fame</div><h2>Last KvK</h2></div></div>
          <div class="seg" role="group" aria-label="Status" style="margin-bottom:12px">
            ${["all", "current", "migrated"].map((f) => `<button data-kvk="${f}" class="${state.kvkFilter === f ? "on" : ""}" aria-pressed="${state.kvkFilter === f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Governor</th><th class="r">Kill points</th><th class="r">Power</th></tr></thead>
            <tbody>${kvk.map((r) => `<tr>
              <td class="faint num mono">${r.rank}</td>
              <td class="name-cell">${who(byKey(r.id))} ${r.status === "Migrated" ? '<span class="tag migrated">Migrated</span>' : ""}</td>
              <td class="r num"><b>${big(r.killPoints)}</b></td>
              <td class="r num">${big(r.power)}</td>
            </tr>`).join("")}</tbody>
          </table></div>
        </section>
      </div></div>`;
  }

  function roster() {
    const q = state.rosterQ.trim().toLowerCase();
    const sorters = { power: (g) => g.roster.power, highestPower: (g) => g.roster.highestPower, resources: (g) => g.roster.resources, fort: (g) => g.avg };
    const all = [...governors.values()].filter((g) => g.roster);
    const list = all
      .filter((g) => !q || g.id?.includes(q) || g.names.some((n) => n.toLowerCase().includes(q)))
      .sort((a, b) => (sorters[state.rosterSort](b) || 0) - (sorters[state.rosterSort](a) || 0));
    const th = (k, label) => `<th class="r ${state.rosterSort === k ? "sorted" : ""}"><button data-rostersort="${k}">${label}</button></th>`;
    return `<div class="wrap page">
      <div class="section-head reveal"><div><div class="eyebrow">Kingdom 3493</div><h1>Roster</h1>
        <p class="muted">${all.length} Governors in the latest Roster Snapshot. Search by any name a Governor has used, or by Character ID.</p></div></div>
      <div class="toolbar"><input class="search" id="rq" type="search" placeholder="Name or Character ID" aria-label="Search the roster" value="${esc(state.rosterQ)}" autocomplete="off" spellcheck="false"></div>
      <section class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Governor</th><th>Character ID</th>${th("power", "Power")}${th("highestPower", "Highest")}${th("resources", "Resources")}${th("fort", "Fort Average")}</tr></thead>
          <tbody>${list.slice(0, state.rosterLimit).map((g, n) => `<tr>
            <td class="faint num mono">${n + 1}</td>
            <td class="name-cell">${who(g)}</td>
            <td class="pid num">${esc(g.id)}</td>
            <td class="r num"><b>${big(g.roster.power)}</b></td>
            <td class="r num">${big(g.roster.highestPower)}</td>
            <td class="r num">${big(g.roster.resources)}</td>
            <td class="r num">${g.avg != null ? one(g.avg) : '<span class="muted">–</span>'}</td>
          </tr>`).join("") || `<tr><td colspan="7" class="empty">No Governor matches “${esc(state.rosterQ)}”</td></tr>`}</tbody>
        </table></div>
        ${list.length > state.rosterLimit ? `<button class="btn more" data-more>Show more (${list.length - state.rosterLimit} left)</button>` : ""}
      </section></div>`;
  }

  function openGovernor(key) {
    const g = byKey(key);
    if (!g) return;
    const r = g.roster;
    dlg.innerHTML = `
      <div class="dlg-head">
        <div class="eyebrow">${g.id ? "Character ID " + esc(g.id) : "needs ID · no Character ID on record"}</div>
        <h2 id="governor-name">${esc(g.name)}</h2>
        <button class="dlg-close" aria-label="Close" data-close>×</button>
      </div>
      <div class="dlg-body">
        ${g.names.length > 1 ? `<div><div class="eyebrow">Name History</div><div class="aka">${g.names.filter((n) => n !== g.name).map((n) => `<span>${esc(n)}</span>`).join("")}</div></div>` : ""}
        <div class="kv">
          <div><small>Fort Average</small><b>${g.avg != null ? one(g.avg) : "–"}</b></div>
          <div><small>Best week</small><b>${g.best || "–"}</b></div>
          <div><small>Weeks ranked</small><b>${g.played}/${weeks.length}</b></div>
          ${r ? `<div><small>Power</small><b>${big(r.power)}</b></div><div><small>Highest power</small><b>${big(r.highestPower)}</b></div><div><small>Resources</small><b>${big(r.resources)}</b></div>` : ""}
        </div>
        ${g.played ? `<div><div class="eyebrow">Fort history</div>
          <ol class="mini-list">${g.fort.map((e, k) => ({ e, k })).reverse().map(({ e, k }) => `<li><span style="flex:1">Week ${isoWeek(weeks[k].start)} <span class="muted">· ${fmtRange(weeks[k])}</span></span>${e ? `<span class="muted mono">#${e.rank}</span><b class="num" style="min-width:40px;text-align:right">${e.fortCount}</b>` : '<span class="muted">not ranked</span>'}</li>`).join("")}</ol></div>` : ""}
        ${g.gh.length ? `<div><div class="eyebrow">GH Events</div><ol class="mini-list">${g.gh.map((x) => `<li><span style="flex:1">${esc(x.label)}</span><span class="muted mono">#${x.rank}</span><b class="num">${x.gh} GH</b></li>`).join("")}</ol></div>` : ""}
        ${g.kvk ? `<div><div class="eyebrow">Last KvK</div><div class="kv"><div><small>Rank</small><b>#${g.kvk.rank}</b></div><div><small>Kill points</small><b>${big(g.kvk.killPoints)}</b></div><div><small>Status</small><b>${esc(g.kvk.status)}</b></div></div></div>` : ""}
      </div>`;
    dlg.showModal();
  }

  // ---------- motion: stat numbers count up (~1.4 s, ease-out) ----------
  function countUp(root) {
    const els = [...root.querySelectorAll("[data-count]")];
    if (reduceMotion.matches || !els.length) return;
    // Final values stay in the markup until a frame runs, so a page with frames paused never shows 0.
    const fmt = (v) => Math.round(v).toLocaleString("en");
    let start = null;
    const frame = (ts) => {
      start ??= ts;
      const p = Math.min(1, Math.max(0, (ts - start - 350) / 1400));
      const e = 1 - Math.pow(1 - p, 4);
      els.forEach((el) => (el.textContent = fmt(+el.dataset.count * e)));
      if (p < 1 && els[0].isConnected) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------- Week champion share card: 1080×1350 PNG, drawn client-side ----------
  async function shareCard() {
    const i = weeks.length - 1, w = weeks[i], rows = weekRows(i), wn = isoWeek(w.start);
    const [c1, c2, c3] = rows;
    await Promise.all(['150px "Instrument Serif"', '600 40px Geist', '26px "Geist Mono"', '600 260px Geist'].map((f) => document.fonts.load(f, c1.g.name)));
    const W = 1080, H = 1350, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const x = cv.getContext("2d");
    const SANS = "Geist, system-ui, sans-serif", MONO = '"Geist Mono", ui-monospace, monospace', SERIF = '"Instrument Serif", Georgia, serif';
    const font = (f) => (x.font = f);
    const fit = (text, f, size, max) => {
      let s = size;
      font(f(s));
      while (x.measureText(text).width > max && s > 56) font(f(--s));
      if (x.measureText(text).width <= max) return text;
      let t = text;
      while (t.length > 1 && x.measureText(t + "…").width > max) t = t.slice(0, -1);
      return t + "…";
    };

    x.fillStyle = "#08060E"; x.fillRect(0, 0, W, H);
    const g = x.createRadialGradient(540, 1350, 0, 540, 1350, 760);
    g.addColorStop(0, "rgba(165,123,255,.45)"); g.addColorStop(1, "rgba(165,123,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const ring = (r, a, dash) => { x.beginPath(); x.setLineDash(dash || []); x.strokeStyle = `rgba(165,123,255,${a})`; x.lineWidth = 1.5; x.arc(540, 1350, r, 0, Math.PI * 2); x.stroke(); };
    ring(700, .12); ring(540, .16, [3, 9]); x.setLineDash([]);
    x.beginPath(); x.strokeStyle = "rgba(233,196,106,.28)"; x.arc(540, 1350, 380, 0, Math.PI * 2); x.stroke();

    // Mark: the V inside two orbit rings
    x.save(); x.translate(96, 88); x.scale(56 / 34, 56 / 34);
    x.lineWidth = 1; x.strokeStyle = "rgba(165,123,255,.6)"; x.beginPath(); x.arc(17, 17, 15.5, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = "rgba(165,123,255,.3)"; x.beginPath(); x.arc(17, 17, 10.5, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = "#EEEAF6"; x.lineWidth = 2; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); x.moveTo(10.5, 11); x.lineTo(17, 24); x.lineTo(23.5, 11); x.stroke();
    x.restore();

    x.textBaseline = "alphabetic";
    x.fillStyle = "#EEEAF6"; font(`600 28px ${SANS}`); x.fillText("Void Legion", 170, 112);
    x.fillStyle = "#A79FBC"; font(`22px ${MONO}`); x.fillText("Kingdom 3493", 170, 142);
    x.fillStyle = "#C3A6FF"; x.textAlign = "right"; x.fillText(`FORT WEEK ${wn}`, 984, 126); x.textAlign = "left";

    x.fillStyle = "#E9C46A"; font(`26px ${MONO}`); x.fillText(c2?.e.rank === 1 ? "WEEK CHAMPION · TIE" : "WEEK CHAMPION", 96, 340);
    x.fillStyle = "#EEEAF6";
    const name = fit(c1.g.name, (s) => `${s}px ${SERIF}`, 150, 888);
    x.fillText(name, 96, 490);
    x.fillStyle = "#A79FBC"; font(`26px ${MONO}`); x.fillText(c1.g.id ? `Character ID ${c1.g.id}` : "needs ID", 96, 550);

    x.fillStyle = "#E9C46A"; font(`600 260px ${SANS}`);
    const fc = String(c1.e.fortCount);
    x.fillText(fc, 90, 840);
    const fx = 90 + x.measureText(fc).width + 28;
    x.fillStyle = "#EEEAF6"; font(`40px ${SANS}`); x.fillText("forts", fx, 790);
    x.fillStyle = "#A79FBC"; font(`28px ${SANS}`); x.fillText(`#${c1.e.rank} of ${rows.length} ranked`, fx, 832);

    x.fillStyle = "rgba(255,255,255,.14)"; x.fillRect(96, 1080, 888, 1.5); x.fillRect(540, 1080, 1.5, 110);
    [[c2, 96], [c3, 568]].forEach(([r, left]) => {
      if (!r) return;
      x.fillStyle = "#A79FBC"; font(`22px ${SANS}`); x.fillText(`${ordinal(r.e.rank)}${r.tie ? " · tie" : ""}`, left, 1132);
      font(`600 34px ${SANS}`);
      const count = ` ${r.e.fortCount}`, cw = x.measureText(count).width;
      const nm = fit(r.g.name, (s) => `600 ${s}px ${SANS}`, 34, 410 - cw);
      x.fillStyle = "#EEEAF6"; x.fillText(nm, left, 1180);
      x.fillStyle = r === c2 ? "#C7CCD8" : "#D08B5B"; x.fillText(count, left + x.measureText(nm).width, 1180);
    });
    x.fillStyle = "#8C84A3"; font(`20px ${MONO}`);
    x.fillText(`${fmtRange(w)} ${w.end.slice(0, 4)}`, 96, 1262);
    x.textAlign = "right"; x.fillText("Enter the void.", 984, 1262); x.textAlign = "left";

    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `void-legion-week-${wn}-champion.png`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // ---------- routing + events ----------
  const views = { home, fort, events, roster };
  function render() {
    const tab = (location.hash.slice(1) || "home").split("/")[0];
    const view = views[tab] ? tab : "home";
    app.innerHTML = views[view]();
    document.querySelectorAll(".tabs a").forEach((a) => {
      const on = a.dataset.tab === view;
      a.classList.toggle("active", on);
      on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
    });
    if (view === "home") countUp(app);
  }

  app.addEventListener("click", async (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.gov) return openGovernor(t.dataset.gov);
    if ("share" in t.dataset) {
      t.disabled = true;
      try { await shareCard(); } catch (err) { console.error(err); } finally { t.disabled = false; }
      return;
    }
    if (t.dataset.fortview) state.fortView = t.dataset.fortview;
    else if (t.dataset.week) state.fortWeek = +t.dataset.week;
    else if (t.dataset.avgsort) state.avgSort = t.dataset.avgsort;
    else if (t.dataset.rostersort) state.rosterSort = t.dataset.rostersort;
    else if (t.dataset.kvk) state.kvkFilter = t.dataset.kvk;
    else if ("more" in t.dataset) state.rosterLimit += 50;
    else return;
    render();
  });
  app.addEventListener("input", (ev) => {
    if (ev.target.id === "find") {
      state.find = ev.target.value;
      document.getElementById("find-out").innerHTML = findResults(state.find);
      return;
    }
    if (ev.target.id !== "rq") return;
    state.rosterQ = ev.target.value;
    state.rosterLimit = 50;
    render();
    const input = document.getElementById("rq");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  // "/" focuses "Find your Governor" (or the roster search on Roster).
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.target.closest("input, textarea, select, [contenteditable]") || dlg.open) return;
    const input = document.getElementById("find") || document.getElementById("rq");
    if (!input) return;
    ev.preventDefault();
    input.focus();
    input.select();
  });
  dlg.addEventListener("click", (ev) => {
    if (ev.target === dlg || ev.target.closest("[data-close]")) return dlg.close();
    const t = ev.target.closest("[data-gov]");
    if (t) openGovernor(t.dataset.gov);
  });
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

  document.getElementById("generated").textContent = `Data updated ${fmtDay(D.generated)} ${D.generated.slice(0, 4)}`;
  render();
})();
