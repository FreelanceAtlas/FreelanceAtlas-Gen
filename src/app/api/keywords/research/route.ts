// POST /api/keywords/research
//
// Body:
//   seed         string   — the full article topic
//   clusterId    string   — which cluster to save keywords under
//   locationCode number?  — DataForSEO location code (default 2840 = US)
//   mode         string?  — "topic" (default) | "ideas" | "related" | "metrics"
//                           topic   → Claude generates search queries from topic,
//                                     then keyword_ideas for each (recommended)
//                           ideas   → keyword_ideas for the seed directly
//                           related → related_keywords for the seed
//                           metrics → search_volume for an existing list
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

// Use Claude to expand an article topic into 5 short, specific search query
// phrases (2-4 words each) that people interested in this topic actually
// search for. These become DataForSEO seeds so keyword_ideas returns real
// search data for every angle of the topic.
async function expandTopicToQueries(topic: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

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
      messages: [
        {
          role: "user",
          content:
            `Article topic: "${topic}"\n\n` +
            `List exactly 5 specific Google search queries (2-4 words each) that someone researching this topic would type. ` +
            `Each query should cover a distinct angle or subtopic. ` +
            `Return only the queries, one per line, no numbering, no explanation.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude query expansion failed (${res.status})`);
  }

  const data = await res.json();
  const text: string =
    data.content?.[0]?.type === "text" ? data.content[0].text : "";

  return text
    .split("\n")
    .map((s: string) => s.trim().replace(/^[-\d\.\)\*\"]+\s*/, "").replace(/\"$/, "").toLowerCase())
    .filter((s: string) => s.length > 3 && s.split(/\s+/).length >= 2)
    .slice(0, 5);
}

export async function POST(request: Request) {
  const supabase = createClient();

  const body = await request.json();
  const {
    seed,
    clusterId,
    locationCode = DEFAULT_LOCATION_CODE,
    mode = "topic",
    keywords: inputKeywords = [],
    limit = 50,
    save = false,
  } = body as {
    seed?: string;
    clusterId: string;
    locationCode?: number;
    mode?: "topic" | "ideas" | "related" | "metrics";
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

  try {
    if (mode === "metrics") {
      results = await getKeywordMetrics(inputKeywords, { locationCode });

    } else if (mode === "topic") {
      // Step 1: Claude reads the full topic and generates 5 search queries
      const queries = await expandTopicToQueries(seed!);

      // Step 2: keyword_ideas for each query in parallel
      const perQuery = await Promise.all(
        queries.map((q) =>
          getKeywordIdeas(q, {
            locationCode,
            limit: Math.ceil(limit / queries.length) + 5,
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
        { results, saveError: upsertError.message },
        { status: 200 }
      );
    }
  }

  return NextResponse.json({ results, saved: save && results.length > 0 });
}
