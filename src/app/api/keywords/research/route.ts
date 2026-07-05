// POST /api/keywords/research
//
// Body:
//   seed          string    — the full article topic
//   clusterId     string    — which cluster to save keywords under
//   locationCode  number?   — DataForSEO location code (default 2840 = US)
//   mode          string?   — "topic" (default) | "ideas" | "related" | "metrics"
//   sourceContext string[]? — source titles fetched for this topic (improves Claude query generation)
//   keywords      string[]  — required when mode="metrics"
//   limit         number?   — max results to return (default 50)
//   save          boolean?  — if true, upsert results into the keywords table

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

// Derive a short fallback seed from a long article title.
function deriveShortSeed(topic: string): string {
  return topic
    .replace(/\(.*?\)/g, "")
    .replace(/^(how to|what is|why|when|where|who|which|can you)\s+/i, "")
    .replace(/\bthat\b.*/i, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ")
    .toLowerCase();
}

async function expandTopicToQueries(
  topic: string,
  sourceContext: string[] = []
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[keywords/research] ANTHROPIC_API_KEY not set");
    return [];
  }

  const sourceBlock =
    sourceContext.length > 0
      ? `\nRelated articles found online about this topic:\n${sourceContext
          .slice(0, 8)
          .map((t) => `- ${t}`)
          .join("\n")}\n`
      : "";

  const prompt =
    `Article topic: "${topic}"${sourceBlock}\n\n` +
    `List exactly 5 specific Google search queries (2-4 words each) that someone researching this topic would type. ` +
    `Each query should cover a distinct angle or subtopic. ` +
    `Return only the queries, one per line, no numbering, no explanation.`;

  let data: Record<string, unknown>;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[keywords/research] Claude API error ${res.status}:`, text);
      return [];
    }
    data = await res.json();
  } catch (e) {
    console.error("[keywords/research] Claude fetch failed:", e);
    return [];
  }

  const content = data.content as Array<{ type: string; text?: string }> | undefined;
  if (!content || content[0]?.type !== "text") {
    console.error("[keywords/research] Unexpected Claude response:", JSON.stringify(data).slice(0, 300));
    return [];
  }

  const text = content[0].text ?? "";
  console.log("[keywords/research] Claude raw output:", text);

  const queries = text
    .split("\n")
    .map((s) => s.trim().replace(/^[-\d\.\)\*\"]+\s*/, "").replace(/\"$/, "").toLowerCase())
    .filter((s) => s.length > 3 && s.split(/\s+/).length >= 2)
    .slice(0, 5);

  console.log("[keywords/research] Parsed queries:", queries);
  return queries;
}

export async function POST(request: Request) {
  const supabase = createClient();

  const body = await request.json();
  const {
    seed,
    clusterId,
    locationCode = DEFAULT_LOCATION_CODE,
    mode = "topic",
    sourceContext = [],
    keywords: inputKeywords = [],
    limit = 50,
    save = false,
  } = body as {
    seed?: string;
    clusterId: string;
    locationCode?: number;
    mode?: "topic" | "ideas" | "related" | "metrics";
    sourceContext?: string[];
    keywords?: string[];
    limit?: number;
    save?: boolean;
  };

  if (!clusterId) {
    return NextResponse.json({ error: "clusterId is required" }, { status: 400 });
  }
  if (mode !== "metrics" && !seed) {
    return NextResponse.json({ error: "seed is required" }, { status: 400 });
  }
  if (mode === "metrics" && (!inputKeywords || inputKeywords.length === 0)) {
    return NextResponse.json({ error: "keywords array is required for metrics mode" }, { status: 400 });
  }

  let results: KeywordMetrics[];
  let debugQueries: string[] = [];

  try {
    if (mode === "metrics") {
      results = await getKeywordMetrics(inputKeywords, { locationCode });

    } else if (mode === "topic") {
      // Step 1: Claude expands topic → 5 focused search queries
      // Source titles from the UI give Claude real context about the topic.
      let queries = await expandTopicToQueries(seed!, sourceContext);

      // Fallback: if Claude returned nothing, derive a short seed manually
      if (queries.length === 0) {
        const fallback = deriveShortSeed(seed!);
        console.log("[keywords/research] Claude returned 0 queries, falling back to:", fallback);
        queries = [fallback];
      }

      debugQueries = queries;
      console.log("[keywords/research] Fetching keyword_ideas for:", queries);

      // Step 2: keyword_ideas for each query in parallel
      const perQueryLimit = Math.max(12, Math.ceil(limit / queries.length) + 5);
      const perQuery = await Promise.all(
        queries.map((q) =>
          getKeywordIdeas(q, { locationCode, limit: perQueryLimit })
            .then((r) => {
              console.log(`[keywords/research] "${q}" -> ${r.length} results`);
              return r;
            })
            .catch((e) => {
              console.error(`[keywords/research] keyword_ideas failed for "${q}":`, e);
              return [] as KeywordMetrics[];
            })
        )
      );

      // Step 3: deduplicate and sort by volume
      const seen = new Set<string>();
      results = perQuery
        .flat()
        .filter((k) => {
          const key = k.keyword.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
        .slice(0, limit);

      console.log(`[keywords/research] Final: ${results.length} keywords after dedup`);

    } else if (mode === "related") {
      results = await getRelatedKeywords(seed!, { locationCode, limit });
      if (results.length === 0) {
        results = await getKeywordIdeas(seed!, { locationCode, limit });
      }

    } else {
      results = await getKeywordIdeas(seed!, { locationCode, limit });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "DataForSEO request failed";
    console.error("[keywords/research] Unhandled error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // --- Optionally persist into the keywords table -----------------------
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
      est_volume:
        kw.volume !== null
          ? kw.volume >= 10000 ? "10k+"
          : kw.volume >= 1000 ? `${Math.round(kw.volume / 1000)}k`
          : String(kw.volume)
          : null,
      est_difficulty:
        kw.difficulty !== null
          ? kw.difficulty >= 70 ? "Hard"
          : kw.difficulty >= 40 ? "Medium"
          : "Easy"
          : null,
      is_used: false,
    }));

    const { error: upsertError } = await supabase
      .from("keywords")
      .upsert(rows, { onConflict: "cluster_id,keyword", ignoreDuplicates: false });

    if (upsertError) {
      return NextResponse.json(
        { results, queries: debugQueries, saveError: upsertError.message },
        { status: 200 }
      );
    }
  }

  return NextResponse.json({ results, queries: debugQueries, saved: save && results.length > 0 });
}
