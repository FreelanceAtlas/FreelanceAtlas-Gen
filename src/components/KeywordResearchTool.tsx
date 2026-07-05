"use client";

import { useState, useMemo } from "react";
import type { ScoredKeyword, SeedCategories, KeywordTier } from "@/app/api/keywords/research-engine/route";

interface Cluster { id: string; name: string; }
interface BaseKw {
  keyword: string; volume: number | null; difficulty: number | null;
  cpc: number | null; competition: number | null; trend: unknown[]; search_intent: string | null;
}
type AnyKw = BaseKw | ScoredKeyword;
type Mode = "related" | "ideas" | "engine";
type SortCol = "keyword" | "volume" | "difficulty" | "cpc" | "opportunity";
type SortDir = "asc" | "desc";

const INTENT_STYLES: Record<string, string> = {
  informational: "bg-blue-50 text-blue-700",
  commercial: "bg-orange-50 text-orange-700",
  transactional: "bg-green-50 text-green-700",
  navigational: "bg-gray-100 text-gray-500",
};

const TIER_META: Record<KeywordTier, { label: string; header: string; badge: string }> = {
  recommended: { label: "Most recommended", header: "bg-green-50 border-green-200",  badge: "bg-green-100 text-green-700" },
  related:     { label: "Related",          header: "bg-atlasteal/5 border-atlasteal/20", badge: "bg-atlasteal/10 text-atlasteal" },
  check:       { label: "Check before adding", header: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-700" },
};

const OPP_COLOR = (s: number) =>
  s >= 200 ? "text-green-600 font-bold" : s >= 80 ? "text-amber-600 font-semibold" : "text-atlasnavy/40";
const KD_COLOR = (kd: number | null) =>
  kd === null ? "text-atlasnavy/30" : kd >= 70 ? "text-red-600 font-semibold" : kd >= 40 ? "text-amber-600 font-semibold" : "text-green-600 font-semibold";

function fmtVol(v: number | null) {
  if (v === null) return "–";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}
function fmtCpc(v: number | null) { return v === null ? "–" : `$${v.toFixed(2)}`; }
function isScored(k: AnyKw): k is ScoredKeyword { return "opportunity" in k; }

const PHASES = [
  "Generating seed phrases…",
  "Round 1: expanding keyword space…",
  "Round 2: going deeper…",
  "Scoring intent, audience fit & clusters…",
  "Ranking by opportunity…",
];

const CATEGORY_META = [
  { key: "core",     label: "Core",     color: "bg-atlasteal/10 text-atlasteal" },
  { key: "adjacent", label: "Adjacent",  color: "bg-orange-50 text-orange-600" },
  { key: "problem",  label: "Problem",   color: "bg-purple-50 text-purple-600" },
] as const;

export default function KeywordResearchTool({ clusters }: { clusters: Cluster[] }) {
  const [seed, setSeed] = useState("");
  const [mode, setMode] = useState<Mode>("related");
  const [results, setResults] = useState<AnyKw[]>([]);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveClusterId, setSaveClusterId] = useState(clusters[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("volume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [lastSeed, setLastSeed] = useState("");
  const [engineMeta, setEngineMeta] = useState<{ seedCategories: SeedCategories; totalScanned: number } | null>(null);
  const [intentFilter, setIntentFilter] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<KeywordTier | null>(null);
  // Collapsible tier sections in engine mode
  const [openTiers, setOpenTiers] = useState<Record<KeywordTier, boolean>>({ recommended: true, related: true, check: false });

  const filtered = useMemo(() => results.filter((k) => {
    if (intentFilter && isScored(k) && k.intent !== intentFilter) return false;
    if (tierFilter && isScored(k) && k.tier !== tierFilter) return false;
    return true;
  }), [results, intentFilter, tierFilter]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let av: string | number | null, bv: string | number | null;
    switch (sortCol) {
      case "keyword":     av = a.keyword;     bv = b.keyword; break;
      case "volume":      av = a.volume;      bv = b.volume; break;
      case "difficulty":  av = a.difficulty;  bv = b.difficulty; break;
      case "cpc":         av = a.cpc;         bv = b.cpc; break;
      case "opportunity": av = isScored(a) ? a.opportunity : null; bv = isScored(b) ? b.opportunity : null; break;
      default:            av = a.volume;      bv = b.volume;
    }
    if (av === null) return 1; if (bv === null) return -1;
    if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
  }), [filtered, sortCol, sortDir]);

  // Group engine results by tier (preserving sort within each tier)
  const byTier = useMemo(() => ({
    recommended: sorted.filter((k) => isScored(k) && k.tier === "recommended") as ScoredKeyword[],
    related:     sorted.filter((k) => isScored(k) && k.tier === "related")     as ScoredKeyword[],
    check:       sorted.filter((k) => isScored(k) && k.tier === "check")       as ScoredKeyword[],
  }), [sorted]);

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir(col === "keyword" ? "asc" : "desc"); }
  }
  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <span className="ml-0.5 opacity-25">↕</span>;
    return <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function startPhaseLoop(): () => void {
    let i = 0; setPhase(0);
    const id = setInterval(() => { i = Math.min(i + 1, PHASES.length - 1); setPhase(i); }, 4500);
    return () => clearInterval(id);
  }

  async function search() {
    const s = seed.trim(); if (!s) return;
    setLoading(true); setError(null); setResults([]); setSelected(new Set());
    setSavedMsg(null); setLastSeed(s); setEngineMeta(null); setIntentFilter(null); setTierFilter(null);
    let stopPhases = () => {};
    if (mode === "engine") stopPhases = startPhaseLoop();
    try {
      if (mode === "engine") {
        const res = await fetch("/api/keywords/research-engine", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic: s, clusterId: saveClusterId || clusters[0]?.id, limit: 40 }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "Engine failed"); return; }
        setResults(data.results ?? []);
        setEngineMeta({ seedCategories: data.seedCategories ?? { core: [], adjacent: [], problem: [] }, totalScanned: data.totalScanned ?? 0 });
        setSortCol("opportunity"); setSortDir("desc");
        setOpenTiers({ recommended: true, related: true, check: false });
      } else {
        const res = await fetch("/api/keywords/research", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ seed: s, clusterId: saveClusterId || clusters[0]?.id, mode, limit: 50, save: false }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "Research failed"); return; }
        setResults(data.results ?? []); setSortCol("volume"); setSortDir("desc");
      }
    } catch { setError("Request failed"); }
    finally { stopPhases(); setLoading(false); }
  }

  function toggleAll() {
    if (selected.size === sorted.length && sorted.length > 0) setSelected(new Set());
    else setSelected(new Set(sorted.map((k) => k.keyword)));
  }
  function toggle(kw: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(kw)) next.delete(kw); else next.add(kw); return next; });
  }

  async function saveSelected() {
    if (!selected.size || !saveClusterId) return;
    setSaving(true); setSavedMsg(null);
    const toSave = results.filter((r) => selected.has(r.keyword));
    try {
      const res = await fetch("/api/keywords/save", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ clusterId: saveClusterId, keywords: toSave }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Save failed"); return; }
      setSavedMsg(`✓ Saved ${data.saved}`); setSelected(new Set());
    } catch { setError("Save failed"); }
    finally { setSaving(false); }
  }

  const th = "cursor-pointer select-none px-3 py-3 text-xs font-semibold uppercase tracking-wide text-atlasnavy/40 hover:text-atlasnavy";

  // Render a tier section for engine mode
  function TierSection({ tier, rows }: { tier: KeywordTier; rows: ScoredKeyword[] }) {
    if (rows.length === 0) return null;
    const meta = TIER_META[tier];
    const open = openTiers[tier];
    const selectedInTier = rows.filter((k) => selected.has(k.keyword)).length;
    return (
      <>
        {/* Tier header row */}
        <tr
          className={`cursor-pointer border-t-2 ${meta.header}`}
          onClick={() => setOpenTiers((prev) => ({ ...prev, [tier]: !prev[tier] }))}
        >
          <td colSpan={9} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>{meta.label}</span>
              <span className="text-xs text-atlasnavy/50">{rows.length} keyword{rows.length !== 1 ? "s" : ""}</span>
              {selectedInTier > 0 && <span className="text-xs font-semibold text-atlasteal">{selectedInTier} selected</span>}
              <span className="ml-auto text-[10px] text-atlasnavy/30">{open ? "▲" : "▼"}</span>
            </div>
          </td>
        </tr>
        {/* Keyword rows */}
        {open && rows.map((kw) => (
          <tr key={kw.keyword} onClick={() => toggle(kw.keyword)}
            className={`cursor-pointer transition-colors hover:bg-atlasteal/5 ${selected.has(kw.keyword) ? "bg-atlasteal/10" : ""}`}>
            <td className="px-3 py-2.5">
              <input type="checkbox" checked={selected.has(kw.keyword)}
                onChange={() => toggle(kw.keyword)} onClick={(e) => e.stopPropagation()} className="rounded" />
            </td>
            <td className="px-3 py-2.5 font-medium text-atlasnavy">{kw.keyword}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-atlasnavy/70">
              {fmtVol(kw.volume)}<span className="text-atlasnavy/30">/mo</span>
            </td>
            <td className={`px-3 py-2.5 text-right tabular-nums ${KD_COLOR(kw.difficulty)}`}>{kw.difficulty ?? "–"}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-atlasnavy/70">{fmtCpc(kw.cpc)}</td>
            <td className={`px-3 py-2.5 text-right tabular-nums ${OPP_COLOR(kw.opportunity)}`}>{kw.opportunity}</td>
            <td className="px-3 py-2.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${INTENT_STYLES[kw.intent] ?? "bg-gray-100 text-gray-500"}`}>
                {kw.intent}
              </span>
            </td>
            <td className={`px-3 py-2.5 text-center text-xs font-bold ${kw.audience_fit >= 4 ? "text-green-600" : kw.audience_fit >= 3 ? "text-amber-600" : "text-atlasnavy/30"}`}>
              {kw.audience_fit}/5
            </td>
            <td className="px-3 py-2.5">
              <span className="rounded-full bg-atlasnavy/8 px-2 py-0.5 text-[10px] text-atlasnavy/60">{kw.cluster}</span>
            </td>
          </tr>
        ))}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <input value={seed} onChange={(e) => setSeed(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder={mode === "engine" ? "e.g. freelance invoicing, scope of work…" : "e.g. scope of work…"}
          className="flex-1 rounded-md border border-atlasnavy/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-atlasteal/30" />
        <div className="flex rounded-md border border-atlasnavy/20 overflow-hidden text-sm">
          {(["related", "ideas", "engine"] as Mode[]).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`px-3 py-2 capitalize transition-colors ${mode === m ? "bg-atlasteal text-white font-semibold" : "text-atlasnavy/60 hover:bg-atlasnavy/5"}`}>
              {m === "engine" ? "⚡ Engine" : m === "related" ? "Related" : "Ideas"}
            </button>
          ))}
        </div>
        <button onClick={search} disabled={loading || !seed.trim()}
          className="rounded-md bg-atlasteal px-5 py-2 text-sm font-semibold text-white hover:bg-atlasteal/90 disabled:opacity-50">
          {loading ? (mode === "engine" ? "Running…" : "Searching…") : "Search"}
        </button>
      </div>

      {/* Engine description */}
      {mode === "engine" && !loading && results.length === 0 && !lastSeed && (
        <div className="rounded-lg border border-atlasteal/20 bg-atlasteal/5 px-4 py-3 text-sm">
          <p className="font-semibold text-atlasnavy">⚡ Autonomous Engine</p>
          <p className="mt-1 text-xs text-atlasnavy/70 leading-relaxed">
            Generates <span className="font-medium text-atlasteal">Core</span>, <span className="font-medium text-orange-600">Adjacent</span>, and <span className="font-medium text-purple-600">Problem</span> seeds → 2 rounds of DataForSEO expansion → Claude scores intent &amp; freelancer relevance → segments into <span className="font-medium text-green-700">Most recommended</span>, <span className="font-medium text-atlasteal">Related</span>, and <span className="font-medium text-amber-700">Check before adding</span>.
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && mode === "engine" && (
        <div className="rounded-lg border border-atlasteal/20 bg-atlasteal/5 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-atlasteal border-t-transparent" />
            <span className="text-sm font-medium text-atlasteal">{PHASES[phase]}</span>
          </div>
          <div className="mt-3 flex gap-1">
            {PHASES.map((_, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-colors duration-700 ${i <= phase ? "bg-atlasteal" : "bg-atlasnavy/10"}`} />
            ))}
          </div>
        </div>
      )}
      {loading && mode !== "engine" && <p className="text-sm text-atlasnavy/50">Searching for “{seed}”…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {results.length > 0 && (
        <>
          {/* Seed categories */}
          {engineMeta && (
            <div className="rounded-lg border border-atlasnavy/10 bg-atlasnavy/[0.02] px-4 py-3 text-xs">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="font-semibold text-atlasnavy/40 uppercase tracking-wide text-[10px]">Seeds explored</span>
                <span className="text-atlasnavy/30">· {engineMeta.totalScanned} keywords scanned</span>
              </div>
              <div className="space-y-1.5">
                {CATEGORY_META.map(({ key, label, color }) => {
                  const phrases = engineMeta.seedCategories[key as keyof SeedCategories] ?? [];
                  if (phrases.length === 0) return null;
                  return (
                    <div key={key} className="flex items-start gap-2">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${color}`}>{label}</span>
                      <div className="flex flex-wrap gap-1">
                        {phrases.map((p) => <span key={p} className="rounded bg-atlasnavy/5 px-1.5 py-0.5 text-atlasnavy/60">{p}</span>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Intent filter (engine) */}
          {mode === "engine" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-atlasnavy/40">Intent:</span>
              {["informational", "commercial", "transactional", "navigational"].map((intent) => (
                <button key={intent} type="button"
                  onClick={() => setIntentFilter(intentFilter === intent ? null : intent)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-colors ${
                    intentFilter === intent
                      ? (INTENT_STYLES[intent] ?? "") + " ring-1 ring-current"
                      : (INTENT_STYLES[intent] ?? "") + " opacity-60 hover:opacity-100"
                  }`}>{intent}</button>
              ))}
              {intentFilter && (
                <button type="button" onClick={() => setIntentFilter(null)}
                  className="ml-1 text-xs text-atlasnavy/40 hover:text-atlasnavy">Clear</button>
              )}
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center gap-3 rounded-lg border border-atlasnavy/10 bg-atlasnavy/[0.02] px-4 py-2.5">
            <span className="text-xs text-atlasnavy/50">{sorted.length} keyword{sorted.length !== 1 ? "s" : ""} — “{lastSeed}”</span>
            <div className="flex-1" />
            {savedMsg && <span className="text-xs font-medium text-green-600">{savedMsg}</span>}
            <select value={saveClusterId} onChange={(e) => setSaveClusterId(e.target.value)}
              className="rounded-md border border-atlasnavy/20 px-2 py-1 text-xs">
              {clusters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={saveSelected} disabled={saving || selected.size === 0}
              className="rounded-md bg-atlasteal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              {saving ? "Saving…" : selected.size > 0 ? `Save ${selected.size}` : "Save selected"}
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-atlasnavy/10 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-atlasnavy/10 bg-atlasnavy/[0.02]">
                <tr>
                  <th className="w-9 px-3 py-3">
                    <input type="checkbox" checked={selected.size === sorted.length && sorted.length > 0} onChange={toggleAll} className="rounded" />
                  </th>
                  <th className={`${th} text-left`} onClick={() => toggleSort("keyword")}>Keyword <SortIcon col="keyword" /></th>
                  <th className={`${th} text-right`} onClick={() => toggleSort("volume")}>Volume <SortIcon col="volume" /></th>
                  <th className={`${th} text-right`} onClick={() => toggleSort("difficulty")}>KD <SortIcon col="difficulty" /></th>
                  <th className={`${th} text-right`} onClick={() => toggleSort("cpc")}>CPC <SortIcon col="cpc" /></th>
                  {mode === "engine" && (
                    <>
                      <th className={`${th} text-right`} onClick={() => toggleSort("opportunity")}>Opp ⚡ <SortIcon col="opportunity" /></th>
                      <th className={`${th} text-left`}>Intent</th>
                      <th className={`${th} text-center`}>Fit</th>
                      <th className={`${th} text-left`}>Cluster</th>
                    </>
                  )}
                  {mode !== "engine" && <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-atlasnavy/40">Intent</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-atlasnavy/5">
                {mode === "engine" ? (
                  <>
                    <TierSection tier="recommended" rows={byTier.recommended} />
                    <TierSection tier="related" rows={byTier.related} />
                    <TierSection tier="check" rows={byTier.check} />
                  </>
                ) : (
                  sorted.map((kw) => (
                    <tr key={kw.keyword} onClick={() => toggle(kw.keyword)}
                      className={`cursor-pointer transition-colors hover:bg-atlasteal/5 ${selected.has(kw.keyword) ? "bg-atlasteal/10" : ""}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={selected.has(kw.keyword)}
                          onChange={() => toggle(kw.keyword)} onClick={(e) => e.stopPropagation()} className="rounded" />
                      </td>
                      <td className="px-3 py-2.5 font-medium text-atlasnavy">{kw.keyword}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-atlasnavy/70">{fmtVol(kw.volume)}<span className="text-atlasnavy/30">/mo</span></td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${KD_COLOR(kw.difficulty)}`}>{kw.difficulty ?? "–"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-atlasnavy/70">{fmtCpc(kw.cpc)}</td>
                      <td className="px-3 py-2.5">
                        {kw.search_intent && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${INTENT_STYLES[kw.search_intent] ?? "bg-gray-100 text-gray-500"}`}>
                            {kw.search_intent}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && results.length === 0 && lastSeed && !error && (
        <p className="text-sm text-atlasnavy/50">No results — try a different topic or switch mode.</p>
      )}
    </div>
  );
}
