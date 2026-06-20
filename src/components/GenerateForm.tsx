"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Cluster { id: string; name: string; }
interface KeywordRow { id: string; keyword: string; cluster_id: string; }

export default function GenerateForm({ clusters, keywords }: { clusters: Cluster[]; keywords: KeywordRow[] }) {
  const router = useRouter();
  const [clusterId, setClusterId] = useState(clusters[0]?.id ?? "");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [supporting, setSupporting] = useState("");
  const [notes, setNotes] = useState("");
  const [sourcesText, setSourcesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<{ title: string; slug: string; score: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clusterKeywords = keywords.filter((k) => k.cluster_id === clusterId);

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
            <p className="mt-1 text-xs text-atlasnavy/50">
              Bank: {clusterKeywords.map((k) => k.keyword).join(", ")}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-atlasnavy">Primary keyword / topic</label>
          <input
            value={primaryKeyword}
            onChange={(e) => setPrimaryKeyword(e.target.value)}
            placeholder="e.g. best invoicing software for freelancers 2026"
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm"
          />
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
          <label className="block text-sm font-medium text-atlasnavy">
            Recent, credible sources — one per line: <code>url | title | YYYY-MM-DD</code>
          </label>
          <textarea
            value={sourcesText}
            onChange={(e) => setSourcesText(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm"
          />
        </div>

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
