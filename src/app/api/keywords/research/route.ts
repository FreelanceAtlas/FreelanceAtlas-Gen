// POST /api/keywords/research

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

// Ask Claude Haiku to generate 5 specific Google search queries for this topic.
// draftHeadings and sourceContext give it extra signal about what the article covers.
async function expandTopicToQueries(
  topic: string,
  sourceContext: string[] = [],
  draftHeadings: string[] = []
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[keywords/research] ANTHROPIC_API_KEY not set");
    return [];
  }

  const headingsBlock =
    draftHeadings.length > 0
      ? `\nThe article will cover these sections:\n${draftHeadings
          .slice(0, 8)
          .map((h) => `- ${h}`)
          .join("\n")}\n`
      : "";

  const sourceBlock =
    sourceContext.length > 0
      ? `\nRelated articles found online:\n${sourceContext
          .slice(0, 6)
          .map((t) => `- ${t}`)
          .join("\n")}\n`
      : "";

  const prompt =
    `Article topic: "${topic}"${headingsBlock}${sourceBlock}\n` +
    `List exactly 5 specific Google search queries (2-4 words each) a person would type to research this topic. ` +
    `Use concrete subject-matter terms — avoid vague words like "search", "check", "ideas", "tips", "guide", "examples", "template", "free", "best", "names", "brand", "media", "legal", "management", "language". ` +
    `Each query should target a distinct, specific angle. ` +
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
      console.error(`[keywords/research] Claude query-gen error ${res.status}`);
      return [];
    }
    data = await res.json();
  } catch (e) {
    console.error("[keywords/research] Claude fetch failed:", e);
    return [];
  }

  const content = data.content as Array<{ type: string; text?: string }> | undefined;
  if (!content || content[0]?.type !== "text") return [];

  const text = content[0].text ?? "";
  console.log("[keywords/research] Claude queries:", text);

  return text
    .split("\n")
    .map((s) => s.trim().replace(/^[-\d\.\)\*\"]+\s*/, "").replace(/\"$/, "").toLowerCase())
    .filter((s) => s.length > 3 && s.split(/\s+/).length >= 2)
    .slice(0, 5);
}

// Ask Claude Haiku to filter a list of keyword candidates down to those
// genuinely relevant to the topic and outline. Semantic understanding beats
// token matching — any word can be generic or specific depending on context.
async function semanticFilter(
  candidates: KeywordMetrics[],
  topic: string,
  draftHeadings: string[],
  limit: number
): Promise<KeywordMetrics[]> {
  if (candidates.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: return as-is if no key
    return candidates.slice(0, limit);
  }

  // Only send the top 60 by volume — Haiku context is cheap but keep prompt tight
  const pool = candidates.slice(0, 60);
  const kwList = pool.map((k) => k.keyword).join("\n");

  const headingsBlock =
    draftHeadings.length > 0
      ? `Article sections:\n${draftHeadings.slice(0, 6).map((h) => `- ${h}`).join("\n")}\n\n`
      : "";

  const prompt =
    `Topic: "${topic}"\n${headingsBlock}` +
    `Below are keyword candidates from a keyword research tool. ` +
    `Return ONLY the keywords that are genuinely relevant to this specific topic — ` +
    `meaning someone searching that keyword is likely interested in content about this exact topic. ` +
    `Exclude generic, unrelated, or only loosely connected keywords. ` +
    `Return just the relevant keywords, one per line, nothing else.\n\n${kwList}`;

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
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error(`[keywords/research] Claude filter error ${res.status}`);
      return candidates.slice(0, limit);
    }
    data = await res.json();
  } catch (e) {
    console.error("[keywords/research] Claude filter fetch failed:", e);
    return candidates.slice(0, limit);
  }

  const content = data.content as Array<{ type: string; text?: string }> | undefined;
  if (!content || content[0]?.type !== "text") return candidates.slice(0, limit);

  const returned = (content[0].text ?? "")
    .split("\n")
    .map((s) => s.trim().toLowerCase().replace(/^[-\*]\s*/, ""))
    .filter((s) => s.length > 0);

  console.log("[keywords/research] Claude kept:", returned);

  // Preserve original KeywordMetrics objects (with volume/difficulty) by matching
  // on lowercase keyword string. Maintain volume-sorted order from pool.
  const keepSet = new Set(returned);
  const filtered = pool.filter((k) => keepSet.has(k.keyword.toLowerCase()));

  console.log(`[keywords/research] Semantic filter: ${pool.length} -> ${filtered.length}`);
  return filtered.slice(0, limit);
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
    draftContext = [],
    keywords: inputKeywords = [],
    limit = 30,
    save = false,
  } = body as {
    seed?: string;
    clusterId: string;
    locationCode?: number;
    mode?: "topic" | "ideas" | "related" | "metrics";
    sourceContext?: string[];
    draftContext?: string[];
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
      // 1. Generate seed queries
      let queries = await expandTopicToQueries(seed!, sourceContext, draftContext);
      if (queries.length === 0) {
        const fallback = deriveShortSeed(seed!);
        console.log("[keywords/research] Falling back to:", fallback);
        queries = [fallback];
      }
      debugQueries = queries;

      // 2. Fetch keyword ideas for each seed in parallel
      const perQueryLimit = 30;
      const perQuery = await Promise.all(
        queries.map((q) =>
          getKeywordIdeas(q, { locationCode, limit: perQueryLimit })
            .then((r) => { console.log(`[keywords/research] "${q}" -> ${r.length}`); return r; })
            .catch((e) => { console.error(`keyword_ideas failed for "${q}":`, e); return [] as KeywordMetrics[]; })
        )
      );

      // 3. Deduplicate and sort by volume before sending to Claude filter
      const seen = new Set<string>();
      const deduped = perQuery
        .flat()
        .filter((k) => {
          const key = k.keyword.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

      console.log(`[keywords/research] Deduped pool: ${deduped.length}`);

      // 4. Claude semantic post-filter
      results = await semanticFilter(deduped, seed!, draftContext, limit);

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
