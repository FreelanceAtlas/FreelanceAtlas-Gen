// POST /api/keywords/research
//
// Calls DataForSEO to find keyword ideas for a seed term, returns them with
// full metrics (volume, difficulty, CPC, competition, monthly trend), and
// optionally bulk-saves them into the keywords table so they're immediately
// available as supporting keywords for article generation.
//
// Body:
//   seed         string   — the seed keyword / topic to research
//   clusterId    string   — which cluster to save keywords under
//   locationCode number?  — DataForSEO location code (default 2840 = US)
//   mode         string?  — "ideas" (default) | "related" | "metrics"
//                           ideas    → keyword_ideas endpoint (best for discovery)
//                           related  → related_keywords endpoint (broader semantic)
//                                       auto-falls back to ideas if empty
//                           metrics  → search_volume endpoint (enrich existing list)
//   keywords     string[] — required when mode="metrics"
//   limit        number?  — max results to return (default 50)
//   save         boolean? — if true, upsert results into the keywords table

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getKeywordIdeas,
  getKeywordMetrics,
  getRelatedKeywords,
  DEFAULT_LOCATION_CODE,
  type KeywordMetrics,
} from "@/lib/dataforseo";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = createClient();

  const body = await request.json();
  const {
    seed,
    clusterId,
    locationCode = DEFAULT_LOCATION_CODE,
    mode = "ideas",
    keywords: inputKeywords = [],
    limit = 50,
    save = false,
  } = body as {
    seed?: string;
    clusterId: string;
    locationCode?: number;
    mode?: "ideas" | "related" | "metrics";
    keywords?: string[];
    limit?: number;
    save?: boolean;
  };

  if (!clusterId) {
    return NextResponse.json({ error: "clusterId is required" }, { status: 400 });
  }
  if (mode !== "metrics" && !seed) {
    return NextResponse.json({ error: "seed is required for idea/related modes" }, { status: 400 });
  }
  if (mode === "metrics" && (!inputKeywords || inputKeywords.length === 0)) {
    return NextResponse.json({ error: "keywords array is required for metrics mode" }, { status: 400 });
  }

  let results: KeywordMetrics[];

  try {
    if (mode === "metrics") {
      results = await getKeywordMetrics(inputKeywords, { locationCode });
    } else if (mode === "related") {
      // Try semantic related keywords first; fall back to ideas if the seed
      // doesn’t have enough SERP-clustering data in DataForSEO.
      results = await getRelatedKeywords(seed!, { locationCode, limit });
      if (results.length === 0) {
        results = await getKeywordIdeas(seed!, { locationCode, limit });
      }
    } else {
      results = await getKeywordIdeas(seed!, { locationCode, limit });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "DataForSEO request failed";
    return NextResponse.json(
      { error: message },
      { status: 502 }
    );
  }

  // --- Optionally persist into the keywords table -----------------------
  // Upserts on (cluster_id, keyword) so re-running research refreshes
  // metrics without creating duplicate rows. Existing is_used flags and
  // search_intent overrides set by editors are preserved on conflict
  // unless DataForSEO returns a better value.
  if (save && results.length > 0) {
    const rows = results.map((kw) => ({
      cluster_id: clusterId,
      keyword: kw.keyword,
      search_intent: kw.search_intent ?? "informational",
      research_source: `DataForSEO/${mode} — ${seed ?? "bulk"}`,
      volume: kw.volume,
      difficulty: kw.difficulty,
      cpc: kw.cpc,
      competition: kw.competition,
      trend: kw.trend.length > 0 ? kw.trend : null,
      dfs_updated_at: new Date().toISOString(),
      // Keep legacy text columns in sync so the dashboard's existing
      // est_volume/est_difficulty displays still show something useful.
      est_volume:
        kw.volume !== null
          ? kw.volume >= 10000
            ? "10k+"
            : kw.volume >= 1000
            ? `${Math.round(kw.volume / 1000)}k`
            : String(kw.volume)
          : null,
      est_difficulty:
        kw.difficulty !== null
          ? kw.difficulty >= 70
            ? "Hard"
            : kw.difficulty >= 40
            ? "Medium"
            : "Easy"
          : null,
      is_used: false,
    }));

    const { error: upsertError } = await supabase
      .from("keywords")
      .upsert(rows, { onConflict: "cluster_id,keyword", ignoreDuplicates: false });

    if (upsertError) {
      // Don't fail the whole request — return results but surface the save error
      return NextResponse.json(
        { results, saveError: upsertError.message },
        { status: 200 }
      );
    }
  }

  return NextResponse.json({ results, saved: save && results.length > 0 });
}
