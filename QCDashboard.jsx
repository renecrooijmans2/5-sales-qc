import { useState, useEffect, useMemo, useCallback } from "react";
import { parsePrice, cogPct as calcCog, cogBand as calcBand } from "./shared/pricing.js";

/* ══════════════════════════════════════════
   5+ SALES QC — modular dashboard on top of
   the Notion board "1. USA - Back end".
   One unified view across all stores.
   ══════════════════════════════════════════ */

// How many products the "Run all quality controls" button processes at once.
// Each product is two vision calls, so keep this low enough to stay inside the
// Anthropic rate limit and Vercel's concurrent-function budget.
var RUN_CONCURRENCY = 2;

var API = { rows: "/api/rows", product: "/api/product", run: "/api/qc-run", tags: "/api/tags", sizechart: "/api/sizechart" };

var STATUSES = [
  { key: "Not started", label: "Not started", icon: "box" },
  { key: "In progress", label: "In progress", icon: "bolt" },
  { key: "Done", label: "Done", icon: "check" },
];

var LISTING_ACTIONS = ["Edit images", "Edit material", "Edit sizechart", "Edit functionality", "Edit details", "Edit price", "Discontinue"];

/* ── PALETTE — same language as the complaints dashboard ── */
var N = {
  bg: "#0A0B0D",
  bgS: "#131519",
  bgC: "#101215",
  card2: "#161A1F",
  text: "rgba(236,238,242,0.94)",
  textS: "rgba(236,238,242,0.56)",
  textT: "rgba(236,238,242,0.32)",
  border: "rgba(210,218,230,0.085)",
  borderS: "rgba(210,218,230,0.15)",
  green: "#34D399",
  red: "#FF6B6B",
  orange: "#FBBF24",
  blue: "#4C8DF6",
  blueText: "#8FB8F5",
  cyan: "#4CC9F0",
  quiet: { bg: "rgba(76,141,246,0.11)", border: "rgba(76,141,246,0.28)", text: "#8FB8F5" },
  cardShadow: "0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 32px rgba(0,0,0,0.45)",
  grad: "linear-gradient(135deg,#4C8DF6 0%,#54C3E8 100%)",
};
var FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
var UI_ZOOM = 1.35;

function GlobalStyles() {
  return (
    <style>{`
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes riseIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      * { box-sizing: border-box; }
      body { background: ${N.bg}; margin: 0; }
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(210,218,230,0.14); border-radius: 99px; border: 2px solid transparent; background-clip: content-box; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(76,141,246,0.42); background-clip: content-box; }
      select, input, textarea { font-family: ${FONT}; color: ${N.text}; }
      button { transition: transform .12s ease, box-shadow .15s ease, background .15s ease, border-color .15s ease, opacity .15s; }
      button:not(:disabled):hover { transform: translateY(-1px); }
      button:disabled { cursor: default; }
      button:focus-visible, [tabindex]:focus-visible { outline: 2px solid ${N.blue}; outline-offset: 2px; }
      .card { background: linear-gradient(180deg, rgba(255,255,255,0.028) 0%, rgba(255,255,255,0) 42%), ${N.bgC};
        border: 1px solid ${N.border}; border-radius: 18px; box-shadow: ${N.cardShadow}; }
      .rowHover:hover { background: rgba(56,140,255,0.06) !important; }
      .navItem:hover { background: rgba(255,255,255,0.05); }
      .chartHtml table { border-collapse: collapse; width: 100%; font-size: 11px; }
      .chartHtml th { background: #2C2C2C !important; color: #fff !important; padding: 7px; text-align: center; }
      .chartHtml td { padding: 7px; text-align: center; color: ${N.text}; }
      .chartHtml p { font-size: 11px; color: ${N.textS}; }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; } }
    `}</style>
  );
}

function Ico(props) {
  var s = props.size || 16;
  var paths = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    bolt: "M13 3 5 14h6l-1 7 8-11h-6z",
    box: "M12 3 3 7.5v9L12 21l9-4.5v-9zM3 7.5 12 12l9-4.5M12 12v9",
    check: "M4 12.5 9 17.5 20 6.5",
    sparkle: "M12 3v6M12 15v6M3 12h6M15 12h6",
    refresh: "M20 11a8 8 0 1 0-1.5 5M20 5v6h-6",
    alert: "M12 4 3 20h18zM12 10v4M12 17.2v.1",
    link: "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
    close: "M6 6l12 12M18 6 6 18",
  };
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={props.color || "currentColor"}
      strokeWidth={props.weight || 1.7} strokeLinecap="round" strokeLinejoin="round" style={props.style}>
      <path d={paths[props.name] || paths.grid} />
    </svg>
  );
}

