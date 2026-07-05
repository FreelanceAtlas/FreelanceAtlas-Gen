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

export type KeywordTier = "recommended" | "related" | "check";
export interface TieredKeyword extends KeywordMetrics { tier: KeywordTier; }

function deriveShortSeed(topic: string): string {
  return topic
    .replace(/\(.*?\)/g, "")
    .replace(/^(how to|what is|why|when|where|who|which|can you)\s+/i, "")
    .replace(/\bthat\b.*/i, "")
    .trim().split(/\s+/).slice(0, 3).join(" ").toLowerCase();
}

async function expandTopicToSeeds(
  topic: string,
  draftHeadings: string[] = [],
  sourceContext: string[] = []
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const headingsBlock = draftHeadings.length > 0
    ? `\nArticle sections:\n${draftHeadings.slice(0, 6).map((h) => `- ${h}`).join("\n")}\n` : "";
  const sourceBlock = sourceContext.length > 0
    ? `\nRelated articles:\n${sourceContext.slice(0, 4).map((t) => `- ${t}`).join("\n")}\n` : "";

  const prompt =
    `Topic: "${topic}"${headingsBlock}${sourceBlock}\n` +
    `Target audience: freelancers (designers, writers, developers, consultants) growing their businesses.\n\n` +
    `Generate 3 categories of 2-3 word keyword phrases (noun phrases only, no verbs, no qualifiers like "how to", "guide", "tips").\n\n` +
    `CORE (4 phrases): Noun phrases that directly name this topic or its core concepts\n` +
    `ADJACENT (4 phrases): Related topics a freelancer researching this would also search\n` +
    `PROBLEM (4 phrases): The pain points this topic solves\n\n` +
    `Return exactly:\n` +
    `CORE: phrase1, phrase2, phrase3, phrase4\n` +
    `ADJACENT: phrase1, phrase2, phrase3, phrase4\n` +
    `PROBLEM: phrase1, phrase2, phrase3, phrase4`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 250, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text: string = data.content?.[0]?.text ?? "";
    console.log("[keywords/research] Seeds raw:", text);

    const seeds: string[] = [];
    for (const line of text.split("\n")) {
      const match = line.match(/^(?:CORE|ADJACENT|PROBLEM):\s*(.+)/i);
      if (match) {
        match[1].split(",").forEach((s) => {
          const clean = s.trim().replace(/^[-*\d.)\s]+/, "").toLowerCase();
          const words = clean.split(/\s+/);
          if (clean.length > 3 && words.length >= 2 && words.length <= 4) seeds.push(clean);
        });
      }
    }
    if (seeds.length === 0) {
      return text.split("\n")
        .map((s) => s.trim().replace(/^[-*\d.)\s]+/, "").toLowerCase())
        .filter((s) => { const w = s.split(/\s+/); return s.length > 3 && w.length >= 2 && w.length <= 4; })
        .slice(0, 6);
    }
    console.log("[keywords/research] Seeds:", seeds);
    return seeds.slice(0, 12);
  } catch (e) {
    console.error("[keywords/research] Claude seed-gen failed:", e);
    return [];
  }
}

