import { rankWeek, fortAverage } from "./kingdom.js";
import { loadKingdom } from "./store.js";

(async () => {
  const C = window.KD_CONTENT || { news: [] };
  const app = document.getElementById("app");
  const dlg = document.getElementById("player");
  let D;
  try {
    D = await loadKingdom();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="panel empty">The Kingdom data could not be loaded. Try again in a minute.</div>`;
    return;
  }

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
  const deltaHtml = (v, isNew) => {
    if (isNew) return `<span class="delta new">NEW</span>`;
    if (v == null) return `<span class="delta flat"></span>`;
    if (v === 0) return `<span class="delta flat">±0</span>`;
    return v > 0 ? `<span class="delta up">▲ ${v}</span>` : `<span class="delta down">▼ ${-v}</span>`;
  };
  const who = (p) => `<button class="linkish" data-player="${esc(p.key)}">${esc(p.name)}</button>`;

  // ---------- players keyed by Character ID ----------
  const weeks = D.fortWeeks;
  const players = new Map();
  const get = (id, name) => {
    const key = id || "name:" + name;
    if (!players.has(key)) players.set(key, { key, id, names: [], fort: Array(weeks.length).fill(null), gh: [], kvk: null, roster: null });
    const p = players.get(key);
    if (name && !p.names.includes(name)) p.names.push(name);
    return p;
  };
  D.roster.forEach((r) => (get(r.id, r.name).roster = r));
  D.kvk.forEach((r) => (get(r.id, r.name).kvk = r));
  D.ghEvents.forEach((ev) => ev.entries.forEach((e) => get(e.id, e.name).gh.push({ ...e, label: ev.label })));
  const ranked = weeks.map((w) => rankWeek(w.entries));
  ranked.forEach((entries, i) => entries.forEach((e) => (get(e.id, e.name).fort[i] = e)));
  // Name History only adds names to Governors already shown somewhere.
  D.nameHistory.forEach((n) => players.has(n.id) && get(n.id, n.name));

  for (const p of players.values()) {
    // Most recent fort name wins, then roster, then whatever we saw first.
    const lastFort = [...p.fort].reverse().find(Boolean);
    p.name = lastFort?.name || p.roster?.name || p.names[0];
    const counts = p.fort.filter(Boolean).map((e) => e.fortCount);
    p.played = counts.length;
    p.total = counts.reduce((a, b) => a + b, 0);
    // A Governor without a Character ID ("needs ID") gets no average: never match by name.
    p.avg = p.id ? fortAverage(weeks, p.id)?.average ?? null : null;
    p.best = p.played ? Math.max(...counts) : 0;
    p.last = p.fort[weeks.length - 1]?.fortCount ?? null;
  }
  const fortPlayers = [...players.values()].filter((p) => p.played);
  const byKey = (k) => players.get(k);

  const weekRows = (i) => ranked[i].map((e) => {
    const p = get(e.id, e.name);
    const prev = i > 0 ? p.fort[i - 1] : null;
    return { p, e, delta: prev ? e.fortCount - prev.fortCount : null, isNew: i > 0 && !prev };
  });

  // ---------- views ----------
  const state = { fortView: "weekly", fortWeek: weeks.length - 1, avgSort: "avg", rosterQ: "", rosterSort: "power", rosterLimit: 50, kvkFilter: "all" };

  function podium(rows) {
    const [a, b, c] = rows;
    const step = (r, cls) => r ? `
      <div class="step ${cls}">
        <div class="who"><div class="medal">${r.e.rank}</div>${who(r.p)}<div class="pid">${esc(r.p.id || "")}</div></div>
        <div class="block"><div class="fort-count num">${r.e.fortCount}</div><small>forts</small></div>
      </div>` : `<div class="step ${cls}"></div>`;
    return `<div class="podium">${step(b, "second")}${step(a, "first")}${step(c, "third")}</div>`;
  }

  function rankList(rows, limit = Infinity) {
    const top = rows[0]?.e.fortCount || 1;
    const cls = ["first", "second", "third"];
    return `<ol class="rank-list">${rows.slice(0, limit).map((r, i) => `
      <li class="rank-row ${r.e.rank <= 3 ? "top " + cls[r.e.rank - 1] : ""}">
        <span class="pos">${r.e.rank}</span>
        <div class="name">${who(r.p)}<div class="bar"><i style="width:${(r.e.fortCount / top) * 100}%"></i></div></div>
        <span class="fort-count num">${r.e.fortCount}</span>
        ${deltaHtml(r.delta, r.isNew)}
      </li>`).join("")}</ol>`;
  }

  function home() {
    const i = weeks.length - 1, w = weeks[i], rows = weekRows(i);
    const sum = (wk) => wk.entries.reduce((a, e) => a + e.fortCount, 0);
    const total = sum(w), prevTotal = i > 0 ? sum(weeks[i - 1]) : null;
    const hunters = w.entries.length, prevHunters = i > 0 ? weeks[i - 1].entries.length : null;
    const bestAvg = fortPlayers.filter((p) => p.avg != null).sort((a, b) => b.avg - a.avg).slice(0, 5);
    const risers = rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
    const R = C.rewards;

    return `
      <section class="hero">
        <div class="hero-top">
          <div>
            <div class="eyebrow">Week ${isoWeek(w.start)} · ${fmtRange(w)}</div>
            <h1>Fort Champions</h1>
            <p class="muted">Top fort hunters of the Void Legion this week.</p>
          </div>
          <a class="more" style="margin:0;align-self:flex-start" href="#fort">Full rankings →</a>
        </div>
        ${podium(rows)}
      </section>

      <div class="stats">
        <div class="panel stat"><div class="label">Forts killed</div><div class="value num">${total.toLocaleString("en")}</div><div class="sub">${prevTotal != null ? deltaHtml(total - prevTotal) + ' <span class="muted">vs last week</span>' : ""}</div></div>
        <div class="panel stat"><div class="label">Hunters ranked</div><div class="value num">${hunters}</div><div class="sub">${prevHunters != null ? deltaHtml(hunters - prevHunters) + ' <span class="muted">vs last week</span>' : ""}</div></div>
        <div class="panel stat"><div class="label">Average per hunter</div><div class="value num">${one(total / hunters)}</div><div class="sub muted">forts this week</div></div>
        <div class="panel stat"><div class="label">Weeks logged</div><div class="value num">${weeks.length}</div><div class="sub muted">since ${fmtDay(weeks[0].start)}</div></div>
      </div>

      <div class="grid home-grid">
        <div class="grid">
          <section class="panel">
            <div class="panel-head"><h2>This week's top 10</h2><a href="#fort">See all ${hunters} →</a></div>
            ${rankList(rows, 10)}
          </section>
          <div class="grid pair">
            <section class="panel">
              <div class="panel-head"><h3>Best average</h3><span class="muted" style="font-size:12px">since first ranked week</span></div>
              <ol class="mini-list">${bestAvg.map((p, n) => `<li><span class="i">${n + 1}</span>${who(p)}<b class="num">${one(p.avg)}</b></li>`).join("")}</ol>
            </section>
            <section class="panel">
              <div class="panel-head"><h3>Biggest climbers</h3><span class="muted" style="font-size:12px">vs last week</span></div>
              ${risers.length ? `<ol class="mini-list">${risers.map((r, n) => `<li><span class="i">${n + 1}</span>${who(r.p)}${deltaHtml(r.delta)}</li>`).join("")}</ol>` : `<div class="empty">No climbers yet</div>`}
            </section>
          </div>
        </div>

        <div class="grid">
          ${R ? `<section class="panel rewards">
            <div class="eyebrow" style="color:var(--gold)">Next week's grind ${R.draft ? '<span class="tag draft">Draft</span>' : ""}</div>
            <h2 style="margin-top:6px">${esc(R.title)}</h2>
            <p class="muted" style="margin:6px 0 0">${esc(R.intro)}</p>
            <ul class="tiers">${R.tiers.map((t) => `<li><span class="place">${esc(t.place)}</span><span>${esc(t.reward)}</span></li>`).join("")}</ul>
            ${R.rules?.length ? `<ul class="rules">${R.rules.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          </section>` : ""}
          <section class="panel">
            <div class="panel-head"><h2>News</h2></div>
            <div class="news">${C.news.map((n) => `
              <article>
                <div class="meta"><span class="tag">${esc(n.tag)}</span>${n.draft ? '<span class="tag draft">Draft</span>' : ""}<span>${fmtDay(n.date)}</span></div>
                <h3>${esc(n.title)}</h3><p>${esc(n.body)}</p>
              </article>`).join("") || '<div class="empty">No news yet</div>'}</div>
          </section>
          <section class="panel recruit">
            <img src="assets/poster.png" alt="Void Legion recruitment poster">
            <div><div class="eyebrow">Recruiting</div><h3 style="margin-top:4px">Join the Void Legion</h3><p>Active, committed players wanted. Contact leadership in game.</p></div>
          </section>
        </div>
      </div>`;
  }

  function fort() {
    const head = `
      <div class="section-head">
        <div><div class="eyebrow">Fort grind</div><h1>Fort Rankings</h1>
          <p class="muted">${state.fortView === "weekly" ? "Weekly results. Arrows compare each Governor to their own previous week." : "Performance across every logged week. Averages start at each Governor's first ranked week: a missed Complete Week counts as 0, a Partial Week counts only when ranked."}</p></div>
        <div class="seg" role="tablist">
          <button data-fortview="weekly" class="${state.fortView === "weekly" ? "on" : ""}">Weekly</button>
          <button data-fortview="avg" class="${state.fortView === "avg" ? "on" : ""}">Averages</button>
        </div>
      </div>`;

    if (state.fortView === "weekly") {
      const i = state.fortWeek, w = weeks[i];
      const chips = weeks.map((wk, n) => `<button class="chip ${n === i ? "on" : ""}" data-week="${n}"><b>Week ${isoWeek(wk.start)}</b><small>${fmtRange(wk)}</small></button>`).reverse().join("");
      return head + `
        <div class="chips" style="margin-bottom:16px">${chips}</div>
        <section class="panel">
          <div class="panel-head"><h2>Week ${isoWeek(w.start)} · ${fmtRange(w)}${w.completeness === "partial" ? ' <span class="tag draft" title="This saved ranking is incomplete">Partial</span>' : ""}</h2><span class="muted">${w.entries.length} ranked</span></div>
          ${rankList(weekRows(i))}
        </section>`;
    }

    const sorters = { avg: (p) => p.avg ?? -1, best: (p) => p.best, total: (p) => p.total, played: (p) => p.played * 1e6 + (p.avg ?? 0), last: (p) => p.last ?? -1 };
    const list = [...fortPlayers].sort((a, b) => sorters[state.avgSort](b) - sorters[state.avgSort](a));
    const maxCount = Math.max(...fortPlayers.map((p) => p.best));
    const th = (k, label) => `<th class="r ${state.avgSort === k ? "sorted" : ""}"><button data-avgsort="${k}">${label}</button></th>`;
    return head + `
      <section class="panel">
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Player</th>${th("avg", "Avg")}${th("best", "Best")}${th("total", "Total")}${th("played", "Weeks")}${th("last", "Last week")}<th>Trend</th></tr></thead>
          <tbody>${list.map((p, n) => `<tr>
            <td class="muted num">${n + 1}</td>
            <td class="name-cell">${who(p)}</td>
            <td class="r num">${p.avg != null ? `<b>${one(p.avg)}</b>` : '<span class="muted" title="needs ID">–</span>'}</td>
            <td class="r num">${p.best}</td>
            <td class="r num">${p.total}</td>
            <td class="r num">${p.played}/${weeks.length}</td>
            <td class="r num">${p.last ?? '<span class="muted">–</span>'}</td>
            <td><span class="spark" title="${p.fort.map((e, k) => `Wk ${isoWeek(weeks[k].start)}: ${e ? e.fortCount : "–"}`).join(" · ")}">${p.fort.map((e) => e ? `<i style="height:${Math.max(3, (e.fortCount / maxCount) * 22)}px"></i>` : `<i class="miss"></i>`).join("")}</span></td>
          </tr>`).join("")}</tbody>
        </table></div>
      </section>`;
  }

  function events() {
    const kvk = D.kvk.filter((r) => state.kvkFilter === "all" || r.status.toLowerCase() === state.kvkFilter);
    return `
      <div class="section-head"><div><div class="eyebrow">Events</div><h1>Events & KvK</h1></div></div>
      <div class="grid home-grid">
        <div class="grid">${D.ghEvents.map((ev) => `
          <section class="panel">
            <div class="panel-head"><div><div class="eyebrow">${esc(ev.name)}</div><h2 style="margin-top:4px">${esc(ev.label)}</h2></div></div>
            <ol class="mini-list">${ev.entries.map((e) => {
              const p = e.id ? byKey(e.id) : get(null, e.name);
              return `<li><span class="i">${e.rank}</span>${who(p)}${e.alliance ? `<span class="tag">${esc(e.alliance)}</span>` : ""}<b class="num" style="min-width:48px;text-align:right">${e.gh} GH</b></li>`;
            }).join("")}</ol>
          </section>`).join("")}
        </div>
        <section class="panel">
          <div class="panel-head"><div><div class="eyebrow">Hall of fame</div><h2 style="margin-top:4px">Last KvK performers</h2></div></div>
          <div class="seg" style="margin-bottom:12px">
            ${["all", "current", "migrated"].map((f) => `<button data-kvk="${f}" class="${state.kvkFilter === f ? "on" : ""}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Player</th><th class="r">Kill pts</th><th class="r">Power</th></tr></thead>
            <tbody>${kvk.map((r) => `<tr>
              <td class="muted num">${r.rank}</td>
              <td class="name-cell">${who(byKey(r.id))} ${r.status === "Migrated" ? '<span class="tag migrated">Migrated</span>' : ""}</td>
              <td class="r num"><b>${big(r.killPoints)}</b></td>
              <td class="r num">${big(r.power)}</td>
            </tr>`).join("")}</tbody>
          </table></div>
        </section>
      </div>`;
  }

  function roster() {
    const q = state.rosterQ.trim().toLowerCase();
    const sorters = { power: (p) => p.roster.power, highestPower: (p) => p.roster.highestPower, resources: (p) => p.roster.resources, fort: (p) => p.avg };
    const all = [...players.values()].filter((p) => p.roster);
    const list = all
      .filter((p) => !q || p.id?.includes(q) || p.names.some((n) => n.toLowerCase().includes(q)))
      .sort((a, b) => (sorters[state.rosterSort](b) || 0) - (sorters[state.rosterSort](a) || 0));
    const th = (k, label) => `<th class="r ${state.rosterSort === k ? "sorted" : ""}"><button data-rostersort="${k}">${label}</button></th>`;
    return `
      <div class="section-head"><div><div class="eyebrow">Kingdom 3493</div><h1>Roster</h1>
        <p class="muted">${all.length} governors in the latest snapshot. Search by any name a player has used, or by Character ID.</p></div></div>
      <div class="toolbar" style="margin-bottom:16px"><input class="search" id="rq" type="search" placeholder="Search name or ID…" value="${esc(state.rosterQ)}" autocomplete="off"></div>
      <section class="panel">
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Player</th><th>Character ID</th>${th("power", "Power")}${th("highestPower", "Highest")}${th("resources", "Resources")}${th("fort", "Fort avg")}</tr></thead>
          <tbody>${list.slice(0, state.rosterLimit).map((p, n) => `<tr>
            <td class="muted num">${n + 1}</td>
            <td class="name-cell">${who(p)}</td>
            <td class="pid num">${esc(p.id)}</td>
            <td class="r num"><b>${big(p.roster.power)}</b></td>
            <td class="r num">${big(p.roster.highestPower)}</td>
            <td class="r num">${big(p.roster.resources)}</td>
            <td class="r num">${p.avg != null ? one(p.avg) : '<span class="muted">–</span>'}</td>
          </tr>`).join("") || `<tr><td colspan="7" class="empty">No governor matches “${esc(state.rosterQ)}”</td></tr>`}</tbody>
        </table></div>
        ${list.length > state.rosterLimit ? `<button class="more" data-more>Show more (${list.length - state.rosterLimit} left)</button>` : ""}
      </section>`;
  }

  function openPlayer(key) {
    const p = byKey(key);
    if (!p) return;
    const r = p.roster;
    dlg.innerHTML = `
      <div class="dlg-head">
        <div class="eyebrow">${p.id ? "Character ID " + esc(p.id) : "No Character ID on record"}</div>
        <h2 id="player-name" style="margin-top:6px">${esc(p.name)}</h2>
        <button class="dlg-close" aria-label="Close" data-close>×</button>
      </div>
      <div class="dlg-body">
        ${p.names.length > 1 ? `<div><div class="eyebrow" style="margin-bottom:8px">Also known as</div><div class="aka">${p.names.filter((n) => n !== p.name).map((n) => `<span>${esc(n)}</span>`).join("")}</div></div>` : ""}
        <div class="kv">
          <div><small>Fort average</small><b class="num">${p.avg != null ? one(p.avg) : "–"}</b></div>
          <div><small>Best week</small><b class="num">${p.best || "–"}</b></div>
          <div><small>Weeks ranked</small><b class="num">${p.played}/${weeks.length}</b></div>
          ${r ? `<div><small>Power</small><b class="num">${big(r.power)}</b></div><div><small>Highest power</small><b class="num">${big(r.highestPower)}</b></div><div><small>Resources</small><b class="num">${big(r.resources)}</b></div>` : ""}
        </div>
        ${p.played ? `<div><div class="eyebrow" style="margin-bottom:8px">Fort history</div>
          <ol class="mini-list">${p.fort.map((e, k) => ({ e, k })).reverse().map(({ e, k }) => `<li><span style="flex:1">Week ${isoWeek(weeks[k].start)} <span class="muted">· ${fmtRange(weeks[k])}</span></span>${e ? `<span class="muted">#${e.rank}</span><b class="num" style="min-width:40px;text-align:right">${e.fortCount}</b>` : '<span class="muted">not ranked</span>'}</li>`).join("")}</ol></div>` : ""}
        ${p.gh.length ? `<div><div class="eyebrow" style="margin-bottom:8px">20GH events</div><ol class="mini-list">${p.gh.map((g) => `<li><span style="flex:1">${esc(g.label)}</span><span class="muted">#${g.rank}</span><b>${g.gh} GH</b></li>`).join("")}</ol></div>` : ""}
        ${p.kvk ? `<div><div class="eyebrow" style="margin-bottom:8px">Last KvK</div><div class="kv"><div><small>Rank</small><b>#${p.kvk.rank}</b></div><div><small>Kill points</small><b>${big(p.kvk.killPoints)}</b></div><div><small>Status</small><b>${esc(p.kvk.status)}</b></div></div></div>` : ""}
      </div>`;
    dlg.showModal();
  }

  // ---------- routing + events ----------
  const views = { home, fort, events, roster };
  function render() {
    const tab = (location.hash.slice(1) || "home").split("/")[0];
    const view = views[tab] ? tab : "home";
    app.innerHTML = views[view]();
    document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === view));
  }

  app.addEventListener("click", (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.player) return openPlayer(t.dataset.player);
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
    if (ev.target.id !== "rq") return;
    state.rosterQ = ev.target.value;
    state.rosterLimit = 50;
    render();
    const input = document.getElementById("rq");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  dlg.addEventListener("click", (ev) => {
    if (ev.target === dlg || ev.target.closest("[data-close]")) return dlg.close();
    const t = ev.target.closest("[data-player]");
    if (t) openPlayer(t.dataset.player);
  });
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

  document.getElementById("generated").textContent = `Data updated ${fmtDay(D.generated)} ${D.generated.slice(0, 4)}`;
  render();
})();
