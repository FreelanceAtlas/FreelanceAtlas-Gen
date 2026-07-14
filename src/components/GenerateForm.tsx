"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Cluster { id: string; name: string; }
interface KeywordRow { id: string; keyword: string; cluster_id: string; is_used?: boolean; }
interface FetchedSource {
  url: string; title: string; publishedDate?: string; domain: string; authorityNote: string;
}
interface DFSKeyword {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  tier: "recommended" | "related" | "check";
}

const STOPWORDS = new Set([
  "the", "for", "and", "with", "that", "this", "from", "your", "best", "top",
  "how", "what", "are", "you", "can", "vs", "a", "an", "to", "of", "in", "on",
  "is", "it", "be", "do", "does", "or", "as", "at", "by",
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function isRelevant(keyword: string, primaryKeyword: string): boolean {
  const kwTokens = new Set(tokenize(keyword));
  const topicTokens = new Set(tokenize(primaryKeyword));
  if (kwTokens.size === 0 || topicTokens.size === 0) return false;
  for (const token of kwTokens) { if (topicTokens.has(token)) return true; }
  return false;
}

function fmtVol(v: number | null) {
  if (v === null) return "–";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

const TIER_CONFIG = {
  recommended: { label: "Most recommended", color: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-700", defaultOpen: true },
  related:     { label: "Related",          color: "bg-atlasteal/5 border-atlasteal/20", badge: "bg-atlasteal/10 text-atlasteal", defaultOpen: true },
  check:       { label: "Check before adding", color: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-700", defaultOpen: false },
} as const;

function KwChip({ kw, selected, onToggle }: { kw: DFSKeyword; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        selected ? "border-atlasteal bg-atlasteal text-white" : "border-atlasnavy/20 text-atlasnavy/70 hover:bg-atlasnavy/5"
      }`}
    >
      <span>{kw.keyword}</span>
      <span className={`text-[10px] ${selected ? "text-white/70" : "text-atlasnavy/40"}`}>
        {fmtVol(kw.volume)}/mo{kw.difficulty !== null ? ` · KD ${kw.difficulty}` : ""}
      </span>
    </button>
  );
}

function TierSection({
  tier, keywords, selected, onToggle, defaultOpen,
}: {
  tier: keyof typeof TIER_CONFIG;
  keywords: DFSKeyword[];
  selected: Set<string>;
  onToggle: (kw: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (keywords.length === 0) return null;
  const cfg = TIER_CONFIG[tier];
  const selectedCount = keywords.filter((k) => selected.has(k.keyword)).length;

  return (
    <div className={`rounded-md border ${cfg.color} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.badge}`}>{cfg.label}</span>
          <span className="text-xs text-atlasnavy/50">{keywords.length} keyword{keywords.length !== 1 ? "s" : ""}</span>
          {selectedCount > 0 && <span className="text-xs font-semibold text-atlasteal">{selectedCount} selected</span>}
        </div>
        <span className="text-atlasnavy/30 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-current/10 px-3 pb-3 pt-2">
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((kw) => (
              <KwChip key={kw.keyword} kw={kw} selected={selected.has(kw.keyword)} onToggle={() => onToggle(kw.keyword)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GenerateForm({ clusters, keywords }: { clusters: Cluster[]; keywords: KeywordRow[] }) {
  const router = useRouter();
  const [clusterId, setClusterId] = useState(clusters[0]?.id ?? "");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [supporting, setSupporting] = useState("");
  const [suggestionMessage, setSuggestionMessage] = useState<string | null>(null);
  const [suggestingTopic, setSuggestingTopic] = useState(false);
  const [topicRationale, setTopicRationale] = useState<string | null>(null);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [sourcesText, setSourcesText] = useState("");
  const [fetchedSources, setFetchedSources] = useState<FetchedSource[]>([]);
  const [suggestedFaqs, setSuggestedFaqs] = useState<string[]>([]);
  const [fetchingSources, setFetchingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<{ title: string; slug: string; score: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outline, setOutline] = useState<string[]>([]);
  const [fetchingOutline, setFetchingOutline] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [dfsKeywords, setDfsKeywords] = useState<DFSKeyword[]>([]);
  const [dfsSelected, setDfsSelected] = useState<Set<string>>(new Set());
  const [fetchingDFS, setFetchingDFS] = useState(false);
  const [dfsError, setDfsError] = useState<string | null>(null);
  const [dfsOpen, setDfsOpen] = useState(false);

  const clusterKeywords = keywords.filter((k) => k.cluster_id === clusterId);
  const unusedClusterKeywords = clusterKeywords.filter((k) => !k.is_used);

  // Auto-research: once a primary keyword is set (typed, picked from the bank, or
  // suggested), draft the outline and run keyword research automatically — no click
  // needed. Debounced so typing doesn't fire a DataForSEO call per keystroke, and
  // each exact topic is only researched once (the Step 1 button re-runs manually).
  const lastAutoResearched = useRef<string>("");
  useEffect(() => {
    const kw = primaryKeyword.trim();
    if (!kw || kw.length < 4 || !clusterId) return;
    if (kw.toLowerCase() === lastAutoResearched.current) return;
    if (fetchingOutline || fetchingDFS || loading) return;
    const timer = setTimeout(() => {
      lastAutoResearched.current = kw.toLowerCase();
      setSupporting(""); // fresh topic → fresh supporting list
      setSuggestionMessage(null);
      handleDraftAndResearch();
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryKeyword, clusterId, fetchingOutline, fetchingDFS, loading]);

  // AI-suggested topics (research_source = "ai-suggested") show in the bank and are clickable
  // They're already in clusterKeywords — the bank chips below handle them

  const byTier = {
    recommended: dfsKeywords.filter((k) => k.tier === "recommended"),
    related:     dfsKeywords.filter((k) => k.tier === "related"),
    check:       dfsKeywords.filter((k) => k.tier === "check"),
  };

  async function suggestTopic() {
    setTopicError(null); setTopicRationale(null); setSuggestingTopic(true);
    try {
      const res = await fetch("/api/suggest-topic", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ clusterId }),
      });
      const data = await res.json();
      if (!res.ok) { setTopicError(data.error ?? "Could not suggest a topic"); return; }
      setPrimaryKeyword(data.topic); setTopicRationale(data.rationale ?? null); setOutline([]);
      // Refresh the server component so the bank shows this newly saved suggestion
      // (next click will also avoid it since it's now in coveredKeywords)
      router.refresh();
    } catch { setTopicError("Could not suggest a topic"); }
    finally { setSuggestingTopic(false); }
  }

  function suggestSupportingKeywords() {
    setSuggestionMessage(null);
    if (!primaryKeyword || unusedClusterKeywords.length === 0) return;
    const existing = new Set(supporting.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    const relevant = unusedClusterKeywords.filter(
      (k) => k.keyword.toLowerCase() !== primaryKeyword.toLowerCase() &&
        !existing.has(k.keyword.toLowerCase()) && isRelevant(k.keyword, primaryKeyword)
    );
    if (relevant.length === 0) { setSuggestionMessage("No unused keywords in this cluster look relevant to that topic."); return; }
    const additions = relevant.map((k) => k.keyword).join(", ");
    setSupporting((prev) => (prev.trim() ? `${prev.trim()}, ${additions}` : additions));
    setSuggestionMessage(`Added ${relevant.length} keyword${relevant.length > 1 ? "s" : ""} from the bank.`);
  }

  async function fetchOutline(topic: string = primaryKeyword): Promise<string[]> {
    if (!topic) return [];
    setOutlineError(null); setFetchingOutline(true); setOutline([]);
    try {
      const res = await fetch("/api/generate/outline", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) { setOutlineError(data.error ?? "Could not generate outline"); return []; }
      const headings: string[] = data.headings ?? [];
      setOutline(headings); return headings;
    } catch { setOutlineError("Could not generate outline"); return []; }
    finally { setFetchingOutline(false); }
  }

  async function handleDraftAndResearch() {
    if (!primaryKeyword || !clusterId) return;
    const headings = await fetchOutline(primaryKeyword);
    await fetchDFSKeywords([], headings);
  }

  async function fetchDFSKeywords(sourceTitles: string[] = [], draftHeadings: string[] = []) {
    if (!primaryKeyword || !clusterId) return;
    setDfsError(null); setFetchingDFS(true); setDfsOpen(true); setDfsKeywords([]); setDfsSelected(new Set());
    try {
      const res = await fetch("/api/keywords/research", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seed: primaryKeyword, clusterId, mode: "topic", limit: 30, save: true,
          sourceContext: sourceTitles, draftContext: draftHeadings.length > 0 ? draftHeadings : outline,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setDfsError(data.error ?? "Keyword research failed"); return; }
      const results: DFSKeyword[] = (data.results ?? [])
        .filter((r: DFSKeyword) => r.keyword && r.keyword.toLowerCase() !== primaryKeyword.toLowerCase())
        .slice(0, 30);
      setDfsKeywords(results);
      autoPickSupporting(results);
    } catch (err) {
      console.error("Keyword research error:", err);
      setDfsError("Keyword research failed");
    } finally { setFetchingDFS(false); }
  }

  // Auto-picks supporting keywords as soon as research returns: every "recommended"
  // keyword, topped up with "related" ones to 10 total. The field stays editable,
  // so this is a starting point the editor can trim, not a lock-in.
  function autoPickSupporting(results: DFSKeyword[]) {
    setSupporting((prev) => {
      const existing = new Set(prev.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
      const pool = [
        ...results.filter((k) => k.tier === "recommended"),
        ...results.filter((k) => k.tier === "related"),
      ];
      const additions: string[] = [];
      for (const k of pool) {
        if (additions.length >= 10) break;
        if (existing.has(k.keyword.toLowerCase())) continue;
        existing.add(k.keyword.toLowerCase());
        additions.push(k.keyword);
      }
      if (additions.length === 0) return prev;
      setSuggestionMessage(`Auto-picked ${additions.length} supporting keyword${additions.length > 1 ? "s" : ""} — edit the list if needed.`);
      return prev.trim() ? `${prev.trim()}, ${additions.join(", ")}` : additions.join(", ");
    });
  }

  function toggleDfsKeyword(kw: string) {
    setDfsSelected((prev) => { const next = new Set(prev); if (next.has(kw)) next.delete(kw); else next.add(kw); return next; });
  }

  function addSelectedDfsKeywords() {
    if (dfsSelected.size === 0) return;
    const existing = new Set(supporting.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    const toAdd = Array.from(dfsSelected).filter((k) => !existing.has(k.toLowerCase()));
    if (toAdd.length === 0) return;
    setSupporting((prev) => (prev.trim() ? `${prev.trim()}, ${toAdd.join(", ")}` : toAdd.join(", ")));
    setDfsSelected(new Set()); setDfsOpen(false);
    setSuggestionMessage(`Added ${toAdd.length} keyword${toAdd.length > 1 ? "s" : ""} from DataForSEO.`);
  }

  function parseSources() {
    return sourcesText.split("\n").map((line) => line.trim()).filter(Boolean)
      .map((line) => { const [url, title, publishedDate] = line.split("|").map((s) => s.trim()); return { url, title: title || url, publishedDate }; });
  }

  async function handleFetchSources() {
    if (!primaryKeyword) return;
    setFetchingSources(true); setSourcesError(null);
    try {
      const clusterName = clusters.find((c) => c.id === clusterId)?.name ?? "";
      const res = await fetch("/api/sources", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ primaryKeyword, supportingKeywords: supporting.split(",").map((s) => s.trim()).filter(Boolean), clusterName }),
      });
      const data = await res.json();
      if (!res.ok) { setSourcesError(data.error ?? "Could not fetch sources"); return; }
      const sources: FetchedSource[] = data.sources ?? [];
      setFetchedSources(sources); setSuggestedFaqs(data.suggestedFaqs ?? []);
      setSourcesText(sources.map((s) => `${s.url} | ${s.title}${s.publishedDate ? ` | ${s.publishedDate}` : ""}`).join("\n"));
      fetchDFSKeywords(sources.map((s) => s.title).filter(Boolean), outline);
    } catch { setSourcesError("Could not fetch sources"); }
    finally { setFetchingSources(false); }
  }

  async function submit(force = false) {
    setLoading(true); setError(null);
    const res = await fetch("/api/generate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clusterId, primaryKeyword,
        supportingKeywords: supporting.split(",").map((s) => s.trim()).filter(Boolean),
        sources: parseSources(), notes, suggestedFaqs, force,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.status === 409) { setDuplicateMatches(data.matches); return; }
    if (!res.ok) { setError(data.error ?? "Generation failed"); return; }
    setDuplicateMatches(null);
    router.push(`/dashboard/articles/${data.article.slug}`);
  }

  return (
    <div className="max-w-2xl">
      <div className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
        {/* Cluster */}
        <div>
          <label className="block text-sm font-medium text-atlasnavy">Cluster</label>
          <select value={clusterId} onChange={(e) => setClusterId(e.target.value)}
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm">
            {clusters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {clusterKeywords.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-atlasnavy/50">Bank — click one to use it, or write your own below:</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {clusterKeywords.map((k) => (
                  <button key={k.id} type="button"
                    onClick={() => { setPrimaryKeyword(k.keyword); setOutline([]); }}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      primaryKeyword === k.keyword
                        ? "border-atlasteal bg-atlasteal/10 text-atlasteal font-semibold"
                        : "border-atlasnavy/20 text-atlasnavy/70 hover:bg-atlasnavy/5"
                    }`}>
                    {k.keyword}{k.is_used && <span className="ml-1 text-atlasnavy/40">(used)</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Primary keyword */}
        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-atlasnavy">Primary keyword / topic</label>
            <button type="button" onClick={suggestTopic} disabled={suggestingTopic || !clusterId}
              className="ml-3 shrink-0 rounded-md border border-atlasnavy/20 px-2.5 py-1 text-xs font-semibold text-atlasnavy/70 hover:bg-atlasnavy/5 disabled:opacity-50">
              {suggestingTopic ? "Thinking…" : "Suggest a topic"}
            </button>
          </div>
          <input value={primaryKeyword}
            onChange={(e) => { setPrimaryKeyword(e.target.value); setTopicRationale(null); setOutline([]); setDfsOpen(false); setDfsKeywords([]); }}
            placeholder="e.g. best invoicing software for freelancers 2026"
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm" />
          {topicRationale && <p className="mt-1 text-xs text-atlasteal">{topicRationale}</p>}
          {topicError && <p className="mt-1 text-xs text-red-600">{topicError}</p>}
          <p className="mt-1 text-xs text-atlasnavy/40">
            Each suggestion is saved to the bank. Click again for a fresh angle — previously suggested topics stay in the bank for later.
          </p>
        </div>

        {/* Step 1: Draft outline */}
        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-atlasnavy">Step 1 — Outline &amp; keywords (runs automatically)</label>
            <button type="button" onClick={handleDraftAndResearch}
              disabled={fetchingOutline || fetchingDFS || !primaryKeyword}
              className="shrink-0 rounded-md border border-atlasteal px-2.5 py-1 text-xs font-semibold text-atlasteal hover:bg-atlasteal/10 disabled:opacity-50">
              {fetchingOutline ? "Drafting outline…" : fetchingDFS ? "Researching keywords…"
                : outline.length > 0 ? "Re-run outline + keywords" : "Run now"}
            </button>
          </div>
          {!outline.length && !fetchingOutline && !fetchingDFS && (
            <p className="mt-1 text-xs text-atlasnavy/40">
              Starts on its own a moment after you set the primary keyword.
            </p>
          )}
          {outlineError && <p className="mt-1 text-xs text-red-600">{outlineError}</p>}
          {outline.length > 0 && (
            <div className="mt-2 rounded-md border border-atlasnavy/10 bg-atlasnavy/[0.02] px-3 py-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-atlasnavy/40">Article sections</p>
              <ol className="space-y-0.5">
                {outline.map((h, i) => <li key={i} className="text-xs text-atlasnavy/70">{i + 1}. {h}</li>)}
              </ol>
            </div>
          )}
        </div>

        {/* Step 2: Supporting keywords */}
        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-atlasnavy">Supporting keywords (auto-assigned, comma separated)</label>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={suggestSupportingKeywords}
                disabled={!primaryKeyword || unusedClusterKeywords.length === 0}
                className="shrink-0 rounded-md border border-atlasnavy/20 px-2.5 py-1 text-xs font-semibold text-atlasnavy/70 hover:bg-atlasnavy/5 disabled:opacity-50">
                Add relevant from bank
              </button>
              <button type="button"
                onClick={() => fetchDFSKeywords(fetchedSources.map((s) => s.title).filter(Boolean), outline)}
                disabled={!primaryKeyword || fetchingDFS}
                className="shrink-0 rounded-md border border-atlasteal/60 px-2.5 py-1 text-xs font-semibold text-atlasteal hover:bg-atlasteal/10 disabled:opacity-50">
                {fetchingDFS ? "Researching…" : "Refresh keywords"}
              </button>
            </div>
          </div>
          <input value={supporting} onChange={(e) => setSupporting(e.target.value)}
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm" />
          {suggestionMessage && <p className="mt-1 text-xs text-atlasnavy/50">{suggestionMessage}</p>}
          {dfsError && <p className="mt-1 text-xs text-red-600">{dfsError}</p>}
          {dfsOpen && fetchingDFS && (
            <p className="mt-1 text-xs text-atlasnavy/50">
              {outline.length > 0 ? "Finding keywords based on your outline…"
                : fetchedSources.length > 0 ? "Finding keywords based on your sources…"
                : "Identifying subtopics and fetching keyword data…"}
            </p>
          )}

          {/* Tiered keyword picker */}
          {dfsOpen && dfsKeywords.length > 0 && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-atlasnavy">
                  {dfsKeywords.length} keywords found — click to select:
                </p>
                <button type="button" onClick={() => setDfsOpen(false)}
                  className="text-xs text-atlasnavy/40 hover:text-atlasnavy">✕</button>
              </div>

              <TierSection tier="recommended" keywords={byTier.recommended} selected={dfsSelected} onToggle={toggleDfsKeyword} defaultOpen={true} />
              <TierSection tier="related" keywords={byTier.related} selected={dfsSelected} onToggle={toggleDfsKeyword} defaultOpen={true} />
              <TierSection tier="check" keywords={byTier.check} selected={dfsSelected} onToggle={toggleDfsKeyword} defaultOpen={false} />

              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={addSelectedDfsKeywords} disabled={dfsSelected.size === 0}
                  className="rounded-md bg-atlasteal px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                  Add {dfsSelected.size > 0 ? `${dfsSelected.size} selected` : "selected"}
                </button>
                <button type="button"
                  onClick={() => setDfsSelected(new Set(dfsKeywords.map((k) => k.keyword)))}
                  className="text-xs text-atlasteal hover:underline">Select all</button>
                <button type="button" onClick={() => setDfsSelected(new Set())}
                  className="text-xs text-atlasnavy/50 hover:underline">Clear</button>
              </div>
            </div>
          )}
          {dfsOpen && !fetchingDFS && dfsKeywords.length === 0 && !dfsError && (
            <p className="mt-1 text-xs text-atlasnavy/50">No keywords found for this topic — try rephrasing it.</p>
          )}
        </div>

        {/* Step 3: Sources */}
        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-atlasnavy">
              Recent, credible sources — one per line: <code>url | title | YYYY-MM-DD</code>
            </label>
            <button type="button" onClick={handleFetchSources} disabled={fetchingSources || !primaryKeyword}
              className="ml-3 shrink-0 rounded-md border border-atlasteal px-2.5 py-1 text-xs font-semibold text-atlasteal hover:bg-atlasteal/10 disabled:opacity-50">
              {fetchingSources ? "Researching…" : "Fetch sources"}
            </button>
          </div>
          <textarea value={sourcesText} onChange={(e) => setSourcesText(e.target.value)} rows={6}
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm" />
          {sourcesError && <p className="mt-1 text-xs text-red-600">{sourcesError}</p>}
          {fetchedSources.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-atlasnavy/60">
              {fetchedSources.map((s, i) => (
                <li key={i}><span className="font-semibold text-atlasnavy">{s.domain}</span>{s.authorityNote ? ` — ${s.authorityNote}` : ""}</li>
              ))}
            </ul>
          )}
        </div>

        {suggestedFaqs.length > 0 && (
          <div className="rounded-md border border-atlasteal/30 bg-atlasteal/5 p-3">
            <p className="text-xs font-semibold text-atlasnavy">Reader questions found while researching — these will be covered in the FAQ section:</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-atlasnavy/70">
              {suggestedFaqs.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-atlasnavy">Editor notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {duplicateMatches && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-800">This topic looks similar to existing content — possible duplicate:</p>
            <ul className="mt-1 list-disc pl-5 text-amber-800">
              {duplicateMatches.map((m) => <li key={m.slug}>{m.title} ({Math.round(m.score * 100)}% overlap)</li>)}
            </ul>
            <button onClick={() => submit(true)}
              className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">Generate anyway (new angle)</button>
          </div>
        )}

        <button disabled={loading || !primaryKeyword} onClick={() => submit(false)}
          className="rounded-md bg-atlasteal px-4 py-2 text-sm font-semibold text-white hover:bg-atlasteal/90 disabled:opacity-50">
          {loading ? "Generating…" : "Generate publish-ready post"}
        </button>
      </div>
    </div>
  );
}
