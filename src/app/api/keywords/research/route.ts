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
    .slice(0, 3)
    .join(" ")
    .toLowerCase();
}

// Ask Claude Haiku to generate 5 SHORT key phrases (2-3 words) for this topic.
// These go directly into DataForSEO related_keywords — short clean noun phrases
// stay semantically close; longer queries with verbs/qualifiers cause drift.
async function expandTopicToSeeds(
  topic: string,
  draftHeadings: string[] = [],
  sourceContext: string[] = []
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[keywords/research] ANTHROPIC_API_KEY not set");
    return [];
  }

  const headingsBlock =
    draftHeadings.length > 0
      ? `\nArticle sections:\n${draftHeadings.slice(0, 6).map((h) => `- ${h}`).join("\n")}\n`
      : "";

  const sourceBlock =
    sourceContext.length > 0
      ? `\nRelated articles:\n${sourceContext.slice(0, 4).map((t) => `- ${t}`).join("\n")}\n`
      : "";

  const prompt =
    `Topic: "${topic}"${headingsBlock}${sourceBlock}\n` +
    `List exactly 5 short keyword phrases (2-3 words each) that directly name the core concepts in this topic. ` +
    `These will be used as seeds for a keyword research tool, so they must be clean noun phrases — ` +
    `NO verbs, NO qualifiers like "how to", "definition", "strategy", "guide", "tips", "examples", "process". ` +
    `Just the core subject-matter nouns. Each phrase should target a different concept. ` +
    `Return only the phrases, one per line, no numbering.`;

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
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error(`[keywords/research] Claude seed-gen error ${res.status}`);
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
  console.log("[keywords/research] Claude seeds:", text);

  return text
    .split("\n")
    .map((s) => s.trim().replace(/^[-\d\.\)\*\"]+\s*/, "").replace(/\"$/, "").toLowerCase())
    .filter((s) => {
      const words = s.split(/\s+/);
      return s.length > 3 && words.length >= 2 && words.length <= 4;
    })
    .slice(0, 5);
}

// Claude Haiku post-filter: given a pool of keyword candidates and the topic,
// return only those that are genuinely relevant. Semantic understanding beats
// token matching — handles any word being generic or specific depending on context.
async function semanticFilter(
  candidates: KeywordMetrics[],
  topic: string,
  draftHeadings: string[],
  limit: number
): Promise<KeywordMetrics[]> {
  if (candidates.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return candidates.slice(0, limit);

  const pool = candidates.slice(0, 80);
  const kwList = pool.map((k) => k.keyword).join("\n");

  const headingsBlock =
    draftHeadings.length > 0
      ? `Article sections:\n${draftHeadings.slice(0, 6).map((h) => `- ${h}`).join("\n")}\n\n`
      : "";

  const prompt =
    `Topic: "${topic}"\n${headingsBlock}` +
    `Below are keyword candidates. Return ONLY those genuinely relevant to this specific topic — ` +
    `meaning someone searching that keyword is likely interested in content about this exact topic. ` +
    `Exclude generic, unrelated, or only loosely connected keywords. ` +
    `Return just the relevant keywords, one per line, exactly as written.\n\n${kwList}`;

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
        max_tokens: 600,
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
    .map((s) => s.trim().toLowerCase().replace(/^[-\*\d\.\)]+\s*/, ""))
    .filter((s) => s.length > 0 && s.split(" ").length <= 6);

  console.log(`[keywords/research] Claude kept ${returned.length} of ${pool.length}`);

  const keepSet = new Set(returned);
  const filtered = pool.filter((k) => keepSet.has(k.keyword.toLowerCase()));

  // If Claude filtered everything (over-strict), fall back to top candidates
  if (filtered.length === 0) {
    console.warn("[keywords/research] Semantic filter returned 0 — falling back to top candidates");
    return candidates.slice(0, limit);
  }

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
  let debugSeeds: string[] = [];

  try {
    if (mode === "metrics") {
      results = await getKeywordMetrics(inputKeywords, { locationCode });

    } else if (mode === "topic") {
      // 1. Claude generates short noun-phrase seeds
      let seeds = await expandTopicToSeeds(seed!, draftContext, sourceContext);
      if (seeds.length === 0) {
        const fallback = deriveShortSeed(seed!);
        console.log("[keywords/research] Falling back to:", fallback);
        seeds = [fallback];
      }
      debugSeeds = seeds;
      console.log("[keywords/research] Seeds:", seeds);

      // 2. Use related_keywords for each seed — stays semantically close,
      //    unlike keyword_ideas which can drift badly on multi-word seeds
      const perSeedLimit = 25;
      const perSeed = await Promise.all(
        seeds.map((s) =>
          getRelatedKeywords(s, { locationCode, limit: perSeedLimit })
            .then((r) => { console.log(`[keywords/research] related "${s}" -> ${r.length}`); return r; })
            .catch((e) => {
              console.error(`related_keywords failed for "${s}":`, e);
              // fallback to keyword_ideas if related_keywords errors
              return getKeywordIdeas(s, { locationCode, limit: perSeedLimit }).catch(() => [] as KeywordMetrics[]);
            })
        )
      );

      // 3. Deduplicate, sort by volume
      const seen = new Set<string>();
      const deduped = perSeed
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
      research_source: `DataForSEO/related — ${seed ?? "bulk"}`,
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
        { results, seeds: debugSeeds, saveError: upsertError.message },
        { status: 200 }
      );
    }
  }

  return NextResponse.json({ results, seeds: debugSeeds, saved: save && results.length > 0 });
}
