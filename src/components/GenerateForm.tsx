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
  recommended: { label: "Most recommended", color: "bg-atlassky/40 border-atlasteal/30", badge: "bg-atlasteal text-white", defaultOpen: true },
  related:     { label: "Related",          color: "bg-atlascloud border-atlasnavy/10", badge: "bg-atlasnavy/10 text-atlasnavy", defaultOpen: true },
  check:       { label: "Check before adding", color: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-700", defaultOpen: false },
} as const;

type StepState = "todo" | "active" | "busy" | "done";

// One node in the guided flow: number circle (→ spinner → check) on a vertical
// connector line, mirroring the site's clean numbered-list aesthetic.
function Step({
  n, title, hint, state, last = false, children,
}: {
  n: number;
  title: string;
  hint?: string;
  state: StepState;
  last?: boolean;
  children: React.ReactNode;
}) {
  const circle =
    state === "done" ? "border-atlasteal bg-atlasteal text-white"
    : state === "busy" ? "border-atlasteal bg-white text-atlasteal"
    : state === "active" ? "border-atlasnavy bg-atlasnavy text-white"
    : "border-atlasnavy/20 bg-white text-atlasnavy/40";

  return (
    <div className="relative flex gap-4">
      {!last && <div className="absolute bottom-0 left-[15px] top-9 w-px bg-atlasnavy/10" />}
      <div className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors ${circle}`}>
        {state === "done" ? (
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : state === "busy" ? (
          <svg viewBox="0 0 16 16" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="8" cy="8" r="6" strokeOpacity={0.25} />
            <path d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round" />
          </svg>
        ) : (
          n
        )}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-8"}`}>
        <div className="flex h-8 items-center gap-2">
          <h2 className="text-sm font-bold text-atlasnavy">{title}</h2>
          {hint && <span className="text-xs text-atlasnavy/40">{hint}</span>}
        </div>
        <div className={`mt-2 transition-opacity ${state === "todo" ? "pointer-events-none opacity-40" : "opacity-100"}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

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

  const researching = fetchingOutline || fetchingDFS;
  const step1: StepState = primaryKeyword ? "done" : "active";
  const step2: StepState = researching
    ? "busy"
    : outline.length > 0 || supporting.trim()
    ? "done"
    : primaryKeyword
    ? "active"
    : "todo";
  const step3: StepState = fetchingSources
    ? "busy"
    : sourcesText.trim()
    ? "done"
    : primaryKeyword
    ? "active"
    : "todo";
  const step4: StepState = loading ? "busy" : primaryKeyword ? "active" : "todo";

  const inputCls =
    "w-full rounded-lg border border-atlasnavy/15 bg-white px-3.5 py-2.5 text-sm text-atlasnavy placeholder:text-atlasnavy/30 focus:border-atlasteal focus:outline-none focus:ring-2 focus:ring-atlasteal/20";
  const ghostBtn =
    "shrink-0 rounded-full border border-atlasnavy/15 px-3.5 py-1.5 text-xs font-semibold text-atlasnavy/70 transition-colors hover:bg-atlasnavy/5 hover:text-atlasnavy disabled:opacity-40";
  const tealBtn =
    "shrink-0 rounded-full border border-atlasteal/40 px-3.5 py-1.5 text-xs font-semibold text-atlasteal transition-colors hover:bg-atlassky/50 disabled:opacity-40";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-atlasnavy/5 bg-white p-8 shadow-sm">
        {/* ── Step 1: topic ─────────────────────────────────────────────── */}
        <Step n={1} title="Pick your topic" state={step1}>
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <select value={clusterId} onChange={(e) => setClusterId(e.target.value)}
                className={`${inputCls} sm:max-w-[220px]`}>
                {clusters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="flex flex-1 gap-2">
                <input value={primaryKeyword}
                  onChange={(e) => { setPrimaryKeyword(e.target.value); setTopicRationale(null); setOutline([]); setDfsOpen(false); setDfsKeywords([]); }}
                  placeholder="Primary keyword, e.g. best invoicing software for freelancers 2026"
                  className={inputCls} />
                <button type="button" onClick={suggestTopic} disabled={suggestingTopic || !clusterId} className={tealBtn}>
                  {suggestingTopic ? "Thinking…" : "Suggest"}
                </button>
              </div>
            </div>
            {topicRationale && <p className="text-xs text-atlasteal">{topicRationale}</p>}
            {topicError && <p className="text-xs text-red-600">{topicError}</p>}
            {clusterKeywords.length > 0 && (
              <div className="rounded-xl bg-atlascloud p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-atlasnavy/40">
                  Keyword bank — tap one to use it as the topic
                </p>
                <div className="mt-2 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto pr-1">
                  {clusterKeywords.map((k) => (
                    <button key={k.id} type="button"
                      onClick={() => { setPrimaryKeyword(k.keyword); setOutline([]); }}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        primaryKeyword === k.keyword
                          ? "border-atlasteal bg-atlasteal font-semibold text-white"
                          : "border-atlasnavy/15 bg-white text-atlasnavy/70 hover:border-atlasteal/50 hover:text-atlasnavy"
                      }`}>
                      {k.keyword}{k.is_used && <span className={`ml-1 ${primaryKeyword === k.keyword ? "text-white/60" : "text-atlasnavy/35"}`}>· used</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Step>

        {/* ── Step 2: outline + supporting keywords (auto) ──────────────── */}
        <Step n={2} title="Outline & supporting keywords" hint="runs automatically" state={step2}>
          <div className="space-y-3">
            {researching && (
              <p className="flex items-center gap-2 text-xs text-atlasteal">
                {fetchingOutline ? "Drafting the article outline…"
                  : outline.length > 0 ? "Finding keywords based on the outline…"
                  : fetchedSources.length > 0 ? "Finding keywords based on your sources…"
                  : "Identifying subtopics and fetching keyword data…"}
              </p>
            )}
            {!researching && step2 !== "done" && (
              <p className="text-xs text-atlasnavy/40">Starts on its own a moment after you set the topic.</p>
            )}
            {outlineError && <p className="text-xs text-red-600">{outlineError}</p>}
            {dfsError && <p className="text-xs text-red-600">{dfsError}</p>}

            {outline.length > 0 && (
              <div className="rounded-xl bg-atlassky/30 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-atlasnavy/40">Article sections</p>
                <ol className="mt-1.5 space-y-0.5">
                  {outline.map((h, i) => <li key={i} className="text-xs text-atlasnavy/75">{i + 1}. {h}</li>)}
                </ol>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-atlasnavy/60">Supporting keywords — auto-assigned, edit freely</label>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={suggestSupportingKeywords}
                    disabled={!primaryKeyword || unusedClusterKeywords.length === 0} className={ghostBtn}>
                    From bank
                  </button>
                  <button type="button"
                    onClick={() => fetchDFSKeywords(fetchedSources.map((s) => s.title).filter(Boolean), outline)}
                    disabled={!primaryKeyword || fetchingDFS} className={tealBtn}>
                    {fetchingDFS ? "Researching…" : "Re-research"}
                  </button>
                </div>
              </div>
              <input value={supporting} onChange={(e) => setSupporting(e.target.value)} className={`mt-1.5 ${inputCls}`} />
              {suggestionMessage && <p className="mt-1 text-xs text-atlasteal">{suggestionMessage}</p>}
            </div>

            {dfsOpen && dfsKeywords.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-atlasnavy">{dfsKeywords.length} keywords found — tap to add more:</p>
                  <button type="button" onClick={() => setDfsOpen(false)}
                    className="text-xs text-atlasnavy/40 hover:text-atlasnavy">✕</button>
                </div>
                <TierSection tier="recommended" keywords={byTier.recommended} selected={dfsSelected} onToggle={toggleDfsKeyword} defaultOpen={true} />
                <TierSection tier="related" keywords={byTier.related} selected={dfsSelected} onToggle={toggleDfsKeyword} defaultOpen={true} />
                <TierSection tier="check" keywords={byTier.check} selected={dfsSelected} onToggle={toggleDfsKeyword} defaultOpen={false} />
                <div className="flex items-center gap-3 pt-1">
                  <button type="button" onClick={addSelectedDfsKeywords} disabled={dfsSelected.size === 0}
                    className="rounded-full bg-atlasteal px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-atlasnavy disabled:opacity-40">
                    Add {dfsSelected.size > 0 ? `${dfsSelected.size} selected` : "selected"}
                  </button>
                  <button type="button"
                    onClick={() => setDfsSelected(new Set(dfsKeywords.map((k) => k.keyword)))}
                    className="text-xs font-semibold text-atlasteal hover:underline">Select all</button>
                  <button type="button" onClick={() => setDfsSelected(new Set())}
                    className="text-xs text-atlasnavy/50 hover:underline">Clear</button>
                </div>
              </div>
            )}
            {dfsOpen && !fetchingDFS && dfsKeywords.length === 0 && !dfsError && (
              <p className="text-xs text-atlasnavy/50">No keywords found for this topic — try rephrasing it.</p>
            )}
          </div>
        </Step>

        {/* ── Step 3: sources + notes ───────────────────────────────────── */}
        <Step n={3} title="Sources & notes" state={step3}>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-atlasnavy/60">
                Credible sources — one per line: <code className="rounded bg-atlascloud px-1">url | title | YYYY-MM-DD</code>
              </label>
              <button type="button" onClick={handleFetchSources} disabled={fetchingSources || !primaryKeyword} className={tealBtn}>
                {fetchingSources ? "Researching…" : "Fetch sources"}
              </button>
            </div>
            <textarea value={sourcesText} onChange={(e) => setSourcesText(e.target.value)} rows={5} className={inputCls} />
            {sourcesError && <p className="text-xs text-red-600">{sourcesError}</p>}
            {fetchedSources.length > 0 && (
              <ul className="space-y-1 text-xs text-atlasnavy/60">
                {fetchedSources.map((s, i) => (
                  <li key={i}><span className="font-semibold text-atlasnavy">{s.domain}</span>{s.authorityNote ? ` — ${s.authorityNote}` : ""}</li>
                ))}
              </ul>
            )}
            {suggestedFaqs.length > 0 && (
              <div className="rounded-xl bg-atlassky/30 p-3">
                <p className="text-xs font-semibold text-atlasnavy">Reader questions found while researching — covered in the FAQ section:</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-atlasnavy/70">
                  {suggestedFaqs.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-atlasnavy/60">Editor notes (optional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`mt-1.5 ${inputCls}`} />
            </div>
          </div>
        </Step>

        {/* ── Step 4: generate ──────────────────────────────────────────── */}
        <Step n={4} title="Generate" state={step4} last>
          <div className="space-y-3">
            {error && <p className="text-sm text-red-600">{error}</p>}
            {duplicateMatches && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
                <p className="font-semibold text-amber-800">This topic looks similar to existing content — possible duplicate:</p>
                <ul className="mt-1 list-disc pl-5 text-amber-800">
                  {duplicateMatches.map((m) => <li key={m.slug}>{m.title} ({Math.round(m.score * 100)}% overlap)</li>)}
                </ul>
                <button onClick={() => submit(true)}
                  className="mt-3 rounded-full bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700">
                  Generate anyway (new angle)
                </button>
              </div>
            )}
            <button disabled={loading || !primaryKeyword} onClick={() => submit(false)}
              className="w-full rounded-full bg-atlasnavy py-3 text-sm font-bold text-white transition-colors hover:bg-atlasteal disabled:opacity-40">
              {loading ? "Generating — fact-checking as it writes…" : "Generate publish-ready post"}
            </button>
            <p className="text-center text-xs text-atlasnavy/40">
              Duplicate check, fact-check, originality score, affiliate & internal links — all automatic.
            </p>
          </div>
        </Step>
      </div>
    </div>
  );
}