// Score every keyword 1-3 and attach a tier.
// 3 = directly about this topic → "recommended"
// 2 = adjacent, freelancer would find useful → "related"
// 1 = unrelated / coincidental match → "check"
async function scoreKeywords(
  candidates: KeywordMetrics[],
  topic: string,
  draftHeadings: string[],
  limit: number
): Promise<TieredKeyword[]> {
  if (candidates.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return candidates.slice(0, limit).map((k) => ({ ...k, tier: "related" as KeywordTier }));

  const pool = candidates.slice(0, 100);
  const kwList = pool.map((k, i) => `${i + 1}. ${k.keyword}`).join("\n");

  const headingsBlock = draftHeadings.length > 0
    ? `Article outline:\n${draftHeadings.slice(0, 6).map((h) => `- ${h}`).join("\n")}\n\n` : "";

  const prompt =
    `You are a keyword relevance judge for FreelanceAtlas.com.\n` +
    `Topic: "${topic}"\n${headingsBlock}` +
    `Score each keyword 1-3:\n` +
    `  3 = directly about this topic — confidently recommend it\n` +
    `  2 = adjacent — a freelancer on this topic would find it useful\n` +
    `  1 = unrelated, off-topic, or only a coincidental word match\n\n` +
    `Rule: when in doubt, score lower.\n\n` +
    `Return ONLY JSON: [{"n":1,"s":3},{"n":2,"s":1},...] where n=line number, s=score.\n\n` +
    `Keywords:\n${kwList}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return candidates.slice(0, limit).map((k) => ({ ...k, tier: "related" as KeywordTier }));
    const data = await res.json();
    const text: string = data.content?.[0]?.text ?? "";

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON");

    const scores = JSON.parse(jsonMatch[0]) as Array<{ n: number; s: number }>;
    const scoreMap = new Map(scores.map((x) => [x.n - 1, x.s]));

    const TIER: Record<number, KeywordTier> = { 3: "recommended", 2: "related", 1: "check" };

    const tiered: TieredKeyword[] = pool.map((k, i) => ({
      ...k,
      tier: TIER[scoreMap.get(i) ?? 1] ?? "check",
    }));

    const recommended = tiered.filter((k) => k.tier === "recommended");
    const related = tiered.filter((k) => k.tier === "related");
    const check = tiered.filter((k) => k.tier === "check");

    console.log(`[keywords/research] Tiers: ${recommended.length} recommended, ${related.length} related, ${check.length} check`);

    // Return up to limit across all tiers, prioritising recommended → related → check
    const topCheck = check.slice(0, Math.max(0, limit - recommended.length - related.length));
    return [...recommended, ...related, ...topCheck].slice(0, limit);
  } catch (e) {
    console.error("[keywords/research] Scoring failed:", e);
    return candidates.slice(0, limit).map((k) => ({ ...k, tier: "related" as KeywordTier }));
  }
}

export async function POST(request: Request) {
  const supabase = createClient();
  const body = await request.json();
  const {
    seed, clusterId, locationCode = DEFAULT_LOCATION_CODE, mode = "topic",
    sourceContext = [], draftContext = [], keywords: inputKeywords = [],
    limit = 30, save = false,
  } = body as {
    seed?: string; clusterId: string; locationCode?: number;
    mode?: "topic" | "ideas" | "related" | "metrics";
    sourceContext?: string[]; draftContext?: string[]; keywords?: string[];
    limit?: number; save?: boolean;
  };

  if (!clusterId) return NextResponse.json({ error: "clusterId is required" }, { status: 400 });
  if (mode !== "metrics" && !seed) return NextResponse.json({ error: "seed is required" }, { status: 400 });
  if (mode === "metrics" && (!inputKeywords || inputKeywords.length === 0))
    return NextResponse.json({ error: "keywords array is required for metrics mode" }, { status: 400 });

  let results: TieredKeyword[] | KeywordMetrics[];
  let debugSeeds: string[] = [];

  try {
    if (mode === "metrics") {
      results = await getKeywordMetrics(inputKeywords, { locationCode });

    } else if (mode === "topic") {
      let seeds = await expandTopicToSeeds(seed!, draftContext, sourceContext);
      if (seeds.length === 0) {
        const fallback = deriveShortSeed(seed!);
        seeds = [fallback];
      }
      debugSeeds = seeds;

      const perSeed = await Promise.all(
        seeds.map((s) =>
          getRelatedKeywords(s, { locationCode, limit: 20 })
            .then((r) => { console.log(`[keywords/research] related "${s}" -> ${r.length}`); return r; })
            .catch(() => getKeywordIdeas(s, { locationCode, limit: 20 }).catch(() => [] as KeywordMetrics[]))
        )
      );

      const seen = new Set<string>();
      const deduped = perSeed.flat()
        .filter((k) => { const key = k.keyword.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
        .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

      console.log(`[keywords/research] Pool: ${deduped.length}`);
      results = await scoreKeywords(deduped, seed!, draftContext, limit);

    } else if (mode === "related") {
      const raw = await getRelatedKeywords(seed!, { locationCode, limit })
        .catch(async () => getKeywordIdeas(seed!, { locationCode, limit }));
      results = raw.map((k) => ({ ...k, tier: "related" as KeywordTier }));

    } else {
      const raw = await getKeywordIdeas(seed!, { locationCode, limit });
      results = raw.map((k) => ({ ...k, tier: "related" as KeywordTier }));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "DataForSEO request failed";
    console.error("[keywords/research] Error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (save && results.length > 0) {
    const rows = results.map((kw) => ({
      cluster_id: clusterId,
      keyword: kw.keyword,
      search_intent: kw.search_intent ?? "informational",
      research_source: `DataForSEO/related — ${seed ?? "bulk"}`,
      volume: kw.volume, difficulty: kw.difficulty, cpc: kw.cpc, competition: kw.competition,
      trend: kw.trend.length > 0 ? kw.trend : null,
      dfs_updated_at: new Date().toISOString(),
      est_volume: kw.volume !== null
        ? kw.volume >= 10000 ? "10k+" : kw.volume >= 1000 ? `${Math.round(kw.volume / 1000)}k` : String(kw.volume)
        : null,
      est_difficulty: kw.difficulty !== null
        ? kw.difficulty >= 70 ? "Hard" : kw.difficulty >= 40 ? "Medium" : "Easy"
        : null,
      is_used: false,
    }));
    const { error: upsertError } = await supabase.from("keywords").upsert(rows, { onConflict: "cluster_id,keyword", ignoreDuplicates: false });
    if (upsertError)
      return NextResponse.json({ results, seeds: debugSeeds, saveError: upsertError.message }, { status: 200 });
  }

  return NextResponse.json({ results, seeds: debugSeeds, saved: save && results.length > 0 });
}
