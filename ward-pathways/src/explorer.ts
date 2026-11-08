import * as d3 from "d3";
import type { WardData } from "./data/shape";

import {
  DOT_CAP, broad, fmt, fd, pct, q, sorted, esc, seeded, moves, returnedTo, daysAfterMove,
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
    steps: 5,
    excl: new Set<string>(),
    exclMode: "days" as "days" | "spells",
    anchor: "", // "" = admission, else first stay on this ward

  };

  const nOpenAll = ALL.filter((s) => s.open).length;
  const mismatch = ALL.reduce(
    (n, s) => n + s.stays.filter((x) => /rehab/i.test(x.ward) !== /rehab/i.test(x.bed)).length,
    0,
  );
  const rehabStays = ALL.reduce((n, s) => n + s.stays.filter((x) => /rehab/i.test(x.ward)).length, 0);

  const opt = (v: string | number, label: string, sel: boolean) =>
    `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(label)}</option>`;

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
        <label class="switch"><input type="checkbox" role="switch" id="themeT"><span class="track" aria-hidden="true"></span> Dark mode</label>
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

  <div class="tiles" id="tiles"></div>

  <div class="card">
    <div class="cardhead">
      <div><h2>Patient flow, ward by ward</h2>
      <div class="note">Each column is the next ward stay in the spell; moves between two wards of the same type are merged. Band width = number of spells. <b>Hover</b> a ward or band to trace where those patients go; <b>click</b> to follow only them forward, and use the trail to go back.</div></div>
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

  <div class="card">
    <div class="cardhead">
      <div><h2>Length of stay by discharge ward</h2>
      <div class="note" id="disNote"></div></div>
      <div class="controls">
        <div class="ctl">Excluded wards
          <select id="exclMode">${opt("days", "Remove their days from the stay", true)}${opt("spells", "Leave out spells that used them", false)}</select></div>
      </div>
    </div>
    <div class="chips" id="exclChips"></div>
    <div id="disChart"></div>
    <div class="legend" id="disLegend"></div>
    <div id="disDrill"></div>
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
    <p class="caveat">These figures show an association, not proof that the move itself causes the longer stay. Patients moved back to acute care are often more unwell, so part of the gap may come from case mix. Watch the rehab days “lost” before a step-back and whether patients return to rehab, where the programme often restarts.</p>
    <p class="caveat"><b>Data notes.</b> Ward type and bed type disagree on rehab for ${fmt(mismatch)} stays (${fmt(rehabStays)} stays are on wards labelled rehab), so compare both groupings. Medians and quartiles use discharged spells unless “Current inpatients only” is chosen. Length of stay is the sum of ward days in the spell. A few admissions date from before 2007.</p>
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
    for (const w of [...st.excl]) if (!WARDS.includes(w)) st.excl.delete(w);
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
  bind("#stepsSel", (el) => (st.steps = +el.value));
  bind("#exclMode", (el) => (st.exclMode = el.value as "days" | "spells"));
  $("#exclChips").addEventListener("change", (e) => {
    const cb = e.target as HTMLInputElement;
    if (cb.checked) st.excl.add(cb.value);
    else st.excl.delete(cb.value);
    dischargeChart(lastSp);
  });
  $("#exclChips").addEventListener("click", (e) => {
    if (!(e.target as Element).closest("[data-clear]")) return;
    st.excl.clear();
    render();
  });
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
    const withMove = fromSp.filter((s) => moves(s, from, to) > 0);
    const nOpen = view.filter((s) => s.open).length;
    const openMove = view.filter((s) => s.open && moves(s, from, to) > 0);
    const om = openMove.map((s) => s.los);
    const T = [
      { k: "Spells in view", v: fmt(view.length), d: `${fmt(view.length - nOpen)} discharged · ${fmt(nOpen)} still in hospital` },
      { k: `${esc(from)} spells moved to ${esc(to)}`, v: pct(withMove.length, fromSp.length), d: `${fmt(withMove.length)} of ${fmt(fromSp.length)} spells that included ${esc(from)}` },
    ];
    if (nOpen)
      T.push({ k: `Current inpatients moved ${esc(from)} → ${esc(to)}`, v: fmt(openMove.length), d: om.length ? `average ${fd(d3.mean(om)!)} days in hospital so far` : "none at present" });
    $("#tiles").innerHTML = T.map(
      (t) => `<div class="tile${"hero" in t && t.hero ? " hero" : ""}"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="d">${t.d}</div></div>`,
    ).join("");
  }

  /* ----- sankey (hand laid out) ----- */
  interface SNode { c: number; name: string; key: string; sp: S[]; in: SLink[]; out: SLink[]; x: number; y: number; h: number }
  interface SLink { s: string; t: string; sp: S[]; hl: boolean; w: number; y0: number; y1: number }
  /** Drill-down stack: each level keeps the spells followed and the column that was clicked.
   *  Columns keep their real positions: earlier wards stay visible (faded) to the left. */
  interface Level { label: string; sp: Set<S>; base: number }
  const drill: Level[] = [];

  function sankey(spells: S[], from: string, to: string): void {
    const host = $("#sankey");
    const avail = Math.max(340, host.clientWidth), narrow = avail < 640;

    // Where each spell's flow starts: admission, or the first stay on the anchor ward.
    // Drilling only narrows the spells; it never moves the starting column.
    let pool = st.anchor ? spells.filter((s) => s.path.includes(st.anchor)) : spells;
    const level = drill[drill.length - 1];
    if (level) pool = pool.filter((s) => level.sp.has(s));
    const base = level?.base ?? 0; // selected column; columns before it are history
    const off = new Map(pool.map((s) => [s, st.anchor ? s.path.indexOf(st.anchor) : 0]));
    const list = pool;
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

    const MAXSTEPS = base + st.steps;
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

    const ord = (c: number) => c + 1 + (c === 0 ? "st" : c === 1 ? "nd" : c === 2 ? "rd" : "th");
    const colName = (c: number) =>
      st.anchor ? (c === 0 ? "Starting ward" : c === 1 ? "Next ward" : `${ord(c)} ward from start`) : `${ord(c)} ward`;
    const drilled = drill.length > 0;
    const isHist = (c: number) => drilled && c < base;
    const follow = (label: string, sp: S[], c: number) => {
      drill.push({ label: `${colName(c)}: ${label}`, sp: new Set(sp), base: c });
      hideTip();
      render();
    };
    const total = list.length;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const DUR = reduce ? 0 : 650;

    // One persistent svg: elements are matched by key between renders so they glide to new places.
    let svg = d3.select(host).select<SVGSVGElement>("svg.flow");
    if (svg.empty()) {
      host.innerHTML = "";
      svg = d3.select(host).append("svg").attr("class", "flow").attr("role", "img").attr("aria-label", "Flow of spells between ward types");
      for (const c of ["cols", "links", "trace", "nodes", "labels"]) svg.append("g").attr("class", c);
    }
    svg.attr("width", W > avail ? W : "100%").attr("viewBox", `0 0 ${W} ${H}`).classed("tracing", false);
    svg.select("g.trace").selectAll("*").remove();
    const t = svg.transition().duration(DUR).ease(d3.easeCubicInOut) as unknown as d3.Transition<d3.BaseType, unknown, null, undefined>;

    svg.select("g.cols").selectAll<SVGTextElement, number>("text").data(d3.range(C), (c) => c)
      .join((e) => e.append("text").attr("y", 10).attr("font-size", 11).attr("fill", "var(--text-muted)").attr("x", (c) => c * xStep).attr("opacity", 0))
      .text((c) => (narrow && !st.anchor ? ord(c) : colName(c)) + (drilled && c === base ? " · selected" : ""))
      .attr("font-weight", (c) => (drilled && c === base ? 700 : 400))
      .attr("fill", (c) => (drilled && c === base ? "var(--nhs-blue)" : "var(--text-muted)"))
      .transition(t).attr("x", (c) => c * xStep).attr("opacity", (c) => (isHist(c) ? 0.6 : 1));

    const L = [...links.values()].sort((a, b) => +a.hl - +b.hl);
    // Bands are filled ribbons between their top and bottom edges, so wide bands stay
    // inside their two columns. The highlighted move keeps a visible minimum width.
    const bw = (l: SLink) => (l.hl ? Math.max(4, l.w) : Math.max(1, l.w));
    const ribbonPath = (l: SLink, h: number, c0: number, c1: number) => {
      const a = nodes.get(l.s)!, b = nodes.get(l.t)!;
      const x0 = a.x + nodeW, x1 = b.x, xm = (x0 + x1) / 2;
      return `M${x0},${c0 - h}C${xm},${c0 - h} ${xm},${c1 - h} ${x1},${c1 - h}L${x1},${c1 + h}C${xm},${c1 + h} ${xm},${c0 + h} ${x0},${c0 + h}Z`;
    };
    const ribbon = (l: SLink) => ribbonPath(l, bw(l) / 2, l.y0, l.y1);
    const linkKey = (l: SLink) => l.s + ">" + l.t;
    const nodeFill = (n: SNode) => n.name === "Still in hospital" ? "var(--base)" : isTerm(n.name) ? "var(--node-term)" : n.name === from ? "var(--from-node)" : n.name === to ? "var(--to-node)" : "var(--node)";
    const nodeY = (n: SNode) => n.y - (n.h < 6 ? 2 : 0);
    const nodeH = (n: SNode) => (n.h < 6 ? n.h + 4 : n.h);
    const N = [...nodes.values()];

    /* ----- hover tracing: show where these exact patients go, fade everything else ----- */
    const traceSel = svg.select("g.trace");
    const trace = (set: Set<S> | null) => {
      traceSel.selectAll("*").remove();
      svg.classed("tracing", !!set);
      nodeSel.classed("dim", (n) => !!set && !n.sp.some((s) => set.has(s)));
      labelSel.classed("dim", (n) => !!set && !n.sp.some((s) => set.has(s)));
      if (!set) return;
      for (const l of L) {
        let c = 0;
        for (const s of l.sp) if (set.has(s)) c++;
        if (!c) continue;
        // The traced share sits at the top of its band, in proportion to its size.
        const w = Math.max(1.5, (c / l.sp.length) * bw(l)), top0 = l.y0 - bw(l) / 2, top1 = l.y1 - bw(l) / 2;
        traceSel.append("path").attr("d", ribbonPath(l, w / 2, top0 + w / 2, top1 + w / 2))
          .attr("fill", l.hl ? "var(--hl)" : "var(--trace)").attr("fill-opacity", 0.9).attr("pointer-events", "none");
      }
    };

    const linkSel = svg.select("g.links").selectAll<SVGPathElement, SLink>("path").data(L, linkKey)
      .join(
        (e) => e.append("path").attr("d", ribbon).attr("fill-opacity", 0),
        (u) => u,
        (x) => x.attr("pointer-events", "none").transition(t).attr("fill-opacity", 0).remove(),
      )
      .attr("fill", (l) => (l.hl ? "var(--hl)" : "var(--link)"))
      .style("cursor", (l) => (isTerm(nodes.get(l.t)!.name) ? "default" : "pointer"))
      .on("click", (_ev, l) => {
        const a = nodes.get(l.s)!, b = nodes.get(l.t)!;
        if (!isTerm(b.name)) follow(`${a.name} → ${b.name}`, l.sp, b.c);
      })
      .on("mouseenter", (ev: MouseEvent, l) => {
        trace(new Set(l.sp));
        const a = nodes.get(l.s)!, b = nodes.get(l.t)!, los = losOf(l.sp), nO = l.sp.filter((s) => s.open).length;
        showTip(ev, `<b>${esc(a.name)} → ${esc(b.name)}</b><br>${fmt(l.sp.length)} spells (${pct(l.sp.length, total)})${nO && !soFar() ? `, ${fmt(nO)} still in hospital` : ""}` +
          (los.length ? `<br>${soFar() ? "Median stay so far" : "Median total stay"}: <b>${fd(q(los, 0.5))} days</b><br><span class="m">IQR ${fd(q(los, 0.25))}–${fd(q(los, 0.75))} days</span>` : `<br><span class="m">No discharged spells yet</span>`) +
          (isTerm(b.name) ? "" : `<br><span class="m">Click to follow these patients</span>`));
      })
      .on("mousemove", moveTip)
      .on("mouseleave", () => { trace(null); hideTip(); });
    linkSel.order();
    // Bands leading up to the selected column are history: shown, but faded.
    const linkOp = (l: SLink) => (isHist(nodes.get(l.s)!.c) ? (l.hl ? 0.4 : 0.14) : l.hl ? 0.9 : 0.35);
    linkSel.transition(t).attr("d", ribbon).attr("fill-opacity", linkOp);

    const nodeSel = svg.select("g.nodes").selectAll<SVGRectElement, SNode>("rect").data(N, (n) => n.key)
      .join(
        (e) => e.append("rect").attr("x", (n) => n.x).attr("y", nodeY).attr("width", nodeW).attr("height", nodeH).attr("rx", 3).attr("opacity", 0),
        (u) => u,
        (x) => x.attr("pointer-events", "none").transition(t).attr("opacity", 0).remove(),
      )
      .style("cursor", (n) => (isTerm(n.name) ? "default" : "pointer"))
      .on("click", (_ev, n) => {
        if (isTerm(n.name) || n.sp.length === list.length && n.c === base) return;
        follow(n.name, n.sp, n.c);
      })
      .on("mouseenter", (ev: MouseEvent, n) => {
        trace(new Set(n.sp));
        const los = losOf(n.sp);
        const days = sorted(n.sp.map((s) => s.seq[o(s) + n.c]?.days).filter((x): x is number => x != null));
        const clickable = !isTerm(n.name) && !(n.sp.length === list.length && n.c === base);
        showTip(ev, `<b>${esc(n.name)}</b><br>${fmt(n.sp.length)} spells (${pct(n.sp.length, total)})${!isTerm(n.name) && days.length ? `<br>Median days on this ward: <b>${fd(q(days, 0.5))}</b>` : ""}${los.length ? `<br>${soFar() ? "Median stay so far" : "Median total stay"}: <b>${fd(q(los, 0.5))} days</b>` : ""}${clickable ? `<br><span class="m">Click to follow these patients forward</span>` : ""}`);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", () => { trace(null); hideTip(); });
    nodeSel.attr("stroke", (n) => (drilled && n.c === base ? "var(--text-primary)" : "none")).attr("stroke-width", 2);
    nodeSel.transition(t).attr("x", (n) => n.x).attr("y", nodeY).attr("height", nodeH).attr("fill", nodeFill).attr("opacity", (n) => (isHist(n.c) ? 0.5 : 1));

    const labelled = N.filter((n) => (narrow ? n.h >= 16 : n.h >= 9 || n.sp.length / total > 0.02));
    const labelSel = svg.select("g.labels").selectAll<SVGTextElement, SNode>("text").data(labelled, (n) => n.key)
      .join(
        (e) => e.append("text").attr("x", (n) => n.x + nodeW + 5).attr("y", (n) => n.y + n.h / 2).attr("dy", "0.35em").attr("opacity", 0)
          .attr("fill", "var(--text-secondary)").attr("pointer-events", "none"),
        (u) => u,
        (x) => x.attr("pointer-events", "none").transition(t).attr("opacity", 0).remove(),
      )
      .attr("font-size", narrow ? 10.5 : 12).attr("font-weight", (n) => (n.name === from || n.name === to ? 700 : 400))
      .text((n) => `${n.name} ${fmt(n.sp.length)}`);
    labelSel.transition(t).attr("x", (n) => n.x + nodeW + 5).attr("y", (n) => n.y + n.h / 2).attr("opacity", (n) => (isHist(n.c) ? 0.55 : 1));
    // Keep the selected column in view when the diagram is wider than the card.
    if (W > avail) host.scrollTo({ left: drilled ? Math.max(0, base * xStep - xStep) : 0, behavior: reduce ? "auto" : "smooth" });
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
      const nTxt = soFar() ? `n=${fmt(gp.sp.length)} in hospital` : `n=${fmt(gp.sp.length - nO)}${nO ? ` + ${fmt(nO)} in hospital` : ""}`;
      const mTxt = has ? ` · median ${fd(md)} d` : " · no discharges yet";
      const g = svg.append("g");
      if (narrow) {
        g.append("text").attr("x", 0).attr("y", y0 + 14).attr("font-size", 12).attr("font-weight", 600).attr("fill", "var(--text-primary)").text(gp.name);
        g.append("text").attr("x", 0).attr("y", y0 + 28).attr("font-size", 11).attr("fill", "var(--text-secondary)").text(nTxt + mTxt);
      } else {
        g.append("text").attr("x", 0).attr("y", cy - 4).attr("font-size", 12.5).attr("font-weight", 600).attr("fill", "var(--text-primary)").text(gp.name);
        g.append("text").attr("x", 0).attr("y", cy + 12).attr("font-size", 11.5).attr("fill", "var(--text-secondary)").text(nTxt + mTxt + (has ? ` · IQR ${fd(q1)}–${fd(q3)}` : ""));
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
  const NHS_PALETTE = ["#768692", "#41b6e6", "#78be20", "#ae2573", "#ffb81c", "#8a1538", "#006747", "#425563", "#aeb7bd", "#7c2855", "#b07c00", "#00708a"];
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

  const dayFmt = d3.utcFormat("%-d %b %Y");
  const isoDay = d3.utcFormat("%Y-%m-%d");
  const dateCell = (t: number) => (isFinite(t) ? dayFmt(new Date(t)) : "–");
  const sortHead = (label: string, key: string, cur: { sort: string; dir: number }, attr: string, cls = "") =>
    `<th class="sortable${cls ? " " + cls : ""}${cur.sort === key ? " sorted" : ""}" ${attr}="${key}" title="Sort by ${esc(label.toLowerCase())}">${label}<span class="sdir">${cur.sort === key ? (cur.dir < 0 ? "▼" : "▲") : "↕"}</span></th>`;

  function spellDetail(r: PRow, from: string, to: string): string {
    const val: Record<string, (s: S) => number | string> = {
      id: (s) => s.id, adm: (s) => s.admAt || 0, dis: (s) => (s.open ? Infinity : s.disAt || 0), los: (s) => s.los, status: (s) => (s.open ? 1 : 0),
    };
    const f = val[ps.sort] ?? val.los;
    const sp = r.sp.slice().sort((a, b) => {
      const x = f(a), y = f(b);
      return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * ps.dir;
    });
    const shown = sp.slice(0, SPELL_CAP);
    const maxLos = d3.max(r.sp, (s) => s.los) || 1;
    const h = (label: string, key: string, cls = "") => sortHead(label, key, ps, "data-psort", cls);
    return `<div class="spells"><table><thead><tr>${h("Spell", "id")}${h("Admitted", "adm")}${h("Discharged", "dis")}${h("Status", "status")}${h("Stay (d)", "los", "n")}<th class="tl">Ward by ward (bar length = days; hover for detail)</th></tr></thead><tbody>` +
      shown.map((s) => {
        return `<tr><td>${esc(s.id)}</td><td>${dateCell(s.admAt)}</td><td>${s.open ? '<span class="note">still in hospital</span>' : dateCell(s.disAt)}</td><td>${s.open ? "In hospital" : "Discharged"}</td><td class="n">${fd(s.los)}</td><td class="tl"><div class="tlbar" style="width:${Math.max(2, (s.los / maxLos) * 100)}%">` +
          s.seq.map((x) => `<span style="flex:${Math.max(x.days, 0.01)};background:${wardColor(x.ward, from, to)}" title="${esc(x.ward)}: ${fd(x.days)} days"></span>`).join("") +
          `</div></td></tr>`;
      }).join("") +
      (sp.length > SPELL_CAP ? `<tr><td colspan="6" class="note">Showing the first ${SPELL_CAP} of ${fmt(sp.length)} spells in this order.</td></tr>` : "") +
      `</tbody></table><div class="legend">${r.path.filter((w, i, a) => a.indexOf(w) === i).map((w) => `<span><i style="background:${wardColor(w, from, to)};height:10px"></i>${esc(w)}</span>`).join("")}</div></div>`;
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

  /* ----- LOS by discharge ward ----- */
  let lastSp: S[] = [];
  /** Drill-through from the discharge-ward chart: the group (and optional ward type) clicked. */
  const dd = { ward: "", via: "", sort: "los", dir: -1, page: 0 };
  const DD_PAGE = 50;
  let ddRows: S[] = [];
  const keepWard = (w: string) => !(st.exclMode === "days" && st.excl.has(w));
  const adjLos = (s: S) => d3.sum(s.seq, (x) => (keepWard(x.ward) ? x.days : 0));

  function drillThrough(disc: S[]): void {
    const box = $("#disDrill");
    if (!dd.ward) { box.innerHTML = ""; ddRows = []; return; }
    let sp = disc.filter((s) => s.path[s.path.length - 1] === dd.ward);
    if (dd.via) sp = sp.filter((s) => s.path.includes(dd.via));
    const adj = st.exclMode === "days" && st.excl.size > 0;
    const val: Record<string, (s: S) => number | string> = {
      id: (s) => s.id, adm: (s) => s.admAt || 0, dis: (s) => s.disAt || 0, los: (s) => adjLos(s), total: (s) => s.los,
      via: (s) => d3.sum(s.seq, (x) => (x.ward === dd.via ? x.days : 0)), moves: (s) => s.path.length,
    };
    const f = val[dd.sort] ?? val.los;
    ddRows = sp.sort((a, b) => {
      const x = f(a), y = f(b);
      return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * dd.dir;
    });
    const pages = Math.max(1, Math.ceil(ddRows.length / DD_PAGE));
    dd.page = Math.min(dd.page, pages - 1);
    const slice = ddRows.slice(dd.page * DD_PAGE, (dd.page + 1) * DD_PAGE);
    const avg = d3.mean(ddRows, adjLos) ?? 0;
    const h = (label: string, key: string, cls = "") => sortHead(label, key, dd, "data-dsort", cls);
    const title = `Discharged from ${dd.ward}${dd.via ? ` · spent time on ${dd.via}` : ""}`;
    box.innerHTML = `<div class="drill">
      <div class="cardhead"><div><h3>${esc(title)}</h3>
        <div class="note">${fmt(ddRows.length)} spells · average stay ${fd(avg)} days${adj ? ` (excluding ${esc([...st.excl].join(", "))})` : ""}. Click a heading to sort.</div></div>
        <div class="drill-actions"><button type="button" data-dcsv="1">Download CSV</button><button type="button" data-dclose="1">✕ Close</button></div></div>
      <div style="overflow-x:auto"><table class="drilltable"><thead><tr>${h("Spell", "id")}${h("Admitted", "adm")}${h("Discharged", "dis")}${h(adj ? "Stay excl. (d)" : "Stay (d)", "los", "n")}${adj ? h("Total stay (d)", "total", "n") : ""}${dd.via ? h(`Days on ${dd.via}`, "via", "n") : ""}${h("Pathway (days on each ward)", "moves")}</tr></thead><tbody>` +
      slice.map((s) => {
        const via = d3.sum(s.seq, (x) => (x.ward === dd.via ? x.days : 0));
        return `<tr><td>${esc(s.id)}</td><td>${dateCell(s.admAt)}</td><td>${dateCell(s.disAt)}</td><td class="n">${fd(adjLos(s))}</td>${adj ? `<td class="n">${fd(s.los)}</td>` : ""}${dd.via ? `<td class="n">${fd(via)}</td>` : ""}<td class="path"><div class="pathwrap">${pathDaysHtml(s, st.from, st.to)}</div></td></tr>`;
      }).join("") + `</tbody></table></div>` +
      (pages > 1 ? `<div class="pager"><button type="button" data-dpage="${dd.page - 1}"${dd.page === 0 ? " disabled" : ""}>‹ Previous</button><span class="note">Page ${dd.page + 1} of ${fmt(pages)}</span><button type="button" data-dpage="${dd.page + 1}"${dd.page >= pages - 1 ? " disabled" : ""}>Next ›</button></div>` : "") +
      `</div>`;
  }

  function dischargeChart(view: S[]): void {
    lastSp = view;
    const host = $("#disChart");
    host.innerHTML = "";
    const { from, to } = st;
    const ex = st.excl;
    // Chips: one per ward type, ticked = excluded.
    $("#exclChips").innerHTML = '<span class="lgroup">Exclude</span>' +
      WARDS.map((w) => `<label class="chip${ex.has(w) ? " on" : ""}"><input type="checkbox" value="${esc(w)}"${ex.has(w) ? " checked" : ""}><b class="sq" style="background:${wardColor(w, from, to)}"></b>${esc(w)}</label>`).join("") +
      (ex.size ? '<button type="button" data-clear="1">Clear</button>' : "");

    let disc = view.filter((s) => !s.open);
    if (st.exclMode === "spells" && ex.size) disc = disc.filter((s) => !s.path.some((w) => ex.has(w)));
    const keep = keepWard;
    const rows = d3.groups(disc, (s) => s.path[s.path.length - 1]).map(([ward, sp]) => {
      const byWard = new Map<string, number>(), users = new Map<string, number>();
      for (const s of sp) {
        for (const x of s.seq) if (keep(x.ward)) byWard.set(x.ward, (byWard.get(x.ward) ?? 0) + x.days);
        for (const w of new Set(s.path)) if (keep(w)) users.set(w, (users.get(w) ?? 0) + 1);
      }
      // avg is per spell in the bar (so parts add up to the bar); perUser is per spell that used the ward.
      const parts = WARDS.filter((w) => byWard.has(w)).map((w) => ({
        ward: w, avg: byWard.get(w)! / sp.length, total: byWard.get(w)!, users: users.get(w) ?? 0,
      }));
      return { ward, n: sp.length, parts, avg: d3.sum(parts, (p) => p.avg) };
    }).filter((r) => r.n).sort((a, b) => b.avg - a.avg);

    const exTxt = ex.size ? (st.exclMode === "days" ? ` Days on ${[...ex].join(", ")} are left out of each stay.` : ` Spells that used ${[...ex].join(", ")} are left out.`) : "";
    $("#disNote").textContent = `Discharged spells grouped by the last ward before discharge (${fmt(disc.length)} spells). Bar = average length of stay, split by the ward types where those days were spent (each part is averaged over every spell in the bar, so the parts add up to the total). Click a ward name or bar to list its spells, or a coloured segment for spells that used that ward. Faded rows have fewer than 10 spells.` + exTxt;
    if (dd.ward && !rows.some((r) => r.ward === dd.ward)) dd.ward = dd.via = "";
    drillThrough(disc);
    if (!rows.length) {
      host.innerHTML = '<p class="note">No discharged spells match these settings.</p>';
      $("#disLegend").innerHTML = "";
      return;
    }
    const W = Math.max(340, host.clientWidth), narrow = W < 640;
    const labelW = narrow ? 120 : 200, rowH = 30, top = 4, axisH = 26;
    const H = top + rows.length * rowH + axisH;
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.avg) || 1]).nice().range([labelW, W - 70]);
    const svg = d3.select(host).append("svg").attr("width", "100%").attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img").attr("aria-label", "Average length of stay by discharge ward");
    const ticks = x.ticks(narrow ? 4 : 8);
    svg.append("g").selectAll("line").data(ticks).join("line").attr("x1", x).attr("x2", x).attr("y1", top).attr("y2", H - axisH).attr("stroke", "var(--grid)");
    svg.append("g").selectAll("text").data(ticks).join("text").attr("x", x).attr("y", H - axisH + 16).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", "var(--text-muted)").text((t) => fmt(t));
    svg.append("text").attr("x", W - 70).attr("y", H - 1).attr("text-anchor", "end").attr("font-size", 11).attr("fill", "var(--text-muted)").text("Average days");
    rows.forEach((r, i) => {
      const y = top + i * rowH, bh = 18, by = y + (rowH - bh) / 2;
      const sel = dd.ward === r.ward;
      const g = svg.append("g").attr("opacity", r.n < 10 ? 0.45 : 1).style("cursor", "pointer")
        .on("click", (ev: MouseEvent) => {
          const via = (ev.target as Element).getAttribute("data-via") ?? "";
          if (dd.ward === r.ward && dd.via === via) dd.ward = dd.via = "";
          else Object.assign(dd, { ward: r.ward, via, page: 0 });
          hideTip();
          dischargeChart(lastSp);
          if (dd.ward) $("#disDrill").scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      if (sel) g.append("rect").attr("x", 0).attr("y", y + 1).attr("width", W - 4).attr("height", rowH - 2).attr("rx", 4).attr("fill", "var(--band)");
      g.append("rect").attr("x", 0).attr("y", y).attr("width", labelW).attr("height", rowH).attr("fill", "transparent");
      g.append("text").attr("x", labelW - 8).attr("y", by + bh / 2).attr("dy", "0.35em").attr("text-anchor", "end").attr("font-size", 12)
        .attr("font-weight", r.ward === from || r.ward === to ? 700 : 400).attr("fill", "var(--text-primary)").text(r.ward);
      let acc = 0;
      for (const p of r.parts) {
        const x0 = x(acc), w = x(acc + p.avg) - x0;
        acc += p.avg;
        g.append("rect").attr("x", x0).attr("y", by).attr("width", Math.max(0, w - (w > 2 ? 1 : 0))).attr("height", bh).attr("fill", wardColor(p.ward, from, to))
          .attr("data-via", p.ward).attr("stroke", sel && dd.via === p.ward ? "var(--text-primary)" : "none").attr("stroke-width", 2)
          .on("mouseenter", (ev: MouseEvent) => showTip(ev, `<b>Discharged from ${esc(r.ward)} · ${esc(p.ward)}</b><br>` +
            `${fmt(p.users)} of ${fmt(r.n)} spells spent time on ${esc(p.ward)}: <b>${fd(p.total / Math.max(1, p.users))} days</b> each on average<br>` +
            `<span class="m">Across all ${fmt(r.n)} spells that is ${fd(p.avg)} days per spell (${fmt(Math.round(p.total))} days ÷ ${fmt(r.n)}), ${r.avg ? Math.round((p.avg / r.avg) * 100) : 0}% of the ${fd(r.avg)}-day average stay</span><br><span class="m">Click to list spells that spent time on ${esc(p.ward)}; click the ward name for all</span>`))
          .on("mousemove", moveTip).on("mouseleave", hideTip);
      }
      g.append("text").attr("x", x(r.avg) + 6).attr("y", by + bh / 2).attr("dy", "0.35em").attr("font-size", 12).attr("fill", "var(--text-primary)")
        .html(`<tspan font-weight="700">${fd(r.avg)} d</tspan><tspan fill="var(--text-muted)"> · n=${fmt(r.n)}</tspan>`);
    });
    const used = WARDS.filter((w) => rows.some((r) => r.parts.some((p) => p.ward === w)));
    $("#disLegend").innerHTML = used.map((w) => `<span><b class="sq" style="background:${wardColor(w, from, to)}"></b>${esc(w)}</span>`).join("");
  }

  $("#disDrill").addEventListener("click", (e) => {
    const t = e.target as Element;
    const sh = t.closest<HTMLElement>("[data-dsort]");
    if (sh) {
      const k = sh.dataset.dsort!;
      dd.dir = dd.sort === k ? -dd.dir : k === "id" || k === "adm" || k === "dis" ? 1 : -1;
      dd.sort = k;
      dd.page = 0;
      dischargeChart(lastSp);
      return;
    }
    const pg = t.closest<HTMLElement>("[data-dpage]");
    if (pg) { dd.page = +pg.dataset.dpage!; dischargeChart(lastSp); return; }
    if (t.closest("[data-dclose]")) { dd.ward = dd.via = ""; dischargeChart(lastSp); return; }
    if (t.closest("[data-dcsv]")) {
      const cell = (v: unknown) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
      const lines = [["spell", "admitted", "discharged", "stay_days", "total_stay_days", "pathway"].join(",")].concat(
        ddRows.map((s) => {
          return [s.id, isFinite(s.admAt) ? isoDay(new Date(s.admAt)) : "", isFinite(s.disAt) ? isoDay(new Date(s.disAt)) : "", Math.round(adjLos(s)), Math.round(s.los),
            s.seq.map((x) => `${x.ward} (${Math.round(x.days)}d)`).join(" > ")].map(cell).join(",");
        }));
      const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `discharged-from-${dd.ward}${dd.via ? "-via-" + dd.via : ""}.csv`.replace(/[^\w.-]+/g, "-") });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
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
    let sp = ALL;
    if (st.onlyFrom) sp = sp.filter((s) => s.path.includes(from));
    if (st.status === "disc") sp = sp.filter((s) => !s.open);
    if (st.status === "open") sp = sp.filter((s) => s.open);
    if (!sp.length) {
      for (const id of ["#tiles", "#sankey", "#los", "#ptable", "#wtable", "#disChart"]) $(id).innerHTML = "";
      $("#tiles").innerHTML = '<p class="note">No spells match these settings.</p>';
      return;
    }
    tiles(sp, from, to);
    sankey(sp, from, to);
    losChart(sp, from, to);
    dischargeChart(sp);
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
