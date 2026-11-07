import * as d3 from "d3";
import type { WardData } from "./data/shape";

import {
  DOT_CAP, broad, fmt, fd, pct, q, sorted, esc, seeded, moves, returnedTo, daysBeforeMove, daysAfterMove,
  type GroupBy, type Status, type S,
} from "./analysis";
/* ---------- explorer ---------- */

let offResize: (() => void) | null = null;

export function mountExplorer(root: HTMLElement, data: WardData, onReload: () => void): void {
  const ALL: S[] = data.spells.map((s) => ({ ...s, seq: [], path: [], los: 0 }));
  let WARDS: string[] = [];
  const st = {
    group: "ward" as GroupBy,
    from: "",
    to: "",
    status: "all" as Status,
    onlyFrom: true,
    year: 0,
    age: "",
    legal: "",
    dx: "",
    borough: "",
    steps: 5,
    anchor: "", // "" = admission, else first stay on this ward

  };

  const nOpenAll = ALL.filter((s) => s.open).length;
  const years = [...new Set(ALL.map((s) => s.year).filter((y) => y > 1900))].sort(d3.ascending);
  const levels = (k: "age" | "legal" | "dx" | "borough") =>
    [...d3.rollup(ALL, (v) => v.length, (s) => s[k])].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const mismatch = ALL.reduce(
    (n, s) => n + s.stays.filter((x) => /rehab/i.test(x.ward) !== /rehab/i.test(x.bed)).length,
    0,
  );
  const rehabStays = ALL.reduce((n, s) => n + s.stays.filter((x) => /rehab/i.test(x.ward)).length, 0);

  const opt = (v: string | number, label: string, sel: boolean) =>
    `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(label)}</option>`;
  const filterSel = (id: string, label: string, vals: string[]) =>
    `<div class="ctl">${label}<select id="${id}">${opt("", "All", true)}${vals.map((v) => opt(v, v, false)).join("")}</select></div>`;

  root.innerHTML = `
<div class="wrap">
  <header class="mast">
    <div class="mast-top">
      <div class="mast-id">
        <img class="icon" src="/brand/nlft-partnership-mark.png" alt="" />
        <div><div class="report-name">Ward Pathways</div><div class="report-tag">Inpatient ward movement and length of stay · mental health</div></div>
      </div>
      <img class="nhs" src="/brand/nlft-logo.png" alt="North London NHS Foundation Trust" />
    </div>
    <div class="mast-bar">
      <div class="mast-title">
        <div class="eyebrow">Ward_Movement · extract ${esc(data.extractDate || "date unknown")} · ${fmt(ALL.length)} spells · ${fmt(nOpenAll)} current inpatients</div>
        <h1>Ward pathways and length of stay</h1>
        <div class="sub">How spells move between ward types from admission to discharge, and what happens to total length of stay when a patient is moved from rehabilitation back to an acute ward.</div>
      </div>
      <div class="mast-actions">
        <label class="chk"><input type="checkbox" id="themeT"> Dark mode</label>
        <button id="reloadBtn" type="button" class="ghost">Refresh</button>
      </div>
      <div class="filters">
        <label class="fld">Group wards by
          <select id="groupSel">${opt("ward", "Ward type (local)", true)}${opt("bed", "Bed type (MHSDS)", false)}${opt("broad", "Broad group", false)}</select></label>
        <label class="fld">Highlight moves from <select id="fromSel"></select></label>
        <label class="fld">to <select id="toSel"></select></label>
        <label class="fld">Spells
          <select id="statusSel">${opt("all", "All spells", true)}${opt("disc", "Discharged only", false)}${opt("open", "Current inpatients only", false)}</select></label>
        <label class="chk"><input type="checkbox" id="onlyFrom" checked> Only spells that entered the “from” ward</label>
      </div>
    </div>
  </header>

  <details class="more" id="caseMix">
    <summary>Case mix filters <span class="note" id="cmCount"></span></summary>
    <div class="controls inner">
      <div class="ctl">Admitted from
        <select id="yearSel">${opt(0, "All years", true)}${years.map((y) => opt(y, String(y), false)).join("")}</select></div>
      ${filterSel("ageSel", "Age band", levels("age").sort())}
      ${filterSel("legalSel", "Legal status", levels("legal"))}
      ${filterSel("dxSel", "Primary diagnosis", levels("dx"))}
      ${filterSel("borSel", "Borough (first ward)", levels("borough"))}
      <button type="button" id="clearCm">Clear</button>
    </div>
  </details>

  <div class="tiles" id="tiles"></div>

  <div class="card">
    <div class="cardhead">
      <div><h2>Patient flow, ward by ward</h2>
      <div class="note">Each column is the next ward stay in the spell; moves between two wards of the same type are merged. Band width = number of spells. <b>Click a ward or a band to follow only those patients forward</b>; use the trail to go back.</div></div>
      <div class="legend flowlegend">
        <span class="lgroup">Bands</span>
        <span><i style="background:var(--hl)"></i><span id="lgHl"></span></span>
        <span><i style="background:var(--link);opacity:.6"></i>Other moves</span>
        <span class="lgroup">Wards</span>
        <span><b class="sq" style="background:var(--from-node)"></b><span id="lgFrom"></span></span>
        <span><b class="sq" style="background:var(--to-node)"></b><span id="lgTo"></span></span>
        <span><b class="sq" style="background:var(--node)"></b>Other wards</span>
        <span><b class="sq" style="background:var(--base)"></b>Still in hospital</span>
        <span><b class="sq" style="background:var(--node-term)"></b>Discharged</span>
      </div>
    </div>
    <div class="controls">
      <div class="ctl">Start the flow at <select id="anchorSel"></select></div>
      <div class="ctl">Ward stays shown
        <select id="stepsSel">${opt(5, "5", true)}${opt(8, "8", false)}${opt(12, "12", false)}</select></div>
    </div>
    <nav class="crumbs" id="flowCrumbs" aria-label="Flow drill-down"></nav>
    <div id="sankey" class="hscroll"></div>
  </div>

  <div class="card">
    <div class="cardhead">
      <div><h2>Total length of stay by pathway type</h2>
      <div class="note" id="losNote"></div></div>
      <div class="legend"><span><i style="background:var(--hl)"></i>Includes the highlighted move</span><span><i style="background:var(--base)"></i>Does not</span><span><b class="ring"></b>Still in hospital (stay so far)</span></div>
    </div>
    <div id="los"></div>
  </div>

  <div class="card" id="watchCard">
    <div class="cardhead"><div><h2 id="watchTitle"></h2>
    <div class="note">Spells still open that include the highlighted move, longest stay first. Days are counted to the extract date.</div></div></div>
    <div style="overflow-x:auto"><table id="wtable"></table></div>
  </div>

  <div class="card">
    <div class="cardhead"><div><h2>All pathways</h2>
    <div class="note">Every spell grouped by its exact sequence of ward types (moves between two wards of the same type are merged). Click a column heading to sort; click a pathway to see its spells, ward by ward. Average stay uses discharged spells.</div>
    <div class="note" id="pHint"></div></div>
    <button type="button" id="pCsv">Download CSV</button></div>
    <div class="controls ptools">
      <div class="ctl">Find wards in pathway<input type="search" id="pSearch" placeholder="e.g. PICU, rehab" /></div>
      <label class="chk"><input type="checkbox" id="pOnlyHl"> Only pathways with the highlighted move</label>
    </div>
    <div class="note" id="pSummary"></div>
    <div style="overflow-x:auto"><table id="ptable"></table></div>
    <div class="pager" id="pPager"></div>
  </div>

  <div class="card">
    <h2>Reading this fairly</h2>
    <p class="caveat">These figures show an association, not proof that the move itself causes the longer stay. Patients moved back to acute care are often more unwell, so part of the gap may come from case mix. Use the case mix filters to compare like with like, for example a single diagnosis group or legal status. Watch the rehab days “lost” before a step-back and whether patients return to rehab, where the programme often restarts.</p>
    <p class="caveat"><b>Data notes.</b> Ward type and bed type disagree on rehab for ${fmt(mismatch)} stays (${fmt(rehabStays)} stays are on wards labelled rehab), so compare both groupings. Medians and quartiles use discharged spells unless “Current inpatients only” is chosen. Length of stay is the sum of ward days in the spell. A few admissions date from before 2007; use “Admitted from” to exclude them.</p>
  </div>
</div>
<div class="tip" id="tip"></div>`;

  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const tip = $("#tip");
  const fromSel = $<HTMLSelectElement>("#fromSel");
  const toSel = $<HTMLSelectElement>("#toSel");

  /* ----- theme ----- */
  const themeT = $<HTMLInputElement>("#themeT");
  themeT.checked = !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  themeT.addEventListener("change", () => {
    document.documentElement.setAttribute("data-theme", themeT.checked ? "dark" : "light");
    render();
  });
  $("#reloadBtn").addEventListener("click", onReload);

  /* ----- prep ----- */
  function prep(): void {
    const key = (x: { ward: string; bed: string }) =>
      st.group === "bed" ? x.bed : st.group === "broad" ? broad(x.ward) : x.ward;
    for (const s of ALL) {
      s.seq = [];
      for (const x of s.stays) {
        const w = key(x);
        const last = s.seq[s.seq.length - 1];
        if (last && last.ward === w) last.days += x.days;
        else s.seq.push({ ward: w, days: x.days });
      }
      s.path = s.seq.map((x) => x.ward);
      s.los = d3.sum(s.seq, (x) => x.days);
    }
    const cnt = d3.rollup(ALL.flatMap((s) => s.path), (v) => v.length, (d) => d);
    WARDS = [...cnt.keys()].sort((a, b) => cnt.get(b)! - cnt.get(a)!);
  }
  function fillWardSelects(): void {
    const pick = (re: RegExp, fb: string) => WARDS.find((w) => re.test(w)) ?? fb;
    const f = WARDS.includes(st.from) ? st.from : pick(/rehab/i, WARDS[1] ?? WARDS[0]);
    const t = WARDS.includes(st.to) ? st.to : pick(/acute/i, WARDS[0]);
    for (const sel of [fromSel, toSel]) sel.innerHTML = WARDS.map((w) => opt(w, w, false)).join("");
    fromSel.value = st.from = f;
    toSel.value = st.to = t;
    if (!WARDS.includes(st.anchor)) st.anchor = "";
    $<HTMLSelectElement>("#anchorSel").innerHTML = opt("", "Admission (1st ward)", !st.anchor) +
      WARDS.map((w) => opt(w, `First stay on ${w}`, w === st.anchor)).join("");
  }

  /* ----- controls ----- */
  const bind = (id: string, fn: (el: HTMLSelectElement & HTMLInputElement) => void) =>
    $(id).addEventListener("change", (e) => {
      fn(e.target as HTMLSelectElement & HTMLInputElement);
      render();
    });
  bind("#groupSel", (el) => {
    st.group = el.value as GroupBy;
    prep();
    fillWardSelects();
    drill.length = 0;
  });
  bind("#fromSel", (el) => (st.from = el.value));
  bind("#toSel", (el) => (st.to = el.value));
  bind("#statusSel", (el) => (st.status = el.value as Status));
  bind("#onlyFrom", (el) => (st.onlyFrom = el.checked));
  bind("#yearSel", (el) => (st.year = +el.value));
  bind("#ageSel", (el) => (st.age = el.value));
  bind("#legalSel", (el) => (st.legal = el.value));
  bind("#dxSel", (el) => (st.dx = el.value));
  bind("#borSel", (el) => (st.borough = el.value));
  bind("#stepsSel", (el) => (st.steps = +el.value));
  bind("#anchorSel", (el) => {
    st.anchor = el.value;
    drill.length = 0;
  });
  $("#flowCrumbs").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-level]");
    if (!b) return;
    drill.length = Math.max(0, +b.dataset.level!);
    render();
  });
  $("#clearCm").addEventListener("click", () => {
    Object.assign(st, { year: 0, age: "", legal: "", dx: "", borough: "" });
    for (const id of ["#yearSel", "#ageSel", "#legalSel", "#dxSel", "#borSel"])
      $<HTMLSelectElement>(id).selectedIndex = 0;
    render();
  });

  const soFar = () => st.status === "open";
  /** Medians use final stays; with "current inpatients only" they use stay so far. */
  const statSet = (arr: S[]) => (soFar() ? arr : arr.filter((s) => !s.open));
  const losOf = (arr: S[]) => sorted(statSet(arr).map((s) => s.los));

  /* ----- tooltip ----- */
  function moveTip(ev: MouseEvent): void {
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function showTip(ev: MouseEvent, html: string): void {
    tip.innerHTML = html;
    tip.style.opacity = "1";
    moveTip(ev);
  }
  const hideTip = () => (tip.style.opacity = "0");

  /* ----- tiles ----- */
  function tiles(view: S[], from: string, to: string): void {
    const fromSp = view.filter((s) => s.path.includes(from));
    const base = statSet(fromSp);
    const med = (arr: S[]) => {
      const v = sorted(arr.map((s) => s.los));
      return v.length ? q(v, 0.5) : NaN;
    };
    const noArr = base.filter((s) => moves(s, from, to) === 0);
    const retArr = base.filter((s) => returnedTo(s, from, to));
    const notRetArr = base.filter((s) => moves(s, from, to) > 0 && !returnedTo(s, from, to));
    const mN = med(noArr), mR = med(retArr), mD = med(notRetArr);
    const withMove = fromSp.filter((s) => moves(s, from, to) > 0);
    const before = sorted(withMove.map((s) => daysBeforeMove(s, from, to)!).filter((x) => x != null));
    const nOpen = view.filter((s) => s.open).length;
    const lbl = soFar() ? "Median stay so far" : "Median total stay";
    const basis = soFar() ? "stay to date" : nOpen ? "discharged spells" : "spells";
    const vs = (m: number) =>
      isFinite(m) && isFinite(mN) && mN > 0
        ? `<b>${m - mN >= 0 ? "+" : "−"}${fd(Math.abs(m - mN))} days</b> (${m - mN >= 0 ? "+" : "−"}${Math.abs(Math.round(((m - mN) / mN) * 100))}%) vs no move`
        : "";
    const openMove = view.filter((s) => s.open && moves(s, from, to) > 0);
    const om = sorted(openMove.map((s) => s.los));
    const T = [
      { k: "Spells in view", v: fmt(view.length), d: `${fmt(view.length - nOpen)} discharged · ${fmt(nOpen)} still in hospital` },
      { k: `${esc(from)} spells moved to ${esc(to)}`, v: pct(withMove.length, fromSp.length), d: `${fmt(withMove.length)} of ${fmt(fromSp.length)} spells that included ${esc(from)}` },
      { k: `${lbl}: ${esc(from)}, no move`, v: isFinite(mN) ? fd(mN) + " d" : "–", d: `${fmt(noArr.length)} ${basis}` },
      { k: `<span class="sw"></span>${lbl}: moved, then returned to ${esc(from)}`, v: isFinite(mR) ? fd(mR) + " d" : "–", d: `${fmt(retArr.length)} ${basis}${vs(mR) ? " · " + vs(mR) : ""}`, hero: true },
      { k: `${lbl}: moved, didn’t return`, v: isFinite(mD) ? fd(mD) + " d" : "–", d: `${fmt(notRetArr.length)} ${basis}${vs(mD) ? " · " + vs(mD) : ""}`, hero: true },
      { k: `Days on ${esc(from)} before the move`, v: before.length ? fd(q(before, 0.5)) + " d" : "–", d: before.length ? `median · IQR ${fd(q(before, 0.25))}–${fd(q(before, 0.75))} days of ${esc(from)} care before stepping back` : "no moves in view" },
    ];
    if (nOpen)
      T.push({ k: `Current inpatients moved ${esc(from)} → ${esc(to)}`, v: fmt(openMove.length), d: om.length ? `median ${fd(q(om, 0.5))} days in hospital so far` : "none at present" });
    $("#tiles").innerHTML = T.map(
      (t) => `<div class="tile${"hero" in t && t.hero ? " hero" : ""}"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="d">${t.d}</div></div>`,
    ).join("");
  }

  /* ----- sankey (hand laid out) ----- */
  interface SNode { c: number; name: string; key: string; sp: S[]; in: SLink[]; out: SLink[]; x: number; y: number; h: number }
  interface SLink { s: string; t: string; sp: S[]; hl: boolean; w: number; y0: number; y1: number }
  /** Drill-down stack: each level keeps the spells followed and where each one now starts. */
  interface Level { label: string; items: Map<S, number> }
  const drill: Level[] = [];

  function sankey(spells: S[], from: string, to: string): void {
    const host = $("#sankey");
    host.innerHTML = "";
    const avail = Math.max(340, host.clientWidth), narrow = avail < 640;

    // Where each spell's flow starts: admission, the first stay on the anchor ward, or the drilled position.
    const inView = new Set(spells);
    let off: Map<S, number>;
    if (drill.length) off = new Map([...drill[drill.length - 1].items].filter(([s]) => inView.has(s)));
    else if (st.anchor) off = new Map(spells.filter((s) => s.path.includes(st.anchor)).map((s) => [s, s.path.indexOf(st.anchor)]));
    else off = new Map(spells.map((s) => [s, 0]));
    const list = [...off.keys()];
    const o = (s: S) => off.get(s)!;
    const len = (s: S) => s.path.length - o(s);

    // Trail
    const rootLabel = st.anchor ? `First stay on ${st.anchor}` : "Admission";
    $("#flowCrumbs").innerHTML =
      [rootLabel, ...drill.map((l) => l.label)]
        .map((lb, i, arr) => i === arr.length - 1
          ? `<span class="crumb cur">${esc(lb)} <span class="note">· ${fmt(list.length)} spells</span></span>`
          : `<button type="button" class="crumb" data-level="${i}">${esc(lb)}</button>`)
        .join('<span class="sep">›</span>') +
      (drill.length ? `<span class="sp"></span><button type="button" data-level="${drill.length - 1}">‹ Back</button><button type="button" data-level="0">Reset</button>` : "");
    if (!list.length) {
      host.innerHTML = `<p class="note">No spells in view for this starting point.</p>`;
      return;
    }

    const MAXSTEPS = st.steps;
    const maxLen = Math.min(MAXSTEPS, d3.max(list, len) ?? 1);
    const C = maxLen + 1;
    const END = (s: S) => (s.open ? "Still in hospital" : "Discharged");
    const nodeAt = (s: S, c: number) =>
      c < len(s)
        ? c === MAXSTEPS - 1 && len(s) > MAXSTEPS ? "… further moves" : s.path[o(s) + c]
        : c === len(s) ? END(s) : null;
    const isTerm = (n: string) => n === "Discharged" || n === "Still in hospital" || n === "… further moves";
    const nodes = new Map<string, SNode>(), links = new Map<string, SLink>();
    for (const s of list) {
      for (let c = 0; c < C; c++) {
        const n = nodeAt(s, c);
        if (!n) break;
        const key = c + "|" + n;
        if (!nodes.has(key)) nodes.set(key, { c, name: n, key, sp: [], in: [], out: [], x: 0, y: 0, h: 0 });
        nodes.get(key)!.sp.push(s);
        if (isTerm(n)) break;
        const m = nodeAt(s, c + 1);
        if (!m) break;
        const lk = key + ">" + (c + 1) + "|" + m;
        if (!links.has(lk)) links.set(lk, { s: key, t: c + 1 + "|" + m, sp: [], hl: n === from && m === to, w: 0, y0: 0, y1: 0 });
        links.get(lk)!.sp.push(s);
      }
    }
    const order = (n: string) =>
      n === "Still in hospital" ? 1e3 : n === "Discharged" ? 1e3 + 1 : n === "… further moves" ? 1e3 + 2 : WARDS.indexOf(n);
    const cols = d3.range(C).map((c) => [...nodes.values()].filter((n) => n.c === c).sort((a, b) => order(a.name) - order(b.name)));
    const gap = 10, top = 22, H = narrow ? 420 : 520;
    const maxN = d3.max(cols, (col) => col.length) ?? 1;
    const k = Math.max(0.0001, (H - top - 10 - gap * (maxN - 1)) / list.length);
    // Keep columns far enough apart for labels; scroll sideways when there are many.
    const nodeW = 12, padR = narrow ? 90 : 160, minStep = narrow ? 110 : 170;
    const W = Math.max(avail, nodeW + padR + minStep * Math.max(1, C - 1));
    const xStep = (W - nodeW - padR) / Math.max(1, C - 1);
    cols.forEach((col) => {
      let y = top;
      col.forEach((n) => {
        n.x = n.c * xStep;
        n.y = y;
        n.h = Math.max(2, n.sp.length * k);
        y += n.h + gap;
      });
    });
    links.forEach((l) => {
      l.w = l.sp.length * k;
      nodes.get(l.s)!.out.push(l);
      nodes.get(l.t)!.in.push(l);
    });
    nodes.forEach((n) => {
      n.out.sort((a, b) => nodes.get(a.t)!.y - nodes.get(b.t)!.y);
      let y = n.y;
      n.out.forEach((l) => { l.y0 = y + l.w / 2; y += l.w; });
      n.in.sort((a, b) => nodes.get(a.s)!.y - nodes.get(b.s)!.y);
      y = n.y;
      n.in.forEach((l) => { l.y1 = y + l.w / 2; y += l.w; });
    });

    const follow = (label: string, sp: S[], c: number) => {
      drill.push({ label, items: new Map(sp.map((s) => [s, o(s) + c])) });
      hideTip();
      render();
    };
    const total = list.length;
    const svg = d3.select(host).append("svg").attr("width", W > avail ? W : "100%").attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img").attr("aria-label", "Flow of spells between ward types");
    const ord = (c: number) => c + 1 + (c === 0 ? "st" : c === 1 ? "nd" : c === 2 ? "rd" : "th");
    const rooted = drill.length > 0 || !!st.anchor;
    svg.selectAll("text.col").data(d3.range(C)).join("text").attr("class", "col")
      .attr("x", (c) => c * xStep).attr("y", 10).attr("font-size", 11).attr("fill", "var(--text-muted)")
      .text((c) => rooted ? (c === 0 ? "Starting ward" : c === 1 ? "Next ward" : `${ord(c)} ward from start`) : narrow ? ord(c) : c === 0 ? "1st ward" : `${ord(c)} ward`);
    const L = [...links.values()].sort((a, b) => +a.hl - +b.hl);
    // Bands are filled ribbons between their top and bottom edges, so wide bands stay
    // inside their two columns. The highlighted move keeps a visible minimum width.
    const bw = (l: SLink) => (l.hl ? Math.max(4, l.w) : Math.max(1, l.w));
    const ribbon = (l: SLink) => {
      const a = nodes.get(l.s)!, b = nodes.get(l.t)!;
      const x0 = a.x + nodeW, x1 = b.x, xm = (x0 + x1) / 2, h = bw(l) / 2;
      const t0 = l.y0 - h, b0 = l.y0 + h, t1 = l.y1 - h, b1 = l.y1 + h;
      return `M${x0},${t0}C${xm},${t0} ${xm},${t1} ${x1},${t1}L${x1},${b1}C${xm},${b1} ${xm},${b0} ${x0},${b0}Z`;
    };
    svg.append("g").selectAll("path").data(L).join("path")
      .attr("d", ribbon)
      .attr("fill", (l) => (l.hl ? "var(--hl)" : "var(--link)"))
      .attr("fill-opacity", (l) => (l.hl ? 0.9 : 0.35))
      .style("cursor", (l) => (isTerm(nodes.get(l.t)!.name) ? "default" : "pointer"))
      .on("click", (_ev, l) => {
        const a = nodes.get(l.s)!, b = nodes.get(l.t)!;
        if (!isTerm(b.name)) follow(`${a.name} → ${b.name}`, l.sp, b.c);
      })
      .on("mouseenter", function (ev: MouseEvent, l) {
        d3.select(this).attr("fill-opacity", l.hl ? 1 : 0.7);
        const a = nodes.get(l.s)!, b = nodes.get(l.t)!, los = losOf(l.sp), nO = l.sp.filter((s) => s.open).length;
        showTip(ev, `<b>${esc(a.name)} → ${esc(b.name)}</b><br>${fmt(l.sp.length)} spells (${pct(l.sp.length, total)})${nO && !soFar() ? `, ${fmt(nO)} still in hospital` : ""}` +
          (los.length ? `<br>${soFar() ? "Median stay so far" : "Median total stay"}: <b>${fd(q(los, 0.5))} days</b><br><span class="m">IQR ${fd(q(los, 0.25))}–${fd(q(los, 0.75))} days</span>` : `<br><span class="m">No discharged spells yet</span>`) +
          (isTerm(b.name) ? "" : `<br><span class="m">Click to follow these patients</span>`));
      })
      .on("mousemove", moveTip)
      .on("mouseleave", function (_ev, l) {
        d3.select(this).attr("fill-opacity", l.hl ? 0.9 : 0.35);
        hideTip();
      });
    const N = [...nodes.values()];
    const g = svg.append("g").selectAll("g").data(N).join("g");
    g.append("rect").attr("x", (n) => n.x).attr("y", (n) => n.y - (n.h < 6 ? 2 : 0)).attr("width", nodeW).attr("height", (n) => Math.max(n.h, n.h < 6 ? n.h + 4 : n.h)).attr("rx", 3)
      .attr("fill", (n) => n.name === "Still in hospital" ? "var(--base)" : isTerm(n.name) ? "var(--node-term)" : n.name === from ? "var(--from-node)" : n.name === to ? "var(--to-node)" : "var(--node)")
      .style("cursor", (n) => (isTerm(n.name) || (n.c === 0 && rooted) ? "default" : "pointer"))
      .on("click", (_ev, n) => {
        if (isTerm(n.name) || (n.c === 0 && rooted)) return;
        follow(n.c === 0 ? `1st ward ${n.name}` : n.name, n.sp, n.c);
      })
      .on("mouseenter", (ev: MouseEvent, n) => {
        const los = losOf(n.sp);
        const days = sorted(n.sp.map((s) => s.seq[o(s) + n.c]?.days).filter((x): x is number => x != null));
        const clickable = !isTerm(n.name) && !(n.c === 0 && rooted);
        showTip(ev, `<b>${esc(n.name)}</b><br>${fmt(n.sp.length)} spells (${pct(n.sp.length, total)})${!isTerm(n.name) && days.length ? `<br>Median days on this ward: <b>${fd(q(days, 0.5))}</b>` : ""}${los.length ? `<br>${soFar() ? "Median stay so far" : "Median total stay"}: <b>${fd(q(los, 0.5))} days</b>` : ""}${clickable ? `<br><span class="m">Click to follow these patients forward</span>` : ""}`);
      })
      .on("mousemove", moveTip).on("mouseleave", hideTip);
    g.filter((n) => (narrow ? n.h >= 16 : n.h >= 9 || n.sp.length / total > 0.02)).append("text")
      .attr("x", (n) => n.x + nodeW + 5).attr("y", (n) => n.y + n.h / 2).attr("dy", "0.35em")
      .attr("font-size", narrow ? 10.5 : 12).attr("font-weight", (n) => (n.name === from || n.name === to ? 700 : 400))
      .attr("fill", "var(--text-secondary)").attr("pointer-events", "none")
      .text((n) => `${n.name} ${fmt(n.sp.length)}`);
  }

  /* ----- LOS strip / box chart ----- */
  function losChart(spells: S[], from: string, to: string): void {
    const host = $("#los");
    host.innerHTML = "";
    const W = Math.max(340, host.clientWidth), narrow = W < 640;
    const groups = [
      { name: `No ${from} stay`, f: (s: S) => !s.path.includes(from), hl: false },
      { name: `${from}, no move to ${to}`, f: (s: S) => s.path.includes(from) && moves(s, from, to) === 0, hl: false },
      { name: `Moved to ${to}, didn’t return`, f: (s: S) => moves(s, from, to) > 0 && !returnedTo(s, from, to), hl: true },
      { name: `Moved to ${to}, returned to ${from}`, f: (s: S) => returnedTo(s, from, to), hl: true },
    ].map((gp) => ({ ...gp, sp: spells.filter(gp.f) })).filter((gp) => gp.sp.length);
    const labelW = narrow ? 0 : 320, rowH = narrow ? 74 : 62, top = 8, axisH = 28;
    const H = top + groups.length * rowH + axisH;
    const all = sorted(spells.map((s) => s.los));
    const gq3 = d3.max(groups, (gp) => { const l = losOf(gp.sp); return l.length ? q(l, 0.75) : 0; }) ?? 0;
    const xmax = Math.max(q(all, 0.98) || 1, gq3 * 1.05);
    const x = d3.scaleLinear().domain([0, xmax]).nice().range([labelW, W - 14]);
    const svg = d3.select(host).append("svg").attr("width", "100%").attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img").attr("aria-label", "Total length of stay by pathway group");
    const ticks = x.ticks(narrow ? 4 : 8);
    svg.append("g").selectAll("line").data(ticks).join("line").attr("x1", x).attr("x2", x).attr("y1", top).attr("y2", H - axisH).attr("stroke", "var(--grid)");
    svg.append("g").selectAll("text").data(ticks).join("text").attr("x", x).attr("y", H - axisH + 16).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", "var(--text-muted)").text((t) => fmt(t));
    svg.append("text").attr("x", W - 14).attr("y", H - 2).attr("text-anchor", "end").attr("font-size", 11).attr("fill", "var(--text-muted)").text("Total length of stay (days)");
    const rnd = seeded(7);
    let sampled = false;
    groups.forEach((gp, i) => {
      const y0 = top + i * rowH, cy = y0 + (narrow ? 44 : rowH / 2);
      const col = gp.hl ? "var(--hl)" : "var(--base)";
      const los = losOf(gp.sp);
      const nO = gp.sp.filter((s) => s.open).length, has = los.length > 0;
      const md = has ? q(los, 0.5) : NaN, q1 = has ? q(los, 0.25) : NaN, q3 = has ? q(los, 0.75) : NaN;
      const rd = statSet(gp.sp);
      const readm = soFar() || !rd.length ? "" : ` · readmitted ≤30d ${pct(rd.filter((s) => s.readmit).length, rd.length)}`;
      const nTxt = soFar() ? `n=${fmt(gp.sp.length)} in hospital` : `n=${fmt(gp.sp.length - nO)}${nO ? ` + ${fmt(nO)} in hospital` : ""}`;
      const mTxt = has ? ` · median ${fd(md)} d` : " · no discharges yet";
      const g = svg.append("g");
      if (narrow) {
        g.append("text").attr("x", 0).attr("y", y0 + 14).attr("font-size", 12).attr("font-weight", 600).attr("fill", "var(--text-primary)").text(gp.name);
        g.append("text").attr("x", 0).attr("y", y0 + 28).attr("font-size", 11).attr("fill", "var(--text-secondary)").text(nTxt + mTxt);
      } else {
        g.append("text").attr("x", 0).attr("y", cy - 4).attr("font-size", 12.5).attr("font-weight", 600).attr("fill", "var(--text-primary)").text(gp.name);
        g.append("text").attr("x", 0).attr("y", cy + 12).attr("font-size", 11.5).attr("fill", "var(--text-secondary)").text(nTxt + mTxt + (has ? ` · IQR ${fd(q1)}–${fd(q3)}` : ""));
        if (readm) g.append("text").attr("x", 0).attr("y", cy + 26).attr("font-size", 11).attr("fill", "var(--text-muted)").text(readm.slice(3));
      }
      // Draw a fixed random sample of dots so very large groups stay responsive.
      let dots = gp.sp;
      if (dots.length > DOT_CAP) {
        sampled = true;
        const r = seeded(11 + i);
        dots = d3.shuffler(r)(dots.slice()).slice(0, DOT_CAP);
      }
      const band = narrow ? 22 : 30;
      g.append("g").selectAll("circle").data(dots).join("circle")
        .attr("cx", (s) => x(Math.min(s.los, xmax))).attr("cy", () => cy + (rnd() - 0.5) * band).attr("r", 3)
        .attr("fill", (s) => (s.open ? "none" : col)).attr("fill-opacity", 0.32)
        .attr("stroke", (s) => (s.open ? col : "var(--surface-1)")).attr("stroke-width", (s) => (s.open ? 1.3 : 0.5))
        .on("mouseenter", function (ev: MouseEvent, s) {
          d3.select(this).attr("r", 5).attr("fill-opacity", 1);
          showTip(ev, `<b>${esc(s.id)}</b> · ${fd(s.los)} days${s.open ? " so far · <b>still in hospital</b>" : ""}${s.los > xmax ? ' <span class="m">(beyond axis)</span>' : ""}<br><span class="m">${s.seq.map((x) => esc(x.ward) + " " + fd(x.days) + "d").join(" → ")}</span><br><span class="m">${esc(s.dx)} · ${esc(s.legal)} · ${esc(s.age)}</span>`);
        })
        .on("mousemove", moveTip)
        .on("mouseleave", function () {
          d3.select(this).attr("r", 3).attr("fill-opacity", 0.32);
          hideTip();
        });
      if (has) {
        g.append("rect").attr("x", x(q1)).attr("y", cy - 3).attr("width", Math.max(2, x(q3) - x(q1))).attr("height", 6).attr("rx", 3).attr("fill", col).attr("pointer-events", "none");
        g.append("rect").attr("x", x(md) - 1.5).attr("y", cy - 11).attr("width", 3).attr("height", 22).attr("rx", 1.5).attr("fill", "var(--text-primary)").attr("stroke", "var(--surface-1)").attr("stroke-width", 1.5).attr("pointer-events", "none");
        if (!narrow) g.append("text").attr("x", x(md) + 6).attr("y", cy - 12).attr("font-size", 11.5).attr("font-weight", 600).attr("fill", "var(--text-primary)").attr("pointer-events", "none").text(fd(md) + " d");
      }
    });
    $("#losNote").textContent = (soFar()
      ? "Current inpatients only: each dot is length of stay so far, not final. Bar = interquartile range, tick = median."
      : "Each dot is one spell. Bar = interquartile range, tick = median, both from discharged spells. Hollow dots are still in hospital.") +
      (sampled ? ` Large groups show a random sample of ${fmt(DOT_CAP)} dots; the figures use every spell.` : "");
  }

  /* ----- pathway table ----- */
  const pathHtml = (p: string[], from: string, to: string, end: boolean | null) =>
    p.map((w, i) => (i ? (p[i - 1] === from && w === to ? '<span class="hlm">→</span>' : '<span class="arr">→</span>') : "") + esc(w)).join("") +
    '<span class="arr">→</span><span class="note">' + (end === true ? "Still in hospital" : end === false ? "Discharged" : "…") + "</span>";
  const pt = { search: "", sort: "n", dir: -1, onlyHl: false, page: 0, open: "" };
  const ps = { sort: "los", dir: -1 }; // spell list inside an opened pathway
  const PAGE = 25, SPELL_CAP = 200;
  let lastView: S[] = [];
  const NHS_PALETTE = ["#768692", "#41b6e6", "#78be20", "#ae2573", "#ffb81c", "#8a1538", "#006747", "#425563", "#aeb7bd", "#7c2855"];
  const wardColor = (w: string, from: string, to: string) =>
    w === from ? "var(--from-node)" : w === to ? "var(--to-node)" : NHS_PALETTE[Math.max(0, WARDS.indexOf(w)) % NHS_PALETTE.length];

  interface PRow { key: string; path: string[]; sp: S[]; n: number; nO: number; avg: number }
  const meanLos = (sp: S[]) => d3.mean(statSet(sp), (s) => s.los) ?? NaN;
  function pathRows(spells: S[], from: string, to: string): (PRow & { sb: number })[] {
    const terms = pt.search.toLowerCase().split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
    let rows = d3.groups(spells, (s) => s.path.join(">")).map(([key, sp]) => ({
      key, path: sp[0].path, sp, n: sp.length, nO: sp.filter((s) => s.open).length, avg: meanLos(sp), sb: moves(sp[0], from, to),
    }));
    if (terms.length) rows = rows.filter((r) => { const t = r.path.join(" > ").toLowerCase(); return terms.every((x) => t.includes(x)); });
    if (pt.onlyHl) rows = rows.filter((r) => r.sb > 0);
    const val: Record<string, (r: PRow) => number | string> = {
      path: (r) => r.key, wards: (r) => r.path.length, n: (r) => r.n, nO: (r) => r.nO, avg: (r) => (isFinite(r.avg) ? r.avg : -1),
    };
    const f = val[pt.sort] ?? val.n;
    return rows.sort((a, b) => {
      const x = f(a), y = f(b);
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return c * pt.dir || b.n - a.n;
    });
  }

  /* Admission is known to the month only, so discharge month is estimated as admission month + stay. */
  const monthFmt = d3.utcFormat("%b %Y");
  const admDate = (s: S) => (s.adm ? new Date(Date.UTC(+s.adm.slice(0, 4), +s.adm.slice(5, 7) - 1, 1)) : null);
  const disTime = (s: S) => { const a = admDate(s); return a && !s.open ? a.getTime() + s.los * 864e5 : NaN; };
  const sortHead = (label: string, key: string, cur: { sort: string; dir: number }, attr: string, cls = "") =>
    `<th class="sortable${cls ? " " + cls : ""}${cur.sort === key ? " sorted" : ""}" ${attr}="${key}" title="Sort by ${esc(label.toLowerCase())}">${label}<span class="sdir">${cur.sort === key ? (cur.dir < 0 ? "▼" : "▲") : "↕"}</span></th>`;

  function spellDetail(r: PRow, from: string, to: string): string {
    const val: Record<string, (s: S) => number | string> = {
      id: (s) => s.id, adm: (s) => s.adm || "", dis: (s) => (s.open ? Infinity : disTime(s) || 0), los: (s) => s.los, status: (s) => (s.open ? 1 : 0),
    };
    const f = val[ps.sort] ?? val.los;
    const sp = r.sp.slice().sort((a, b) => {
      const x = f(a), y = f(b);
      return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * ps.dir;
    });
    const shown = sp.slice(0, SPELL_CAP);
    const maxLos = d3.max(r.sp, (s) => s.los) || 1;
    const h = (label: string, key: string, cls = "") => sortHead(label, key, ps, "data-psort", cls);
    return `<div class="spells"><table><thead><tr>${h("Spell", "id")}${h("Admitted", "adm")}${h("Discharged (approx.)", "dis")}${h("Status", "status")}${h("Stay (d)", "los", "n")}<th class="tl">Ward by ward (bar length = days; hover for detail)</th></tr></thead><tbody>` +
      shown.map((s) => {
        const a = admDate(s), d = disTime(s);
        return `<tr><td>${esc(s.id)}</td><td>${a ? monthFmt(a) : "–"}</td><td>${s.open ? '<span class="note">still in hospital</span>' : isFinite(d) ? "≈ " + monthFmt(new Date(d)) : "–"}</td><td>${s.open ? "In hospital" : "Discharged"}</td><td class="n">${fd(s.los)}</td><td class="tl"><div class="tlbar" style="width:${Math.max(2, (s.los / maxLos) * 100)}%">` +
          s.seq.map((x) => `<span style="flex:${Math.max(x.days, 0.01)};background:${wardColor(x.ward, from, to)}" title="${esc(x.ward)}: ${fd(x.days)} days"></span>`).join("") +
          `</div></td></tr>`;
      }).join("") +
      (sp.length > SPELL_CAP ? `<tr><td colspan="6" class="note">Showing the first ${SPELL_CAP} of ${fmt(sp.length)} spells in this order.</td></tr>` : "") +
      `</tbody></table><div class="legend">${r.path.filter((w, i, a) => a.indexOf(w) === i).map((w) => `<span><i style="background:${wardColor(w, from, to)};height:10px"></i>${esc(w)}</span>`).join("")}</div>
      <p class="note">Admission is recorded by month only, so the discharge month is estimated (admission month + length of stay) and may be out by up to a month.</p></div>`;
  }

  /** Pathway with days on each ward, e.g. "Adult rehab 28 d → Adult acute 12 d → Still in hospital". */
  const pathDaysHtml = (s: S, from: string, to: string) =>
    s.seq.map((x, i) =>
      (i ? (s.path[i - 1] === from && x.ward === to ? '<span class="hlm">→</span>' : '<span class="arr">→</span>') : "") +
      `<span class="pw">${esc(x.ward)} <span class="pd">${fd(x.days)} d</span></span> `).join("") +
    `<span class="arr">→</span><span class="note">${s.open ? "Still in hospital" : "Discharged"}</span>`;

  function table(spells: S[], from: string, to: string): void {
    lastView = spells;
    const rows = pathRows(spells, from, to);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    pt.page = Math.min(pt.page, pages - 1);
    const slice = rows.slice(pt.page * PAGE, (pt.page + 1) * PAGE);
    const end = soFar() ? true : st.status === "disc" ? false : null;
    const ah = soFar() ? "Average so far (d)" : "Average stay (d)";
    const nSp = d3.sum(rows, (r) => r.n);
    $("#pHint").textContent = st.onlyFrom ? `Only spells that included ${from} are shown — untick “Only spells that entered the “from” ward” above to see every spell.` : "";
    $("#pSummary").textContent = rows.length
      ? `${fmt(rows.length)} distinct pathways covering ${fmt(nSp)} spells (${pct(nSp, spells.length)} of spells in view) · showing ${fmt(pt.page * PAGE + 1)}–${fmt(pt.page * PAGE + slice.length)}`
      : "No pathways match.";
    const h = (label: string, key: string, cls = "") => sortHead(label, key, pt, "data-sort", cls);
    $("#ptable").innerHTML = `<thead><tr>${h("Pathway", "path")}${h("Wards", "wards", "n")}${h("Spells", "n", "n")}${h("In hospital now", "nO", "n")}<th class="n">Share</th>${h(ah, "avg", "n")}</tr></thead><tbody>` +
      slice.map((r) => `<tr class="prow${r.sb ? " sb" : ""}${pt.open === r.key ? " open" : ""}" data-key="${esc(r.key)}" tabindex="0"><td class="path"><span class="caret">${pt.open === r.key ? "▾" : "▸"}</span>${pathHtml(r.path, from, to, end)}${r.sb ? `<span class="tag">${esc(from)}→${esc(to)}${r.sb > 1 ? " ×" + r.sb : ""}</span>` : ""}</td><td class="n">${r.path.length}</td><td class="n">${fmt(r.n)}</td><td class="n">${fmt(r.nO)}</td><td class="n">${r.n / spells.length < 0.005 ? "&lt;1%" : pct(r.n, spells.length)}</td><td class="n">${isFinite(r.avg) ? fd(r.avg) : "–"}</td></tr>` +
        (pt.open === r.key ? `<tr class="detail"><td colspan="6">${spellDetail(r, from, to)}</td></tr>` : "")).join("") + "</tbody>";
    $("#pPager").innerHTML = pages > 1
      ? `<button type="button" data-page="0"${pt.page === 0 ? " disabled" : ""}>« First</button><button type="button" data-page="${pt.page - 1}"${pt.page === 0 ? " disabled" : ""}>‹ Previous</button><span class="note">Page ${pt.page + 1} of ${fmt(pages)}</span><button type="button" data-page="${pt.page + 1}"${pt.page >= pages - 1 ? " disabled" : ""}>Next ›</button><button type="button" data-page="${pages - 1}"${pt.page >= pages - 1 ? " disabled" : ""}>Last »</button>`
      : "";
  }
  const retable = () => table(lastView, st.from, st.to);
  $("#pSearch").addEventListener("input", (e) => { pt.search = (e.target as HTMLInputElement).value; pt.page = 0; pt.open = ""; retable(); });
  $("#pOnlyHl").addEventListener("change", (e) => { pt.onlyHl = (e.target as HTMLInputElement).checked; pt.page = 0; pt.open = ""; retable(); });
  $("#pPager").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-page]");
    if (!b) return;
    pt.page = +b.dataset.page!;
    pt.open = "";
    retable();
    $("#ptable").scrollIntoView({ block: "nearest" });
  });
  const toggleRow = (e: Event) => {
    const t = e.target as Element;
    const sh = t.closest<HTMLElement>("[data-sort]");
    if (sh) {
      const k = sh.dataset.sort!;
      pt.dir = pt.sort === k ? -pt.dir : k === "path" ? 1 : -1;
      pt.sort = k;
      pt.page = 0;
      retable();
      return;
    }
    const ph = t.closest<HTMLElement>("[data-psort]");
    if (ph) {
      const k = ph.dataset.psort!;
      ps.dir = ps.sort === k ? -ps.dir : k === "id" || k === "adm" || k === "dis" ? 1 : -1;
      ps.sort = k;
      retable();
      return;
    }
    if (t.closest("tr.detail")) return;
    const tr = t.closest<HTMLElement>("tr.prow");
    if (!tr) return;
    pt.open = pt.open === tr.dataset.key ? "" : tr.dataset.key!;
    retable();
  };
  $("#ptable").addEventListener("click", toggleRow);
  $("#ptable").addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") toggleRow(e); });
  $("#pCsv").addEventListener("click", () => {
    const rows = pathRows(lastView, st.from, st.to);
    const cell = (v: unknown) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [["pathway", "wards", "spells", "in_hospital_now", "average_stay_days", `includes_${st.from}_to_${st.to}`].join(",")]
      .concat(rows.map((r) => [r.path.join(" > "), r.path.length, r.n, r.nO, isFinite(r.avg) ? Math.round(r.avg) : "", r.sb > 0 ? "yes" : "no"].map(cell).join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `ward-pathways-${st.group}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* ----- current inpatient watchlist ----- */
  function watch(spells: S[], from: string, to: string): void {
    const card = $("#watchCard");
    card.hidden = !nOpenAll;
    if (!nOpenAll) return;
    $("#watchTitle").textContent = `Current inpatients moved ${from} → ${to}`;
    const rows = spells.filter((s) => s.open && moves(s, from, to) > 0).sort((a, b) => b.los - a.los);
    if (!rows.length) {
      $("#wtable").innerHTML = `<tbody><tr><td class="note">No current inpatients in view have had this move.</td></tr></tbody>`;
      return;
    }
    $("#wtable").innerHTML = `<thead><tr><th>Spell</th><th>Current ward</th><th>Pathway</th><th class="n">Days in hospital</th><th class="n">Days since move</th><th class="n">Days on current ward</th></tr></thead><tbody>` +
      rows.slice(0, 25).map((s) => {
        const cur = s.seq[s.seq.length - 1];
        return `<tr class="sb"><td>${esc(s.id)}</td><td>${esc(cur.ward)}</td><td class="path"><div class="pathwrap">${pathDaysHtml(s, from, to)}</div></td><td class="n">${fd(s.los)}</td><td class="n">${fd(daysAfterMove(s, from, to) ?? 0)}</td><td class="n">${fd(cur.days)}</td></tr>`;
      }).join("") + (rows.length > 25 ? `<tr><td colspan="6" class="note">…and ${fmt(rows.length - 25)} more</td></tr>` : "") + "</tbody>";
  }

  /* ----- render ----- */
  function render(): void {
    const { from, to } = st;
    $("#lgHl").textContent = `${from} → ${to}`;
    $("#lgFrom").textContent = from;
    $("#lgTo").textContent = to;
    let sp = ALL.filter((s) =>
      (!st.year || s.year >= st.year) && (!st.age || s.age === st.age) && (!st.legal || s.legal === st.legal) &&
      (!st.dx || s.dx === st.dx) && (!st.borough || s.borough === st.borough));
    const nCm = [st.year, st.age, st.legal, st.dx, st.borough].filter(Boolean).length;
    $("#cmCount").textContent = nCm ? `· ${nCm} active` : "";
    if (nCm) ($("#caseMix") as HTMLDetailsElement).open = true;
    if (st.onlyFrom) sp = sp.filter((s) => s.path.includes(from));
    if (st.status === "disc") sp = sp.filter((s) => !s.open);
    if (st.status === "open") sp = sp.filter((s) => s.open);
    if (!sp.length) {
      for (const id of ["#tiles", "#sankey", "#los", "#ptable", "#wtable"]) $(id).innerHTML = "";
      $("#tiles").innerHTML = '<p class="note">No spells match these settings.</p>';
      return;
    }
    tiles(sp, from, to);
    sankey(sp, from, to);
    losChart(sp, from, to);
    watch(sp, from, to);
    table(sp, from, to);
  }

  // Replace any handler left by an earlier mount (Refresh re-mounts the explorer).
  offResize?.();
  let rt = 0;
  const onResize = () => {
    clearTimeout(rt);
    rt = window.setTimeout(render, 120);
  };
  window.addEventListener("resize", onResize);
  offResize = () => window.removeEventListener("resize", onResize);

  prep();
  fillWardSelects();
  render();
}
