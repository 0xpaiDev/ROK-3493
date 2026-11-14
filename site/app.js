import { mainsRanking, fortAverage, fortWeekAt, fortWeekEnd, findInRanking, isLiveWeek, awardsByWeek, awardsOf, homeWeek, awardAmountLabel, livePromise } from "./kingdom.js";
import { loadKingdom } from "./store.js";
import { rewardItem } from "./rewards.js";

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
  // An award's reward items: icon, amount and name for each ("×1 Legendary Chest", "2M Food").
  // An item id the list no longer has shows as its id rather than vanishing.
  const rewardItems = (items) => `<span class="reward-items">${items.map((x) => {
    const r = rewardItem(x.item);
    return `<span class="reward-item">${r ? `<img src="${r.icon}" alt="${esc(r.name)}" loading="lazy">` : ""}<b class="num">${esc(awardAmountLabel(x.item, x.amount))}</b> ${esc(r?.name ?? x.item)}</span>`;
  }).join("")}</span>`;
  // What an award gives: its reward items, then any free text. An award from before reward items is text only.
  const awardBody = (a, textTag = "span") => `${a.items?.length ? rewardItems(a.items) : ""}${a.award ? `<${textTag} class="reward">${esc(a.award)}</${textTag}>` : ""}`;
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
  const weekLabel = (start) => `Week ${isoWeek(start)} · ${fmtRange({ start, end: fortWeekEnd(start) })}`;
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
  const now = Date.now();
  const isLive = (w) => isLiveWeek(w.start, now);
  // The week home, Find your Governor and the share card show: the Live Week once it has rows, else the last closed week.
  const homeI = homeWeek(weeks, now);
  const governors = new Map();
  // A Fort Week row with no Character ID ("needs ID") is keyed by its own row, so two such rows
  // with the same name stay two Governors: names never merge Governors.
  const get = (id, name, entry = null) => {
    const key = id || (entry != null ? "entry:" + entry : "name:" + name);
    if (!governors.has(key)) governors.set(key, { key, id, names: [], fort: Array(weeks.length).fill(null), gh: [], kvk: null, roster: null });
    const g = governors.get(key);
    if (name && !g.names.includes(name)) g.names.push(name);
    return g;
  };
  D.roster.forEach((r) => (get(r.id, r.name).roster = r));
  D.kvk.forEach((r) => (get(r.id, r.name).kvk = r));
  D.ghEvents.forEach((ev) => (ev.label = `${fmtDay(ev.startsOn)}–${fmtDay(ev.endsOn)} ${ev.endsOn.slice(0, 4)}`));
  D.ghEvents.forEach((ev) => ev.entries.forEach((e) => get(e.id, e.name).gh.push({ ...e, label: ev.label })));
  // Each Governor's Fort history keeps their own Fort Count: a Main's Mains-only rank, a Farm's
  // count with no rank. The summed "Main + Farm" counts live only in `grouped`.
  const plain = weeks.map((w) => mainsRanking(w.entries, D.governors));
  const grouped = weeks.map((w) => mainsRanking(w.entries, D.governors, { withFarms: true }));
  weeks.forEach((_, i) => {
    plain[i].forEach((r) => (get(r.id, r.name, r.entry).fort[i] = r));
    grouped[i].forEach((r) => {
      if (r.unlinked) get(r.id, r.name, r.entry).fort[i] = r;
      r.farms.forEach((f) => (get(f.id, f.name).fort[i] = { ...f, rank: null }));
    });
  });
  const record = new Map(D.governors.map((x) => [x.id, x]));
  const farmTag = (g) => {
    const rec = g.id ? record.get(g.id) : null;
    if (rec?.kind !== "farm") return "";
    return rec.mainId ? `<span class="tag farm" title="Farm of ${esc(record.get(rec.mainId)?.name)}">Farm</span>` : `<span class="tag farm">Farm · unlinked</span>`;
  };
  const farmsOf = (id) => D.governors.filter((x) => x.kind === "farm" && x.mainId === id);
  // Name History only adds names to Governors already shown somewhere.
  D.nameHistory.forEach((n) => governors.has(n.id) && get(n.id, n.name));
  // A Main with a Weekly Award has a popup even if it was never ranked or in a Roster Snapshot.
  D.weeklyAwards.forEach((a) => get(a.id, record.get(a.id)?.name));

  for (const g of governors.values()) {
    // The current name on record wins (Roster Snapshots keep it up to date). A pasted fort name is
    // only a fallback, e.g. for a "needs ID" entry with no Governor on record.
    const lastFort = [...g.fort].reverse().find(Boolean);
    g.name = (g.id && record.get(g.id)?.name) || g.roster?.name || lastFort?.name || g.names[0];
    const counts = g.fort.filter(Boolean).map((e) => e.fortCount);
    g.played = counts.length;
    g.total = counts.reduce((a, b) => a + b, 0);
    // A Governor without a Character ID ("needs ID") gets no average: never match by name.
    g.avg = g.id ? fortAverage(weeks, g.id, now)?.average ?? null : null;
    g.best = g.played ? Math.max(...counts) : 0;
    g.last = g.fort[weeks.length - 1]?.fortCount ?? null;
    g.awards = g.id ? awardsOf(D.weeklyAwards, g.id) : [];
  }
  const fortGovernors = [...governors.values()].filter((g) => g.played);
  const byKey = (k) => governors.get(k);
  const awardWeeks = awardsByWeek(D.weeklyAwards);

  // A Fort Week's Weekly Awards in place order: place in its metal, the Main, the award and the Council's note.
  const winnersList = (awards) => `<ol class="tiers winners">${awards.map((a) => `
    <li><span class="place num p${a.place}">${ordinal(a.place)}</span>
      <span class="aw">${who(byKey(a.id))}${awardBody(a)}${a.note ? `<small>${esc(a.note)}</small>` : ""}</span></li>`).join("")}</ol>`;

  // One Weekly Ranking row per Main (and, with Farms, per unlinked Farm), each with its Farm rows.
  // A row's arrow compares like with like: a summed Main against its sum the week before.
  const row = (i, e, rows, summed = false) => {
    const g = get(e.id, e.name, e.entry);
    const prev = i === 0 ? null
      : summed && e.id != null ? grouped[i - 1].find((r) => r.id === e.id && r.rank != null)
      : g.fort[i - 1];
    const tie = e.rank != null && rows.some((o) => o !== e && o.rank != null && o.fortCount === e.fortCount);
    return { g, e, tie, delta: prev ? e.fortCount - prev.fortCount : null, isNew: i > 0 && !prev };
  };
  const weekRows = (i, withFarms = false) => {
    const rows = withFarms ? grouped[i] : plain[i];
    // A summed Main lists the parts of its total under it: its own Fort Count first, then each Farm's.
    return rows.map((e) => ({
      ...row(i, e, rows, withFarms && e.rank != null),
      parts: e.farms?.length ? [{ ...row(i, { ...e, fortCount: e.own, rank: null }, []), self: true }, ...e.farms.map((f) => row(i, f, []))] : [],
    }));
  };

  // ---------- views ----------
  // Fort Rankings opens on the week home shows, so home's "All N Mains →" and Find links land on it.
  const state = { fortView: "weekly", withFarms: false, fortWeek: homeI >= 0 ? homeI : weeks.length - 1, avgSort: "avg", rosterQ: "", rosterSort: "power", rosterLimit: 50, rosterAll: false, kvkFilter: "all", find: "" };

  function podium(rows, { live = false } = {}) {
    const step = (r, place) => {
      if (!r) return `<div class="step ${PLACE[place]}"></div>`;
      const note = r.tie ? "forts · tie" : place === 0 ? (live ? "forts · leading" : "forts · Champion") : "forts";
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
    const top = Math.max(1, ...rows.map((r) => r.e.fortCount));
    const li = (r, n, { part = false } = {}) => {
      const place = r.e.rank != null && r.e.rank <= 3 ? PLACE[r.e.rank - 1] : "";
      const cls = ["row", place, part && "part", deltas && "with-delta", stagger && "reveal"].filter(Boolean).join(" ");
      const tie = r.tie ? `<span class="tag tie" title="Tied on ${r.e.fortCount} forts. The Council set this order.">Tie<span class="long"> · Council order</span></span>` : "";
      const tags = tie
        + (!part && r.g.id == null ? `<span class="tag needs-id" title="No Character ID on record yet. The Council will pick the Governor.">needs ID</span>` : "")
        + (r.e.unlinked ? `<span class="tag farm" title="A Farm not yet linked to its Main">Farm · unlinked</span>` : "")
        + (part ? (r.self
          ? `<span class="tag farm" title="The Main's own Fort Count, part of the total above">Main</span>`
          : `<span class="tag farm" title="A Farm of the Main above. Its Fort Count is part of the total above.">Farm</span>`) : "");
      const total = r.parts?.length ? `<small>total</small>` : "";
      return `
      <li class="${cls}"${stagger ? ` style="--d:${700 + n * 70}ms"` : ""}>
        <span class="pos num">${part ? "" : r.e.rank ?? "–"}</span>
        <span class="row-main">
          <span class="row-name">${who(r.g)}${tags}</span>
          <span class="bar"><i style="width:${(r.e.fortCount / top) * 100}%;animation-delay:${900 + Math.min(n, 15) * 90}ms"></i></span>
        </span>
        <b class="count num">${r.e.fortCount}${total}</b>
        ${deltas ? deltaHtml(r.delta, r.isNew) : ICON_GO}
      </li>`;
    };
    return `<ol class="rank-list">${rows.slice(0, limit).map((r, n) => li(r, n) + r.parts.map((p) => li(p, n, { part: true })).join("")).join("")}</ol>`;
  }

  // The Live Week's tag: "Live, as of 14:05 UTC", with the day added once the reading is a day old.
  const liveTag = (w) => {
    if (!w.readAt) return `<span class="tag live">Live</span>`;
    const t = new Date(w.readAt);
    const day = t.toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? "" : `${DAY[t.getUTCDay()]} `;
    return `<span class="tag live" title="Read from the in-game ranking at ${esc(t.toISOString().slice(0, 16).replace("T", " "))} UTC">Live, as of ${day}${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} UTC</span>`;
  };
  const finalTag = `<span class="tag final" title="The Monday reset closed this week: these Fort Counts are final">Final</span>`;
  const liveNote = `<div class="note">${ICON_INFO}<span>Live Week: read from the in-game ranking once a day until the Monday reset closes it. Fort Counts still rise, so arrows are hidden and Fort Average leaves this week out until then.</span></div>`;
  const partialNote = `<div class="note">${ICON_INFO}<span>Partial Week: this saved ranking is incomplete. A Governor missing from it has an unknown Fort Count, not 0, and their Fort Average is unaffected.</span></div>`;

  function home() {
    if (homeI < 0) return `<div class="wrap page"><div class="card empty">${weeks.length ? `Week ${isoWeek((weeks.find(isLive) ?? weeks[weeks.length - 1]).start)} is waiting for its first fort.` : "No Fort Week has been logged yet."}</div></div>`;
    const i = homeI, w = weeks[i], rows = weekRows(i), wn = isoWeek(w.start);
    const now = fortWeekAt(Date.now()), nowN = isoWeek(now.start);
    const total = w.entries.reduce((a, e) => a + e.fortCount, 0);
    const count = w.entries.length;
    const partial = w.completeness === "partial";
    const live = isLive(w);
    const leaders = rows.filter((r) => r.e.rank === 1);
    const lead = leaders[0];
    // The headline says which week it is and whether it is still running: "so far" for the Live Week.
    const names = leaders.map((r) => esc(r.g.name)).join(" and ");
    const forts = lead ? `<em>${lead.e.fortCount} forts${live ? " so far" : ""}.</em>` : "";
    const headline = !lead ? `No Governor was ranked in Week ${wn}.`
      : live
        ? `${names} ${leaders.length > 1 ? "share the lead in" : "leads"} Week ${wn} with ${forts}`
        : `${names} ${leaders.length > 1 ? "tie for" : "takes"} Week ${wn} with ${forts}`;
    const reset = now.resetsAt;
    // The Council's Reward Promise for the Live Week: what each place will get. Gone once the week closes,
    // when that week's Weekly Awards take over. Intro and rules fall back to content.js.
    const P = livePromise(D.rewardPromises, Date.now());
    const R = C.rewards ?? {};

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
              ${live ? liveTag(w) : finalTag}
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
            ${podium(rows, { live })}
          </div>
        </div>
      </section>

      <section class="wrap" aria-label="Week ${wn} in numbers">
        <div class="stats">
          <div class="stat reveal" style="--d:380ms"><div class="label">Total Fort Count</div><div class="value num" data-count="${total}">${total.toLocaleString("en")}</div><div class="sub">Week ${wn}${live ? " so far" : ""}, all Governors</div></div>
          <div class="stat reveal" style="--d:440ms"><div class="label">Governors ranked</div><div class="value num" data-count="${count}">${count}</div><div class="sub">Mains and Farms</div></div>
          <div class="stat reveal" style="--d:500ms"><div class="label">Average Fort Count</div><div class="value num" data-count="${count ? Math.round(total / count) : 0}">${count ? Math.round(total / count) : "–"}</div><div class="sub">per ranked Governor</div></div>
          <div class="stat reveal" style="--d:560ms"><div class="label">Next reset</div><div class="value mono num" data-countdown>${document.getElementById("countdown").textContent}</div><div class="sub">${DAY[reset.getUTCDay()]} ${reset.getUTCDate()} ${MON[reset.getUTCMonth()]} · 00:00 UTC</div></div>
        </div>
      </section>

      <section class="wrap body-grid">
        <div class="card ranking reveal" style="--d:620ms">
          <div class="card-head">
            <div><div class="eyebrow">Weekly Ranking · Mains</div><h2>Week ${wn}, top ${Math.min(10, rows.length)}</h2><div class="live-line">${live ? liveTag(w) : finalTag}</div></div>
            <a href="#fort" data-home-week>All ${rows.length} Mains →</a>
          </div>
          ${partial ? partialNote : ""}
          ${live ? liveNote : ""}
          ${rankList(rows, { limit: 10, stagger: true })}
        </div>

        <div class="side">
          ${awardWeeks.length ? `<section class="card award reveal" style="--d:680ms" aria-label="Latest Weekly Awards">
            <div class="award-head"><span class="eyebrow">Weekly Awards · Week ${isoWeek(awardWeeks[0].week)}</span><a href="#fort/awards">Past winners →</a></div>
            <h2>Week ${isoWeek(awardWeeks[0].week)} winners</h2>
            <p>Given by the Council for ${fmtRange({ start: awardWeeks[0].week, end: fortWeekEnd(awardWeeks[0].week) })}.</p>
            ${winnersList(awardWeeks[0].awards)}
          </section>` : ""}
          ${P ? `<section class="card award shine reveal" style="--d:700ms" aria-label="Reward Promise for Week ${nowN}">
            <div class="award-head"><span class="eyebrow">Reward Promise · Week ${nowN}</span><span class="mono faint" data-countdown>${document.getElementById("countdown").textContent}</span></div>
            <h2>Fort Grind: ${fmtRange(now)}</h2>
            ${P.intro || R.intro ? `<p>${esc(P.intro || R.intro)}</p>` : ""}
            <ul class="tiers">${P.tiers.map((t) => `<li><span class="place">${esc(t.place)}</span><span class="aw">${awardBody({ items: t.items, award: t.reward })}</span></li>`).join("")}</ul>
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
    if (!q || homeI < 0) return "";
    const i = homeI, wn = isoWeek(weeks[i].start);
    // Mains as the Weekly Ranking shows them by default, plus every Farm with its own Fort Count.
    const hits = findInRanking([...plain[i], ...grouped[i].flatMap((r) => [...(r.unlinked ? [r] : []), ...r.farms])], D.nameHistory, q);
    if (!hits.length) {
      return q.length < 2 ? "" : `<p class="find-none">No Governor in the Week ${wn} Weekly Ranking matches “${esc(q)}”. <a href="#fort" data-home-week>Search Fort Rankings →</a></p>`;
    }
    return hits.slice(0, 3).map((e) => {
      const g = get(e.id, e.name, e.entry);
      return `<button class="find-hit" data-gov="${esc(g.key)}">
        <span class="r num">${e.rank != null ? "#" + e.rank : "Farm"}</span>
        <span class="who"><b class="ell">${esc(g.name)}</b><small>${g.id ? "Character ID " + esc(g.id) : "needs ID"}</small></span>
        <span class="fc"><b class="num">${e.fortCount}</b><small>forts</small></span>
      </button>`;
    }).join("") + (hits.length > 3 ? `<p class="find-more">${hits.length - 3} more match. Keep typing, or <a href="#fort" data-home-week>open the Weekly Ranking →</a></p>` : "");
  }

  function fort() {
    const head = `
      <div class="section-head reveal">
        <div><div class="eyebrow">Fort grind</div><h1>Fort Rankings</h1>
          <p class="muted">${state.fortView === "weekly" ? "Weekly Rankings. Arrows compare each Governor to their own previous week."
            : state.fortView === "awards" ? "Every Weekly Award the Council has given, the latest Fort Week first. Weekly Awards go to Mains only."
            : "Every logged Fort Week. A Fort Average starts at each Governor's first ranked week: a missed Complete Week counts as 0, a Partial Week counts only when ranked."}</p></div>
        <div class="seg" role="group" aria-label="View">
          <button data-fortview="weekly" class="${state.fortView === "weekly" ? "on" : ""}" aria-pressed="${state.fortView === "weekly"}">Weekly</button>
          <button data-fortview="avg" class="${state.fortView === "avg" ? "on" : ""}" aria-pressed="${state.fortView === "avg"}">Averages</button>
          <button data-fortview="awards" class="${state.fortView === "awards" ? "on" : ""}" aria-pressed="${state.fortView === "awards"}">Awards</button>
        </div>
      </div>`;

    if (state.fortView === "awards") {
      return `<div class="wrap page">${head}
        ${awardWeeks.length ? `<div class="grid">${awardWeeks.map((w) => `
          <section class="card award" aria-label="Weekly Awards, ${esc(weekLabel(w.week))}">
            <div class="award-head"><span class="eyebrow">Weekly Awards</span></div>
            <h2>${esc(weekLabel(w.week))}</h2>
            ${winnersList(w.awards)}
          </section>`).join("")}</div>`
        : `<div class="card empty">No Weekly Awards yet. The Council records them after each Fort Week.</div>`}
      </div>`;
    }

    if (state.fortView === "weekly") {
      const i = state.fortWeek, w = weeks[i];
      const chips = weeks.map((wk, n) => `<button class="chip ${n === i ? "on" : ""}" data-week="${n}" aria-pressed="${n === i}"><b>Week ${isoWeek(wk.start)}</b><small>${isLive(wk) ? "Live" : fmtRange(wk)}</small></button>`).reverse().join("");
      const rows = weekRows(i, state.withFarms);
      const mains = rows.filter((r) => r.e.rank != null).length;
      const live = isLive(w);
      const toggle = `<div class="seg" role="group" aria-label="Which Governors">
          <button data-farms="0" class="${state.withFarms ? "" : "on"}" aria-pressed="${!state.withFarms}">Mains</button>
          <button data-farms="1" class="${state.withFarms ? "on" : ""}" aria-pressed="${state.withFarms}">Main + Farm</button>
        </div>`;
      const farmNote = `<div class="note">${ICON_INFO}<span>A Main with Farms shows a total: its own Fort Count plus each Farm's, listed under it. Mains are ranked on that total. Unlinked Farms are not ranked.</span></div>`;
      return `<div class="wrap page">${head}
        <div class="toolbar"><div class="chips">${chips}</div>${toggle}</div>
        <section class="card ranking">
          <div class="card-head">
            <div><div class="eyebrow">Weekly Ranking</div><h2>Week ${isoWeek(w.start)} · ${fmtRange(w)}</h2>${live ? `<div class="live-line">${liveTag(w)}</div>` : ""}</div>
            <span class="muted">${mains} Mains ranked</span>
          </div>
          ${w.completeness === "partial" ? partialNote : ""}
          ${live ? liveNote : ""}
          ${state.withFarms ? farmNote : ""}
          ${rankList(rows, { deltas: !live })}
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
            <td class="name-cell">${who(g)} ${farmTag(g)}</td>
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
              const g = (e.id && byKey(e.id)) || get(e.id, e.name);
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
    const top = all.filter((g) => g.roster.top200);
    const away = (g) => g.roster.status === "Inactive" || g.roster.status === "Migrated";
    // Top 200 by default; a search looks through everyone so nobody is unfindable.
    const list = (state.rosterAll || q ? all : top)
      .filter((g) => !q || g.id?.includes(q) || g.names.some((n) => n.toLowerCase().includes(q)))
      .sort((a, b) => (sorters[state.rosterSort](b) || 0) - (sorters[state.rosterSort](a) || 0));
    const th = (k, label) => `<th class="r ${state.rosterSort === k ? "sorted" : ""}"><button data-rostersort="${k}">${label}</button></th>`;
    return `<div class="wrap page">
      <div class="section-head reveal"><div><div class="eyebrow">Kingdom 3493</div><h1>Roster</h1>
        <p class="muted">The Top 200 by power from the latest Roster Snapshot; "All" adds the rest, and Inactive and Migrated Governors. Search by any name a Governor has used, or by Character ID.</p></div></div>
      <div class="toolbar"><div class="seg" role="group" aria-label="Which Governors">
          <button data-rosterall="0" class="${state.rosterAll ? "" : "on"}" aria-pressed="${!state.rosterAll}">Top 200</button>
          <button data-rosterall="1" class="${state.rosterAll ? "on" : ""}" aria-pressed="${state.rosterAll}">All ${all.length}</button>
        </div><input class="search" id="rq" type="search" placeholder="Name or Character ID" aria-label="Search the roster" value="${esc(state.rosterQ)}" autocomplete="off" spellcheck="false"></div>
      <section class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Governor</th><th>Character ID</th>${th("power", "Power")}${th("highestPower", "Highest")}${th("resources", "Resources")}${th("fort", "Fort Average")}</tr></thead>
          <tbody>${list.slice(0, state.rosterLimit).map((g, n) => `<tr class="${away(g) ? "is-away" : ""}">
            <td class="faint num mono">${n + 1}</td>
            <td class="name-cell">${who(g)} ${away(g) ? `<span class="tag away">${esc(g.roster.status)}</span>` : ""}</td>
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
    // Farm links come from the Council's Farm-link screen; keyed by Character ID only.
    const rec = g.id ? record.get(g.id) : null;
    const mainOf = rec?.kind === "farm" && rec.mainId ? get(rec.mainId, record.get(rec.mainId)?.name) : null;
    const farms = g.id ? farmsOf(g.id).map((f) => get(f.id, f.name)) : [];
    dlg.innerHTML = `
      <div class="dlg-head">
        <div class="eyebrow">${g.id ? "Character ID " + esc(g.id) : "needs ID · no Character ID on record"}</div>
        <h2 id="governor-name">${esc(g.name)}</h2>
        ${rec?.kind === "farm" ? `<p class="dlg-sub">${mainOf ? `farm of ${who(mainOf)}` : '<span class="tag farm">Farm · unlinked</span>'}</p>` : ""}
        <button class="dlg-close" aria-label="Close" data-close>×</button>
      </div>
      <div class="dlg-body">
        ${g.names.length > 1 ? `<div><div class="eyebrow">Name History</div><div class="aka">${g.names.filter((n) => n !== g.name).map((n) => `<span>${esc(n)}</span>`).join("")}</div></div>` : ""}
        ${farms.length ? `<div><div class="eyebrow">Farms</div><ol class="mini-list">${farms.map((f) => `<li>${who(f)}<span class="muted num">${f.last != null ? f.last + " forts last week" : "not ranked last week"}</span></li>`).join("")}</ol></div>` : ""}
        <div class="kv">
          <div><small>Fort Average</small><b>${g.avg != null ? one(g.avg) : "–"}</b></div>
          <div><small>Best week</small><b>${g.best || "–"}</b></div>
          <div><small>Weeks ranked</small><b>${g.played}/${weeks.length}</b></div>
          ${r ? `<div><small>Power</small><b>${big(r.power)}</b></div><div><small>Highest power</small><b>${big(r.highestPower)}</b></div><div><small>Resources</small><b>${big(r.resources)}</b></div>` : ""}
        </div>
        ${g.played ? `<div><div class="eyebrow">Fort history</div>
          <ol class="mini-list">${g.fort.map((e, k) => ({ e, k })).reverse().map(({ e, k }) => `<li><span style="flex:1">Week ${isoWeek(weeks[k].start)} <span class="muted">· ${fmtRange(weeks[k])}</span></span>${e ? `<span class="muted mono">${e.rank != null ? "#" + e.rank : "Farm"}</span><b class="num" style="min-width:40px;text-align:right">${e.fortCount}</b>` : '<span class="muted">not ranked</span>'}</li>`).join("")}</ol></div>` : ""}
        ${g.awards.length ? `<div><div class="eyebrow">Weekly Awards</div><ol class="mini-list">${g.awards.map((a) => `<li><span class="place mono p${a.place}">${ordinal(a.place)}</span><span class="aw">${awardBody(a, "b")}<small>${esc(weekLabel(a.week))}${a.note ? ` · ${esc(a.note)}` : ""}</small></span></li>`).join("")}</ol></div>` : ""}
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
    const i = homeI, w = weeks[i], rows = weekRows(i), wn = isoWeek(w.start), live = isLive(w);
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

    x.fillStyle = "#E9C46A"; font(`26px ${MONO}`); x.fillText((live ? "LEADING SO FAR" : "WEEK CHAMPION") + (c2?.e.rank === 1 ? " · TIE" : ""), 96, 340);
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
    // Home's links into Fort Rankings open the week home shows, even after a chip picked another.
    if (ev.target.closest("a[data-home-week]") && homeI >= 0) state.fortWeek = homeI;
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.gov) return openGovernor(t.dataset.gov);
    if ("share" in t.dataset) {
      t.disabled = true;
      try { await shareCard(); } catch (err) { console.error(err); } finally { t.disabled = false; }
      return;
    }
    if (t.dataset.fortview) {
      state.fortView = t.dataset.fortview;
      history.replaceState(null, "", state.fortView === "awards" ? "#fort/awards" : "#fort");
    }
    else if (t.dataset.week) state.fortWeek = +t.dataset.week;
    else if (t.dataset.farms) state.withFarms = t.dataset.farms === "1";
    else if (t.dataset.avgsort) state.avgSort = t.dataset.avgsort;
    else if (t.dataset.rostersort) state.rosterSort = t.dataset.rostersort;
    else if (t.dataset.kvk) state.kvkFilter = t.dataset.kvk;
    else if (t.dataset.rosterall) { state.rosterAll = t.dataset.rosterall === "1"; state.rosterLimit = 50; }
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
  // "#fort/awards" (the home page's "Past winners" link) opens Fort Rankings on its Awards view;
  // the Fort Rankings tab (#fort) leaves the Awards view, so the URL and the view always agree.
  const viewFromHash = () => {
    if (location.hash === "#fort/awards") state.fortView = "awards";
    else if (location.hash === "#fort" && state.fortView === "awards") state.fortView = "weekly";
  };
  window.addEventListener("hashchange", () => { viewFromHash(); render(); window.scrollTo(0, 0); });

  document.getElementById("generated").textContent = `Data updated ${fmtDay(D.generated)} ${D.generated.slice(0, 4)}`;
  viewFromHash();
  render();
})();