/* ── helpers ── */

var BAND_STYLE = {
  none: { color: N.textT, bg: "transparent", border: N.border },
  green: { color: N.green, bg: "rgba(52,211,153,0.14)", border: "rgba(52,211,153,0.4)" },
  orange: { color: N.orange, bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.4)" },
  red: { color: N.red, bg: "rgba(255,107,107,0.14)", border: "rgba(255,107,107,0.4)" },
};

function fmtDate(iso) {
  if (!iso) return "—";
  var d = new Date(iso);
  if (isNaN(d)) return iso;
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

/** What a finished QC run changes on the list row, without refetching the board. */
function rowPatchFromRun(row, j) {
  if (!j || j.skipped) return {};
  var merged = (row.actions || []).slice();
  (j.tags || []).forEach(function (t) { if (merged.indexOf(t) < 0) merged.push(t); });
  var r = j.result || {};
  return {
    actions: merged,
    aiQc: (j.verdictLine || "") + (r.summary ? " — " + r.summary : ""),
    aiQcDate: (r.ranAt || "").slice(0, 10),
    materialsCheck: r.material ? r.material.verdict === "ok" : row.materialsCheck,
    sizechartCheck: r.sizechart ? (r.sizechart.verdict === "ok" || r.sizechart.verdict === "not_applicable") : row.sizechartCheck,
  };
}

var VERDICT = {
  ok: { label: "OK", color: N.green, bg: "rgba(52,211,153,0.13)", border: "rgba(52,211,153,0.35)" },
  mismatch: { label: "Flagged", color: N.red, bg: "rgba(255,107,107,0.13)", border: "rgba(255,107,107,0.38)" },
  unknown: { label: "No data", color: N.textT, bg: "rgba(255,255,255,0.04)", border: N.border },
  not_applicable: { label: "n/a", color: N.textT, bg: "rgba(255,255,255,0.04)", border: N.border },
};

function Pill(props) {
  var s = props.style || {};
  return (
    <span style={Object.assign({
      display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 700,
      padding: "3px 9px", borderRadius: 99, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap",
    }, s)}>{props.children}</span>
  );
}

function VerdictPill(props) {
  var v = VERDICT[props.verdict] || VERDICT.unknown;
  return <Pill style={{ color: v.color, background: v.bg, border: "1px solid " + v.border }}>{v.label}</Pill>;
}

/* ══════════════ ROOT ══════════════ */

export default function QCDashboard() {
  var [rows, setRows] = useState([]);
  var [counts, setCounts] = useState({});
  var [loading, setLoading] = useState(true);
  var [loadErr, setLoadErr] = useState("");
  var [statusFilter, setStatusFilter] = useState("In progress");
  var [openId, setOpenId] = useState(null);
  var [search, setSearch] = useState("");
  var [runState, setRunState] = useState({ running: false, done: 0, total: 0, errors: [] });

  var load = useCallback(function (fresh) {
    return fetch(API.rows + (fresh ? "?fresh=1" : ""))
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Failed to load"); return j; }); })
      .then(function (j) { setRows(j.rows || []); setCounts(j.counts || {}); setLoadErr(""); })
      .catch(function (e) { setLoadErr(String(e.message || e)); })
      .finally(function () { setLoading(false); });
  }, []);

  useEffect(function () { load(); }, [load]);

  // A full board reload is ~7 sequential Notion pages, so after a QC run or a
  // tag edit we patch the one row we already have fresh data for instead.
  var patchRow = useCallback(function (id, fields) {
    setRows(function (prev) {
      return prev.map(function (r) { return r.id === id ? Object.assign({}, r, fields) : r; });
    });
  }, []);

  var visible = useMemo(function () {
    var q = search.trim().toLowerCase();
    return rows
      .filter(function (r) { return r.status === statusFilter; })
      .filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) >= 0; });
  }, [rows, statusFilter, search]);

  // The AI runs for In-progress products where the supplier has delivered at
  // least one of: QC photos, material, size chart.
  var eligible = useMemo(function () {
    return rows.filter(function (r) { return r.status === "In progress" && r.ready; });
  }, [rows]);

  function runAll() {
    if (runState.running || eligible.length === 0) return;
    var queue = eligible.slice();
    var errors = [];
    var done = 0;
    setRunState({ running: true, done: 0, total: queue.length, errors: [] });

    function next() {
      var row = queue.shift();
      if (!row) return Promise.resolve();
      return runOne(row.id)
        .then(function (j) { patchRow(row.id, rowPatchFromRun(row, j)); })
        .catch(function (e) { errors.push(row.name + ": " + String(e.message || e)); })
        .then(function () {
          done++;
          setRunState({ running: true, done: done, total: eligible.length, errors: errors.slice() });
          return next();
        });
    }

    var workers = [];
    for (var i = 0; i < Math.min(RUN_CONCURRENCY, queue.length); i++) workers.push(next());
    Promise.all(workers).then(function () {
      setRunState({ running: false, done: done, total: eligible.length, errors: errors });
    });
  }

  function runOne(pageId) {
    return fetch(API.run, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: pageId }),
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "QC run failed"); return j; });
    });
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: N.bg, color: N.text, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexDirection: "column" }}>
        <GlobalStyles />
        <Ico name="refresh" size={26} style={{ animation: "spin 1s linear infinite", color: N.blue }} />
        <div style={{ fontSize: 12, color: N.textS, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Loading quality control board</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(1400px 620px at 20% -10%, rgba(120,150,190,0.045), transparent 65%), " + N.bg, color: N.text, fontFamily: FONT, display: "flex", alignItems: "flex-start", zoom: UI_ZOOM }}>
      <GlobalStyles />

      {/* ── LEFT RAIL ── */}
      <aside style={{
        width: 78, flexShrink: 0, position: "sticky", top: 0, height: "calc(100vh / " + UI_ZOOM + ")",
        overflowY: "auto", background: N.bgS, borderRight: "1px solid " + N.border,
        display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0 16px", gap: 6, zIndex: 5,
      }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(255,255,255,0.05)", border: "1px solid " + N.border, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
          <Ico name="check" size={19} color={N.blueText} weight={2.2} />
        </div>

        {STATUSES.map(function (s) {
          var active = statusFilter === s.key;
          return (
            <button key={s.key} className="navItem" onClick={function () { setStatusFilter(s.key); }} title={s.label}
              style={{
                width: 62, padding: "9px 0 7px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                background: active ? N.quiet.bg : "transparent",
                border: "1px solid " + (active ? N.quiet.border : "transparent"),
                color: active ? N.quiet.text : N.textT,
              }}>
              <Ico name={s.icon} size={17} weight={active ? 2 : 1.6} />
              <span style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "center", lineHeight: 1.25 }}>{s.label}</span>
              <span style={{ fontSize: 9, fontWeight: 800, color: active ? N.quiet.text : N.textT }}>{counts[s.key] != null ? counts[s.key] : ""}</span>
            </button>
          );
        })}
      </aside>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, minWidth: 0, padding: "16px 20px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>Quality control</h1>
            <div style={{ fontSize: 10, color: N.textT, marginTop: 2 }}>
              5+ sales backend {"·"} all stores {"·"} {visible.length} product{visible.length === 1 ? "" : "s"} {"·"} {statusFilter.toLowerCase()}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={search} onChange={function (e) { setSearch(e.target.value); }} placeholder="Search product"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid " + N.border, borderRadius: 99, padding: "7px 14px", fontSize: 11, outline: "none", width: 180 }} />

            <button onClick={function () { setLoading(true); load(true); }} title="Reload the board from Notion"
              style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid " + N.border, color: N.textS, fontSize: 10.5, fontWeight: 600, padding: "7px 13px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit" }}>
              <Ico name="refresh" size={13} /> Refresh
            </button>

            <button onClick={runAll} disabled={runState.running || eligible.length === 0}
              title={eligible.length === 0 ? "No In progress product has QC photos, material or a size chart yet" : eligible.length + " product(s) ready"}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: N.quiet.bg, border: "1px solid " + N.quiet.border, color: N.quiet.text,
                fontSize: 11, fontWeight: 700, padding: "8px 15px", borderRadius: 99,
                cursor: runState.running || eligible.length === 0 ? "default" : "pointer",
                fontFamily: "inherit", opacity: runState.running ? 0.75 : eligible.length === 0 ? 0.45 : 1,
              }}>
              <Ico name={runState.running ? "refresh" : "sparkle"} size={14} weight={2}
                style={runState.running ? { animation: "spin 1s linear infinite" } : null} />
              {runState.running
                ? "Running " + runState.done + "/" + runState.total + "…"
                : "Run all quality controls" + (eligible.length ? " (" + eligible.length + ")" : "")}
            </button>
          </div>
        </div>

        {runState.errors.length > 0 && !runState.running && (
          <div style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 14, padding: "10px 16px", fontSize: 10.5, color: N.red }}>
            <strong>{runState.errors.length} product(s) failed:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {runState.errors.slice(0, 6).map(function (e, i) { return <li key={i}>{e}</li>; })}
            </ul>
          </div>
        )}

        {loadErr && (
          <div style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 14, padding: "10px 16px", fontSize: 11, color: N.red }}>{loadErr}</div>
        )}

        <ProductTable rows={visible} onOpen={setOpenId} />
      </main>

      {openId && (
        <FocusView
          pageId={openId}
          onClose={function () { setOpenId(null); }}
          onPatch={patchRow}
          runOne={runOne}
        />
      )}
    </div>
  );
}

