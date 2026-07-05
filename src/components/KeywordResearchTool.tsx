"use client";

import { useState, useMemo } from "react";

interface Cluster { id: string; name: string; }
interface KwResult {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: { year: number; month: number; search_volume: number }[];
  search_intent: string | null;
}

type SortCol = "keyword" | "volume" | "difficulty" | "cpc";
type SortDir = "asc" | "desc";

function kdClass(kd: number | null) {
  if (kd === null) return "text-atlasnavy/30";
  if (kd >= 70) return "text-red-600 font-semibold";
  if (kd >= 40) return "text-amber-600 font-semibold";
  return "text-green-600 font-semibold";
}

function fmtVol(v: number | null) {
  if (v === null) return "–";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function fmtCpc(v: number | null) {
  if (v === null) return "–";
  return `$${v.toFixed(2)}`;
}

export default function KeywordResearchTool({ clusters }: { clusters: Cluster[] }) {
  const [seed, setSeed] = useState("");
  const [mode, setMode] = useState<"related" | "ideas">("related");
  const [results, setResults] = useState<KwResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveClusterId, setSaveClusterId] = useState(clusters[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("volume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [lastSeed, setLastSeed] = useState("");

  const sorted = useMemo(() => {
    return [...results].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [results, sortCol, sortDir]);

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <span className="ml-0.5 text-atlasnavy/20">↕</span>;
    return <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  async function search() {
    const s = seed.trim();
    if (!s) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setSelected(new Set());
    setSavedMsg(null);
    setLastSeed(s);
    try {
      const res = await fetch("/api/keywords/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seed: s,
          clusterId: saveClusterId || (clusters[0]?.id ?? ""),
          mode,
          limit: 50,
          save: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Research failed"); return; }
      setResults(data.results ?? []);
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleAll() {
    if (selected.size === sorted.length && sorted.length > 0) setSelected(new Set());
    else setSelected(new Set(sorted.map((k) => k.keyword)));
  }

  function toggle(kw: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw); else next.add(kw);
      return next;
    });
  }

  async function saveSelected() {
    if (!selected.size || !saveClusterId) return;
    setSaving(true);
    setSavedMsg(null);
    const toSave = results.filter((r) => selected.has(r.keyword));
    try {
      const res = await fetch("/api/keywords/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clusterId: saveClusterId, keywords: toSave }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Save failed"); return; }
      setSavedMsg(`✓ Saved ${data.saved} keyword${data.saved !== 1 ? "s" : ""}`);
      setSelected(new Set());
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  const thClass = "cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-wide text-atlasnavy/50 hover:text-atlasnavy";

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="e.g. scope of work, freelance invoicing…"
          className="flex-1 rounded-md border border-atlasnavy/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-atlasteal/30"
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "related" | "ideas")}
          className="rounded-md border border-atlasnavy/20 px-3 py-2 text-sm"
        >
          <option value="related">Related keywords</option>
          <option value="ideas">Keyword ideas</option>
        </select>
        <button
          onClick={search}
          disabled={loading || !seed.trim()}
          className="rounded-md bg-atlasteal px-5 py-2 text-sm font-semibold text-white hover:bg-atlasteal/90 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {results.length > 0 && (
        <>
          {/* Action bar */}
          <div className="flex items-center gap-3 rounded-lg border border-atlasnavy/10 bg-atlasnavy/[0.02] px-4 py-2.5">
            <span className="text-xs text-atlasnavy/50">
              {results.length} results for “{lastSeed}”
            </span>
            <div className="flex-1" />
            {savedMsg && <span className="text-xs font-medium text-green-600">{savedMsg}</span>}
            <select
              value={saveClusterId}
              onChange={(e) => setSaveClusterId(e.target.value)}
              className="rounded-md border border-atlasnavy/20 px-2 py-1 text-xs"
            >
              {clusters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={saveSelected}
              disabled={saving || selected.size === 0}
              className="rounded-md bg-atlasteal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : selected.size > 0 ? `Save ${selected.size} to cluster` : "Save selected"}
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-atlasnavy/10 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-atlasnavy/10 bg-atlasnavy/[0.02]">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.size === sorted.length && sorted.length > 0}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className={`${thClass} text-left`} onClick={() => toggleSort("keyword")}>
                    Keyword <SortIcon col="keyword" />
                  </th>
                  <th className={`${thClass} text-right`} onClick={() => toggleSort("volume")}>
                    Volume <SortIcon col="volume" />
                  </th>
                  <th className={`${thClass} text-right`} onClick={() => toggleSort("difficulty")}>
                    KD <SortIcon col="difficulty" />
                  </th>
                  <th className={`${thClass} text-right`} onClick={() => toggleSort("cpc")}>
                    CPC <SortIcon col="cpc" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-atlasnavy/50">
                    Intent
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-atlasnavy/5">
                {sorted.map((kw) => (
                  <tr
                    key={kw.keyword}
                    onClick={() => toggle(kw.keyword)}
                    className={`cursor-pointer transition-colors hover:bg-atlasteal/5 ${
                      selected.has(kw.keyword) ? "bg-atlasteal/10" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(kw.keyword)}
                        onChange={() => toggle(kw.keyword)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-atlasnavy">{kw.keyword}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-atlasnavy/70">
                      {fmtVol(kw.volume)}<span className="text-atlasnavy/30">/mo</span>
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${kdClass(kw.difficulty)}`}>
                      {kw.difficulty ?? "–"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-atlasnavy/70">
                      {fmtCpc(kw.cpc)}
                    </td>
                    <td className="px-4 py-3">
                      {kw.search_intent && (
                        <span className="rounded-full bg-atlasnavy/8 px-2 py-0.5 text-[10px] font-medium capitalize text-atlasnavy/50">
                          {kw.search_intent}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && results.length === 0 && lastSeed && !error && (
        <p className="text-sm text-atlasnavy/50">No results — try a different seed or switch to Keyword ideas mode.</p>
      )}
    </div>
  );
}
