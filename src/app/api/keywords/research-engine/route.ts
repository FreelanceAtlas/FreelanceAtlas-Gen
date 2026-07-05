// POST /api/keywords/research-engine
// Autonomous multi-strategy keyword research engine.
//
// Strategy:
// 1. Claude generates 6 short noun-phrase seeds (freelancer-audience-aware)
// 2. Round 1: related_keywords for each seed in parallel
// 3. Round 2: related_keywords for top 5 by volume from round 1
// 4. Claude batch-scores top 60 for: intent, audience_fit (1-5), cluster
// 5. Opportunity score = sqrt(vol) × (1-KD/100)² × intent_weight × audience_fit/5
// 6. Return top results sorted by opportunity, filtered by audience_fit >= 2

import { NextResponse } from "next/server";
import {
  getRelatedKeywords,
  getKeywordIdeas,
  DEFAULT_LOCATION_CODE,
  type KeywordMetrics,
} from "@/lib/dataforseo";

export const maxDuration = 120;

const INTENT_WEIGHTS: Record<string, number> = {
  transactional: 1.5,
  commercial: 1.3,
  informational: 1.0,
  navigational: 0.4,
};

export interface ScoredKeyword extends KeywordMetrics {
  intent: string;
  audience_fit: number; // 1-5
  cluster: string;
  opportunity: number;
}

function opportunityScore(
  kw: KeywordMetrics,
  audienceFit: number,
  intent: string
): number {
  const vol = Math.max(kw.volume ?? 0, 0);
  const kd = Math.min(Math.max(kw.difficulty ?? 50, 0), 100);
  const intentW = INTENT_WEIGHTS[intent] ?? 1.0;
  const fitW = audienceFit / 5;
  return Math.round(Math.sqrt(vol) * Math.pow(1 - kd / 100, 2) * intentW * fitW * 100);
}

async function callClaude(
  prompt: string,
  maxTokens: number,
  apiKey: string
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) return "";
  const data = await res.json();
  return (data.content?.[0]?.text ?? "") as string;
}

async function generateSeeds(topic: string, apiKey: string): Promise<string[]> {
  const text = await callClaude(
    `Topic: "${topic}"\n` +
    `Target audience: freelancers (designers, writers, developers, consultants) growing their businesses.\n\n` +
    `List 6 short keyword phrases (2-3 words, noun phrases only) that directly name core concepts a freelancer would search related to this topic.\n` +
    `No verbs, no qualifiers (how to, definition, guide, tips). Just subject-matter nouns.\n` +
    `Return one per line, no numbering.`,
    120,
    apiKey
  );

  return text
    .split("\n")
    .map((s) => s.trim().replace(/^[-*\d.)\s]+/, "").toLowerCase())
    .filter((s) => {
      const words = s.split(/\s+/);
      return s.length > 3 && words.length >= 2 && words.length <= 4;
    })
    .slice(0, 6);
}