/* ══════════════ LIST ══════════════ */

function ProductTable(props) {
  if (props.rows.length === 0) {
    return (
      <div className="card" style={{ padding: "40px 20px", textAlign: "center", color: N.textT, fontSize: 12 }}>
        No products with this status.
      </div>
    );
  }
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{
        display: "grid", gridTemplateColumns: "128px 92px 1fr auto", gap: 12, padding: "10px 18px",
        background: N.bgS, borderBottom: "1px solid " + N.border,
        fontSize: 8.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: N.textT,
      }}>
        <div>Status backend</div><div>Date</div><div>Product name</div><div />
      </div>

      {props.rows.map(function (r) {
        return (
          <div key={r.id} className="rowHover" role="button" tabIndex={0}
            onClick={function () { props.onOpen(r.id); }}
            onKeyDown={function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpen(r.id); } }}
            style={{
              display: "grid", gridTemplateColumns: "128px 92px 1fr auto", gap: 12, alignItems: "center",
              padding: "11px 18px", borderBottom: "1px solid " + N.border, cursor: "pointer",
            }}>
            <div><StatusPill status={r.status} /></div>
            <div style={{ fontSize: 10.5, color: N.textS, fontVariantNumeric: "tabular-nums" }}>{fmtDate(r.date)}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
              {r.aiQc && <div style={{ fontSize: 9.5, color: N.textT, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.aiQc}</div>}
            </div>
            <div style={{ display: "flex", gap: 5, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
              {r.status === "In progress" && !r.ready && (
                <Pill style={{ color: N.textT, background: "rgba(255,255,255,0.04)", border: "1px solid " + N.border }}>Awaiting supplier</Pill>
              )}
              {r.actions.map(function (a) {
                return <Pill key={a} style={{ color: N.orange, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.32)" }}>{a}</Pill>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusPill(props) {
  var map = {
    "Not started": { color: N.red, bg: "rgba(255,107,107,0.12)", border: "rgba(255,107,107,0.33)" },
    "In progress": { color: N.orange, bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.33)" },
    Done: { color: N.green, bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.33)" },
  };
  var s = map[props.status] || map["Not started"];
  return <Pill style={{ color: s.color, background: s.bg, border: "1px solid " + s.border }}>{props.status}</Pill>;
}

/* ══════════════ FOCUS VIEW ══════════════ */

function FocusView(props) {
  var [data, setData] = useState(null);
  var [err, setErr] = useState("");
  var [busy, setBusy] = useState(false);
  var [savingTags, setSavingTags] = useState(false);

  var fetchData = useCallback(function () {
    return fetch(API.product + "?page=" + encodeURIComponent(props.pageId))
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Failed to load product"); return j; }); })
      .then(function (j) { setData(j); setErr(""); })
      .catch(function (e) { setErr(String(e.message || e)); });
  }, [props.pageId]);

  useEffect(function () { setData(null); fetchData(); }, [fetchData]);

  useEffect(function () {
    function onKey(e) { if (e.key === "Escape") props.onClose(); }
    window.addEventListener("keydown", onKey);
    return function () { window.removeEventListener("keydown", onKey); };
  });

  function runNow() {
    setBusy(true);
    var before = data && data.row;
    props.runOne(props.pageId)
      .then(function (j) {
        if (before) props.onPatch(props.pageId, rowPatchFromRun(before, j));
        return fetchData();
      })
      .catch(function (e) { setErr(String(e.message || e)); })
      .finally(function () { setBusy(false); });
  }

  function toggleTag(tag) {
    if (!data) return;
    var current = data.row.actions || [];
    var next = current.indexOf(tag) >= 0 ? current.filter(function (t) { return t !== tag; }) : current.concat([tag]);
    setData(Object.assign({}, data, { row: Object.assign({}, data.row, { actions: next }) }));
    setSavingTags(true);
    fetch(API.tags, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: props.pageId, actions: next }),
    })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Save failed"); }); })
      .then(function () { props.onPatch(props.pageId, { actions: next }); })
      .catch(function (e) { setErr(String(e.message || e)); fetchData(); })
      .finally(function () { setSavingTags(false); });
  }

  var row = data && data.row;
  var products = (data && data.products) || [];
  var primary = products[0] || null;
  var report = data && data.report;

  var sellingPrice = (row && row.sellingPrice) || (primary && primary.price) || null;
  var cj = parsePrice(row && row.cj);
  var wiioOld = parsePrice(row && row.wiioOld);
  var wiioNew = parsePrice(row && row.wiioNew);
  var cogPct = calcCog(wiioNew, sellingPrice);
  var band = BAND_STYLE[calcBand(cogPct)];
  // Whichever of CJ / WIIO new is cheaper is the offer we should be buying at.
  var cheaper = cj && wiioNew ? (cj.value <= wiioNew.value ? "cj" : "wiio") : cj ? "cj" : wiioNew ? "wiio" : null;

  return (
    <div onClick={function (e) { if (e.target === e.currentTarget) props.onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(6,7,9,0.72)", backdropFilter: "blur(3px)",
        zIndex: 50, display: "flex", justifyContent: "center", alignItems: "flex-start", overflowY: "auto", padding: "24px 16px",
      }}>
      <div className="card" style={{ width: "min(1180px, 100%)", padding: 0, animation: "riseIn .18s ease", overflow: "hidden" }}>

        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid " + N.border, background: N.bgS }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {(primary && primary.title) || (row && row.name) || "Loading…"}
            </div>
            <div style={{ fontSize: 9.5, color: N.textT, marginTop: 2 }}>
              {row ? row.status + " · " + fmtDate(row.date) : ""}
              {row && row.aiQcDate ? " · last QC " + fmtDate(row.aiQcDate) : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={runNow} disabled={busy || !data}
              style={{
                display: "flex", alignItems: "center", gap: 6, background: N.quiet.bg, border: "1px solid " + N.quiet.border,
                color: N.quiet.text, fontSize: 10.5, fontWeight: 700, padding: "7px 14px", borderRadius: 99,
                cursor: busy ? "default" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1,
              }}>
              <Ico name={busy ? "refresh" : "sparkle"} size={13} weight={2} style={busy ? { animation: "spin 1s linear infinite" } : null} />
              {busy ? "Running…" : "Run quality control"}
            </button>
            <button onClick={props.onClose}
              style={{ background: "transparent", border: "1px solid " + N.border, color: N.textS, fontSize: 10, fontWeight: 600, padding: "6px 11px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit" }}>
              Esc
            </button>
          </div>
        </div>

        {err && <div style={{ padding: "10px 20px", fontSize: 11, color: N.red, background: "rgba(255,107,107,0.07)" }}>{err}</div>}

        {!data && !err && (
          <div style={{ padding: 60, textAlign: "center", color: N.textT }}>
            <Ico name="refresh" size={22} style={{ animation: "spin 1s linear infinite" }} />
          </div>
        )}

        {data && (
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ── images ── */}
            <Section title="Product & factory photos">
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", overflowX: "auto", paddingBottom: 4 }}>
                <Figure url={primary && primary.mainImage} label="Live listing" big />
                {(data.qcImages || []).map(function (u, i) {
                  return <Figure key={u + i} url={u} label={"QC photo " + (i + 1)} />;
                })}
                {(data.qcImages || []).length === 0 && (
                  <div style={{ fontSize: 11, color: N.textT, alignSelf: "center" }}>No 图片 QC photos delivered yet.</div>
                )}
              </div>
            </Section>

            {/* ── links & ids ── */}
            <Section title="Links">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <LinkChip href={row.competitor} label="Competitor" />
                {products.map(function (p) {
                  return <LinkChip key={p.storeKey + "-admin"} href={p.adminUrl} label={"Shopify Admin · " + p.store} />;
                })}
                {products.map(function (p) {
                  return <LinkChip key={p.storeKey + "-live"} href={p.liveUrl} label={"Live page · " + p.store} />;
                })}
                {products.length === 0 && <LinkChip href={row.productLink} label="Live page" />}
                <LinkChip href={row.notionUrl} label="Open in Notion" />
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <IdChip label="Clarendale ID" value={row.idClarendale} />
                <IdChip label="Lark & Clover ID" value={row.idLark} />
                {row.idLume ? <IdChip label="Lume Haven ID" value={row.idLume} /> : null}
              </div>

              {(data.storeErrors || []).length > 0 && (
                <div style={{ fontSize: 9.5, color: N.orange, marginTop: 8 }}>
                  {data.storeErrors.join(" · ")}
                </div>
              )}
            </Section>

            {/* ── prices ── */}
            <Section title="Cost of goods">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
                <PriceTile label="CJ price" raw={row.cj} highlight={cheaper === "cj"} />
                <PriceTile label="WIIO old" raw={row.wiioOld} />
                <PriceTile label="WIIO new" raw={row.wiioNew} highlight={cheaper === "wiio"} />
                <div style={{
                  minWidth: 150, padding: "10px 14px", borderRadius: 14,
                  background: band.bg, border: "1px solid " + band.border,
                }}>
                  <div style={{ fontSize: 8, color: N.textT, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>New COG %</div>
                  <div style={{ fontSize: 21, fontWeight: 800, color: band.color, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                    {cogPct != null ? cogPct.toFixed(1) + "%" : "—"}
                  </div>
                  <div style={{ fontSize: 9, color: N.textT, marginTop: 2 }}>
                    {wiioNew && sellingPrice
                      ? "$" + wiioNew.value.toFixed(2) + (wiioNew.qty > 1 ? " (" + wiioNew.qty + "pcs)" : "") + " ÷ $" + Number(sellingPrice).toFixed(2)
                      : !wiioNew ? "No WIIO new price yet" : "No selling price"}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 9, color: N.textT, marginTop: 8 }}>
                Selling price {sellingPrice ? "$" + Number(sellingPrice).toFixed(2) : "unknown"}
                {primary && primary.price && row.sellingPrice && Number(primary.price) !== Number(row.sellingPrice)
                  ? " (Notion) · $" + Number(primary.price).toFixed(2) + " live on " + primary.store
                  : ""}
                {" · "}Green under 28% {"·"} orange 28–29.9% {"·"} red 30%+
              </div>
            </Section>

            {/* ── AI recommendation ── */}
            <Section title="AI recommendation">
              {!report && (
                <div style={{ fontSize: 11, color: N.textT }}>
                  No quality control has run for this product yet. Press <strong style={{ color: N.textS }}>Run quality control</strong> above.
                </div>
              )}
              {report && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {report.summary && (
                    <div style={{ fontSize: 11.5, lineHeight: 1.55, color: N.text, background: "rgba(76,141,246,0.07)", border: "1px solid " + N.quiet.border, borderRadius: 12, padding: "10px 14px" }}>
                      {report.summary}
                    </div>
                  )}
                  <CheckBlock title="Material" check={report.material} extra={
                    report.material && (report.material.listingClaim || report.material.supplierSays) ? (
                      <div style={{ fontSize: 10, color: N.textT, marginTop: 4 }}>
                        {report.material.listingClaim ? <div>Page says: {report.material.listingClaim}</div> : null}
                        {report.material.supplierSays ? <div>Supplier says: {report.material.supplierSays}</div> : null}
                      </div>
                    ) : null
                  } />
                  <CheckBlock title="Product images" check={report.images} />
                  <CheckBlock title="Functionality" check={report.functionality} />
                  <SizechartBlock check={report.sizechart} pageId={props.pageId} />
                </div>
              )}
            </Section>

            {/* ── supplier fields ── */}
            <Section title="Supplier input">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <Field label="面料 Material" value={row.material} />
                <Field label="反馈 Feedback" value={row.feedback} />
                <Field label="Remark" value={row.remark} />
              </div>
              {(data.supplierSizeCharts || []).length > 0 && (
                <div style={{ display: "flex", gap: 10, marginTop: 10, overflowX: "auto" }}>
                  {data.supplierSizeCharts.map(function (u, i) {
                    return <Figure key={u + i} url={u} label={"尺码表 Size " + (i + 1)} />;
                  })}
                </div>
              )}
            </Section>

            {/* ── tags ── */}
            <Section title={"Listing actions" + (savingTags ? " · saving…" : "")}>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {LISTING_ACTIONS.map(function (a) {
                  var on = (row.actions || []).indexOf(a) >= 0;
                  var danger = a === "Discontinue";
                  return (
                    <button key={a} onClick={function () { toggleTag(a); }}
                      style={{
                        fontSize: 10, fontWeight: 700, padding: "6px 13px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit",
                        background: on ? (danger ? "rgba(255,107,107,0.16)" : "rgba(251,191,36,0.16)") : "rgba(255,255,255,0.03)",
                        border: "1px solid " + (on ? (danger ? "rgba(255,107,107,0.45)" : "rgba(251,191,36,0.42)") : N.border),
                        color: on ? (danger ? N.red : N.orange) : N.textT,
                      }}>
                      {a}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 9, color: N.textT, marginTop: 8 }}>
                Tags sync straight to the Notion "Listing actions" column. The AI sets a tag when it flags a check; it never removes one you set by hand, and never sets Discontinue.
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── focus-view building blocks ── */

function Section(props) {
  return (
    <div>
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: N.textT, marginBottom: 8 }}>{props.title}</div>
      <div style={{ background: N.card2, border: "1px solid " + N.border, borderRadius: 14, padding: 14 }}>{props.children}</div>
    </div>
  );
}

function Figure(props) {
  var size = props.big ? 190 : 130;
  return (
    <figure style={{ margin: 0, flexShrink: 0, width: size }}>
      {props.url ? (
        <a href={props.url} target="_blank" rel="noreferrer">
          <img src={props.url} alt={props.label} loading="lazy"
            style={{ width: size, height: size, objectFit: "cover", borderRadius: 12, border: "1px solid " + N.border, display: "block", background: N.bg }} />
        </a>
      ) : (
        <div style={{ width: size, height: size, borderRadius: 12, border: "1px dashed " + N.border, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: N.textT }}>
          no image
        </div>
      )}
      <figcaption style={{ fontSize: 8.5, color: N.textT, marginTop: 5, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>{props.label}</figcaption>
    </figure>
  );
}

function LinkChip(props) {
  var on = !!props.href;
  var style = {
    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 600,
    padding: "6px 12px", borderRadius: 99, textDecoration: "none",
    border: "1px solid " + (on ? N.borderS : N.border),
    background: on ? "rgba(255,255,255,0.04)" : "transparent",
    color: on ? N.text : N.textT,
    cursor: on ? "pointer" : "not-allowed",
  };
  if (!on) return <span style={style} title="Not available for this product"><Ico name="link" size={11} />{props.label}</span>;
  return <a href={props.href} target="_blank" rel="noreferrer" style={style}><Ico name="link" size={11} />{props.label}</a>;
}

function IdChip(props) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, padding: "5px 11px", borderRadius: 99,
      border: "1px solid " + N.border, color: N.textT, fontVariantNumeric: "tabular-nums",
    }}>
      <span style={{ fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 8.5 }}>{props.label}</span>
      {props.value != null ? String(props.value) : "—"}
    </span>
  );
}

function PriceTile(props) {
  var p = parsePrice(props.raw);
  return (
    <div style={{
      minWidth: 150, padding: "10px 14px", borderRadius: 14,
      background: props.highlight ? "rgba(76,141,246,0.12)" : "rgba(255,255,255,0.025)",
      border: "1px solid " + (props.highlight ? N.quiet.border : N.border),
    }}>
      <div style={{ fontSize: 8, color: N.textT, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>{props.label}</div>
      <div style={{
        fontSize: 18, fontWeight: 800, marginTop: 2, fontVariantNumeric: "tabular-nums",
        color: props.highlight ? N.blueText : N.textS,
      }}>
        {p ? "$" + p.value.toFixed(2) : "—"}
        {p && p.qty > 1 ? <span style={{ fontSize: 10, fontWeight: 600, color: N.textT }}> /{p.qty}pcs</span> : null}
      </div>
      <div style={{ fontSize: 9, color: N.textT, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={props.raw || ""}>
        {props.raw || "not filled in"}
      </div>
    </div>
  );
}

function Field(props) {
  return (
    <div>
      <div style={{ fontSize: 8.5, color: N.textT, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 3 }}>{props.label}</div>
      <div style={{ fontSize: 11, color: props.value ? N.text : N.textT, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{props.value || "—"}</div>
    </div>
  );
}

function CheckBlock(props) {
  var c = props.check || { verdict: "unknown", detail: "Not checked.", discrepancies: [] };
  return (
    <div style={{ borderTop: "1px solid " + N.border, paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>{props.title}</span>
        <VerdictPill verdict={c.verdict} />
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.55, color: N.textS }}>{c.detail || "—"}</div>
      {(c.discrepancies || []).length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 10.5, color: N.text, lineHeight: 1.6 }}>
          {c.discrepancies.map(function (d, i) { return <li key={i}>{d}</li>; })}
        </ul>
      )}
      {props.extra}
    </div>
  );
}

function SizechartBlock(props) {
  var c = props.check || { verdict: "unknown", detail: "Not checked." };
  var [showHtml, setShowHtml] = useState(false);
  var url = API.sizechart + "?page=" + encodeURIComponent(props.pageId);
  return (
    <div style={{ borderTop: "1px solid " + N.border, paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>Size chart</span>
        <VerdictPill verdict={c.verdict} />
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.55, color: N.textS }}>{c.detail || "—"}</div>

      {(c.missingSizes || []).length > 0 && (
        <div style={{ fontSize: 10.5, color: N.red, marginTop: 6 }}>Missing sizes: {c.missingSizes.join(", ")}</div>
      )}
      {(c.differences || []).length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 10.5, color: N.text, lineHeight: 1.6 }}>
          {c.differences.map(function (d, i) { return <li key={i}>{d}</li>; })}
        </ul>
      )}

      {c.needsHtmlChange && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <a href={url} target="_blank" rel="noreferrer"
            style={{ fontSize: 10, fontWeight: 700, padding: "6px 12px", borderRadius: 99, textDecoration: "none", background: N.quiet.bg, border: "1px solid " + N.quiet.border, color: N.quiet.text }}>
            Open corrected size chart
          </a>
          <a href={url + "&raw=1"} target="_blank" rel="noreferrer"
            style={{ fontSize: 10, fontWeight: 600, padding: "6px 12px", borderRadius: 99, textDecoration: "none", border: "1px solid " + N.border, color: N.textS }}>
            Raw HTML for Shopify
          </a>
          <button onClick={function () { setShowHtml(!showHtml); }}
            style={{ fontSize: 10, fontWeight: 600, padding: "6px 12px", borderRadius: 99, background: "transparent", border: "1px solid " + N.border, color: N.textS, cursor: "pointer", fontFamily: "inherit" }}>
            {showHtml ? "Hide preview" : "Preview here"}
          </button>
          <span style={{ fontSize: 9, color: N.textT }}>Also linked in Notion under "Updated sizechart".</span>
        </div>
      )}

      {showHtml && c.correctedHtml && (
        <div className="chartHtml" style={{ marginTop: 10, background: "rgba(255,255,255,0.03)", border: "1px solid " + N.border, borderRadius: 12, padding: 12, overflowX: "auto" }}
          dangerouslySetInnerHTML={{ __html: c.correctedHtml }} />
      )}
    </div>
  );
}
