// POST /api/keywords/research
//
// Calls DataForSEO to find keyword ideas for a seed term, returns them with
// full metrics (volume, difficulty, CPC, competition, monthly trend), and
// optionally bulk-saves them into the keywords table so they're immediately
// available as supporting keywords for article generation.
//
// Body:
//   seed         string   — the topic / seed keyword
//   clusterId    string   — which cluster to save keywords under
//   locationCode number?  — DataForSEO location code (default 2840 = US)
//   mode         string?  — "topic" (default) | "ideas" | "related" | "metrics"
//                           topic   → Claude expands topic into subtopics,
//                                     then keyword_ideas for each (richest)
//                           ideas   → keyword_ideas for the seed directly
//                           related → related_keywords for the seed
//                           metrics → search_volume for an existing list
//   keywords     string[] — required when mode="metrics"
//   limit        number?  — max results to return (default 50)
//   save         boolean? — if true, upsert results into the keywords table

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  getKeywordIdeas,
  getKeywordMetrics,
  getRelatedKeywords,
  DEFAULT_LOCATION_CODE,
  type KeywordMetrics,
} from "@/lib/dataforseo";

export const maxDuration = 60;

// --- Step 1: Use Claude to expand the article topic into subtopic seeds ----
// Given a topic like "How to Create a Freelance Business Name", returns
// specific 2-4 word phrases like ["freelance business name", "business naming
// strategy", "freelance branding tips", ...] that each work as DataForSEO seeds.
async function expandTopicToSubtopics(topic: string): Promise<string[]> {
  const client = new Anthropic();

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content:
          `Article topic: "${topic}"\n\n` +
          `List 5 specific subtopic keyword phrases (2-4 words each) that cover the main aspects someone reading this article would search for. ` +
          `Each phrase should work as a standalone keyword research seed for DataForSEO. ` +
          `Return only the phrases, one per line, no numbering or bullets.`,
      },
    ],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  return text
    .split("\n")
    .map((s) => s.trim().replace(/^[-\d\.\)\*]+\s*/, "").toLowerCase())
    .filter((s) => s.length > 3 && s.split(/\s+/).length >= 2)
    .slice(0, 6);
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
      // Step 1: Claude expands the topic into 5-6 subtopic seeds
      const subtopics = await expandTopicToSubtopics(seed!);

      // Step 2: keyword_ideas for each subtopic, in parallel
      const perSubtopic = await Promise.all(
        subtopics.map((st) =>
          getKeywordIdeas(st, { locationCode, limit: Math.ceil(limit / subtopics.length) + 5 })
        )
      );

      // Step 3: deduplicate and sort by volume
      const seen = new Set<string>();
      results = perSubtopic
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