async function scoreKeywords(
  keywords: KeywordMetrics[],
  topic: string,
  apiKey: string
): Promise<ScoredKeyword[]> {
  if (keywords.length === 0) return [];

  const kwList = keywords.map((k) => k.keyword).join("\n");

  const text = await callClaude(
    `You are scoring keywords for FreelanceAtlas.com, a content site for freelancers growing their businesses.\n` +
    `Topic context: "${topic}"\n\n` +
    `For each keyword below, return a JSON object with:\n` +
    `- keyword: exact string as given\n` +
    `- intent: one of informational | commercial | transactional | navigational\n` +
    `  (informational = learning; commercial = comparing tools/services; transactional = ready to buy/hire; navigational = finding a specific site)\n` +
    `- audience_fit: 1-5 integer (5 = directly useful for a freelancer, 1 = generic/unrelated to freelancing)\n` +
    `- cluster: 2-4 word thematic group name for similar keywords\n\n` +
    `Return ONLY a valid JSON array, no explanation, no markdown.\n\n` +
    `Keywords:\n${kwList}`,
    3000,
    apiKey
  );

  const fallback = (k: KeywordMetrics): ScoredKeyword => ({
    ...k,
    intent: k.search_intent ?? "informational",
    audience_fit: 3,
    cluster: "General",
    opportunity: opportunityScore(k, 3, k.search_intent ?? "informational"),
  });

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");

    const scored = JSON.parse(jsonMatch[0]) as Array<{
      keyword: string;
      intent: string;
      audience_fit: number;
      cluster: string;
    }>;

    const scoreMap = new Map(scored.map((s) => [s.keyword.toLowerCase().trim(), s]));

    return keywords.map((k) => {
      const s = scoreMap.get(k.keyword.toLowerCase().trim());
      const intent = s?.intent ?? (k.search_intent ?? "informational");
      const audience_fit = Math.min(Math.max(Math.round(s?.audience_fit ?? 3), 1), 5);
      const cluster = s?.cluster ?? "General";
      return { ...k, intent, audience_fit, cluster, opportunity: opportunityScore(k, audience_fit, intent) };
    });
  } catch (e) {
    console.error("[research-engine] Score parse failed:", e, "\nRaw:", text.slice(0, 300));
    return keywords.map(fallback);
  }
}

async function fetchRelatedWithFallback(
  seed: string,
  locationCode: number,
  limit: number
): Promise<KeywordMetrics[]> {
  try {
    const r = await getRelatedKeywords(seed, { locationCode, limit });
    if (r.length > 0) return r;
  } catch {}
  try {
    return await getKeywordIdeas(seed, { locationCode, limit });
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    topic,
    clusterId,
    locationCode = DEFAULT_LOCATION_CODE,
    limit = 40,
  } = body as {
    topic: string;
    clusterId?: string;
    locationCode?: number;
    limit?: number;
  };

  if (!topic?.trim()) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  // --- Phase 1: Generate seeds ----------------------------------------
  const seeds = await generateSeeds(topic, apiKey);
  console.log("[research-engine] Seeds:", seeds);

  if (seeds.length === 0) {
    return NextResponse.json({ error: "Could not generate keyword seeds" }, { status: 502 });
  }

  // --- Phase 2: Round 1 expansion ------------------------------------
  const round1Results = await Promise.all(
    seeds.map((s) => fetchRelatedWithFallback(s, locationCode, 25)
      .then((r) => { console.log(`[research-engine] R1 "${s}" -> ${r.length}`); return r; })
    )
  );

  const seen = new Set<string>();
  const pool1 = round1Results
    .flat()
    .filter((k) => {
      const key = k.keyword.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  console.log(`[research-engine] Round 1 pool: ${pool1.length}`);

  // --- Phase 3: Round 2 — go deeper from top results ----------------
  const round2Seeds = pool1.slice(0, 5).map((k) => k.keyword);
  const round2Results = await Promise.all(
    round2Seeds.map((s) => fetchRelatedWithFallback(s, locationCode, 20)
      .then((r) => { console.log(`[research-engine] R2 "${s}" -> ${r.length}`); return r; })
    )
  );

  const allSeen = new Set(seen);
  const combined = [
    ...pool1,
    ...round2Results.flat().filter((k) => {
      const key = k.keyword.toLowerCase();
      if (allSeen.has(key)) return false;
      allSeen.add(key);
      return true;
    }),
  ].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  console.log(`[research-engine] Combined pool: ${combined.length}`);

  // --- Phase 4: Claude scoring ---------------------------------------
  const toScore = combined.slice(0, 60);
  const scored = await scoreKeywords(toScore, topic, apiKey);

  // Filter low audience fit, sort by opportunity
  const results = scored
    .filter((k) => k.audience_fit >= 2)
    .sort((a, b) => b.opportunity - a.opportunity)
    .slice(0, limit);

  console.log(`[research-engine] Final: ${results.length}`);

  return NextResponse.json({
    results,
    seeds,
    totalScanned: combined.length,
    clusterId,
  });
}
