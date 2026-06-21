"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Cluster { id: string; name: string; }
interface KeywordRow { id: string; keyword: string; cluster_id: string; }
interface FetchedSource {
  url: string;
  title: string;
  publishedDate?: string;
  domain: string;
  authorityNote: string;
}

export default function GenerateForm({ clusters, keywords }: { clusters: Cluster[]; keywords: KeywordRow[] }) {
  const router = useRouter();
  const [clusterId, setClusterId] = useState(clusters[0]?.id ?? "");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [supporting, setSupporting] = useState("");
  const [notes, setNotes] = useState("");
  const [sourcesText, setSourcesText] = useState("");
  const [fetchedSources, setFetchedSources] = useState<FetchedSource[]>([]);
  const [suggestedFaqs, setSuggestedFaqs] = useState<string[]>([]);
  const [fetchingSources, setFetchingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<{ title: string; slug: string; score: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clusterKeywords = keywords.filter((k) => k.cluster_id === clusterId);

  function suggestTopic() {
    if (clusterKeywords.length === 0) return;
    // Avoid re-suggesting the keyword that's already in the box, if there's another option.
    const pool = clusterKeywords.filter((k) => k.keyword !== primaryKeyword);
    const choices = pool.length > 0 ? pool : clusterKeywords;
    const pick = choices[Math.floor(Math.random() * choices.length)];
    setPrimaryKeyword(pick.keyword);
  }

  function parseSources() {
    return sourcesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [url, title, publishedDate] = line.split("|").map((s) => s.trim());
        return { url, title: title || url, publishedDate };
      });
  }

  async function handleFetchSources() {
    if (!primaryKeyword) return;
    setFetchingSources(true);
    setSourcesError(null);
    try {
      const clusterName = clusters.find((c) => c.id === clusterId)?.name ?? "";
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryKeyword,
          supportingKeywords: supporting.split(",").map((s) => s.trim()).filter(Boolean),
          clusterName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSourcesError(data.error ?? "Could not fetch sources");
        return;
      }
      const sources: FetchedSource[] = data.sources ?? [];
      setFetchedSources(sources);
      setSuggestedFaqs(data.suggestedFaqs ?? []);
      setSourcesText(
        sources
          .map((s) => `${s.url} | ${s.title}${s.publishedDate ? ` | ${s.publishedDate}` : ""}`)
          .join("\n")
      );
    } catch {
      setSourcesError("Could not fetch sources");
    } finally {
      setFetchingSources(false);
    }
  }

  async function submit(force = false) {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clusterId,
        primaryKeyword,
        supportingKeywords: supporting.split(",").map((s) => s.trim()).filter(Boolean),
        sources: parseSources(),
        notes,
        suggestedFaqs,
        force,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.status === 409) {
      setDuplicateMatches(data.matches);
      return;
    }
    if (!res.ok) {
      setError(data.error ?? "Generation failed");
      return;
    }
    setDuplicateMatches(null);
    router.push(`/dashboard/articles/${data.article.slug}`);
  }

  return (
    <div className="max-w-2xl">
      <div className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-atlasnavy">Cluster</label>
          <select
            value={clusterId}
            onChange={(e) => setClusterId(e.target.value)}
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm"
          >
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {clusterKeywords.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-atlasnavy/50">Bank — click one to use it, or write your own below:</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {clusterKeywords.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setPrimaryKeyword(k.keyword)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      primaryKeyword === k.keyword
                        ? "border-atlasteal bg-atlasteal/10 text-atlasteal font-semibold"
                        : "border-atlasnavy/20 text-atlasnavy/70 hover:bg-atlasnavy/5"
                    }`}
                  >
                    {k.keyword}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-atlasnavy">Primary keyword / topic</label>
            <button
              type="button"
              onClick={suggestTopic}
              disabled={clusterKeywords.length === 0}
              className="ml-3 shrink-0 rounded-md border border-atlasnavy/20 px-2.5 py-1 text-xs font-semibold text-atlasnavy/70 hover:bg-atlasnavy/5 disabled:opacity-50"
            >
              Suggest a topic
            </button>
          </div>
          <input
            value={primaryKeyword}
            onChange={(e) => setPrimaryKeyword(e.target.value)}
            placeholder="e.g. best invoicing software for freelancers 2026"
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-atlasnavy/40">
            Pick a topic from the bank above, hit "Suggest a topic" for a random one, or just type your own.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-atlasnavy">Supporting keywords (comma separated)</label>
          <input
            value={supporting}
            onChange={(e) => setSupporting(e.target.value)}
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-atlasnavy">
              Recent, credible sources — one per line: <code>url | title | YYYY-MM-DD</code>
            </label>
            <button
              type="button"
              onClick={handleFetchSources}
              disabled={fetchingSources || !primaryKeyword}
              className="ml-3 shrink-0 rounded-md border border-atlasteal px-2.5 py-1 text-xs font-semibold text-atlasteal hover:bg-atlasteal/10 disabled:opacity-50"
            >
              {fetchingSources ? "Researching…" : "Fetch sources"}
            </button>
          </div>
          <textarea
            value={sourcesText}
            onChange={(e) => setSourcesText(e.target.value)}
            rows={6}
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm"
          />
          {sourcesError && <p className="mt-1 text-xs text-red-600">{sourcesError}</p>}
          {fetchedSources.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-atlasnavy/60">
              {fetchedSources.map((s, i) => (
                <li key={i}>
                  <span className="font-semibold text-atlasnavy">{s.domain}</span>
                  {s.authorityNote ? ` — ${s.authorityNote}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>

        {suggestedFaqs.length > 0 && (
          <div className="rounded-md border border-atlasteal/30 bg-atlasteal/5 p-3">
            <p className="text-xs font-semibold text-atlasnavy">
              Reader questions found while researching — these will be covered in the FAQ section:
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs text-atlasnavy/70">
              {suggestedFaqs.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-atlasnavy">Editor notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {duplicateMatches && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-800">
              This topic looks similar to existing content — possible duplicate:
            </p>
            <ul className="mt-1 list-disc pl-5 text-amber-800">
              {duplicateMatches.map((m) => (
                <li key={m.slug}>{m.title} ({Math.round(m.score * 100)}% overlap)</li>
              ))}
            </ul>
            <button
              onClick={() => submit(true)}
              className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Generate anyway (new angle)
            </button>
          </div>
        )}

        <button
          disabled={loading || !primaryKeyword}
          onClick={() => submit(false)}
          className="rounded-md bg-atlasteal px-4 py-2 text-sm font-semibold text-white hover:bg-atlasteal/90 disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate publish-ready post"}
        </button>
      </div>
    </div>
  );
}
