// POST /api/keywords/research-engine
import { NextResponse } from "next/server";
import {
  getRelatedKeywords,
  getKeywordIdeas,
  DEFAULT_LOCATION_CODE,
  type KeywordMetrics,
} from "@/lib/dataforseo";

export const maxDuration = 120;

export type KeywordTier = "recommended" | "related" | "check";

const INTENT_WEIGHTS: Record<string, number> = {
  transactional: 1.5, commercial: 1.3, informational: 1.0, navigational: 0.4,
};

export interface ScoredKeyword extends KeywordMetrics {
  intent: string;
  audience_fit: number;
  cluster: string;
  opportunity: number;
  tier: KeywordTier;
}

export interface SeedCategories {
  core: string[];
  adjacent: string[];
  problem: string[];
}

function opportunityScore(kw: KeywordMetrics, audienceFit: number, intent: string): number {
  const vol = Math.max(kw.volume ?? 0, 0);
  const kd = Math.min(Math.max(kw.difficulty ?? 50, 0), 100);
  const intentW = INTENT_WEIGHTS[intent] ?? 1.0;
  const fitW = audienceFit / 5;
  return Math.round(Math.sqrt(vol) * Math.pow(1 - kd / 100, 2) * intentW * fitW * 100);
}

const TIER_ORDER: KeywordTier[] = ["recommended", "related", "check"];
function downgradeTier(tier: KeywordTier): KeywordTier {
  return TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier) + 1, TIER_ORDER.length - 1)];
}

function deriveTier(kw: KeywordMetrics, audienceFit: number, topic: string): KeywordTier {
  const words = kw.keyword.toLowerCase().split(/\s+/);
  const vol = kw.volume ?? 0;
  const topicWords = new Set(
    topic.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4)
  );

  // Single-word → always check
  if (words.length === 1) return "check";

  // Base tier from audience_fit
  let tier: KeywordTier = audienceFit >= 4 ? "recommended" : audienceFit >= 3 ? "related" : "check";

  // Rule 0: Promote — multi-word with topic overlap → bump related → recommended
  if (tier === "related" && words.length >= 2) {
    const hasTopicWord = words.some((w) => w.length >= 4 && topicWords.has(w));
    if (hasTopicWord) tier = "recommended";
  }

  // Rule 2: High-vol short generic with no topic overlap → downgrade
  if (vol > 10_000 && words.length <= 2) {
    const hasTopicWord = words.some((w) => topicWords.has(w));
    if (!hasTopicWord) tier = downgradeTier(tier);
  }

  return tier;
}

async function callClaude(prompt: string, maxTokens: number, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) return "";
  const data = await res.json();
  return (data.content?.[0]?.text ?? "") as string;
}

function parsePhrases(line: string): string[] {
  return line.split(",")
    .map((s) => s.trim().replace(/^[-*\d.)\s]+/, "").toLowerCase())
    .filter((s) => { const words = s.split(/\s+/); return s.length > 3 && words.length >= 2 && words.length <= 4; });
}

async function generateSeeds(topic: string, apiKey: string): Promise<{ seeds: string[]; categories: SeedCategories }> {
  const text = await callClaude(
    `Topic: "${topic}"\nTarget audience: freelancers (designers, writers, developers, consultants) growing their businesses.\n\n` +
    `Generate 3 categories of 2-3 word keyword phrases (noun phrases only, no verbs, no qualifiers).\n\n` +
    `CORE (4 phrases): Noun phrases that directly name this topic or its core concepts\n` +
    `ADJACENT (4 phrases): Related topics a freelancer researching this would also search\n` +
    `PROBLEM (4 phrases): The pain points or problems this topic solves\n\n` +
    `Return exactly:\nCORE: phrase1, phrase2, phrase3, phrase4\nADJACENT: phrase1, phrase2, phrase3, phrase4\nPROBLEM: phrase1, phrase2, phrase3, phrase4`,
    250, apiKey
  );

  const categories: SeedCategories = { core: [], adjacent: [], problem: [] };
  for (const line of text.split("\n")) {
    const cm = line.match(/^CORE:\s*(.+)/i);    if (cm) categories.core = parsePhrases(cm[1]).slice(0, 4);
    const am = line.match(/^ADJACENT:\s*(.+)/i); if (am) categories.adjacent = parsePhrases(am[1]).slice(0, 4);
    const pm = line.match(/^PROBLEM:\s*(.+)/i);  if (pm) categories.problem = parsePhrases(pm[1]).slice(0, 4);
  }
  if (categories.core.length === 0) {
    categories.core = text.split("\n")
      .map((s) => s.trim().replace(/^[-*\d.)\s]+/, "").toLowerCase())
      .filter((s) => { const w = s.split(/\s+/); return s.length > 3 && w.length >= 2 && w.length <= 4; }).slice(0, 6);
  }
  const seeds = [...categories.core, ...categories.adjacent, ...categories.problem];
  console.log("[research-engine] Seeds:", categories);
  return { seeds, categories };
}

async function scoreKeywords(keywords: KeywordMetrics[], topic: string, apiKey: string): Promise<ScoredKeyword[]> {
  if (keywords.length === 0) return [];
  const kwList = keywords.map((k) => k.keyword).join("\n");

  const text = await callClaude(
    `You are a strict keyword relevance judge for FreelanceAtlas.com, targeting freelancers.\n` +
    `Topic: "${topic}"\n\n` +
    `For each keyword score audience_fit 1-5:\n` +
    `  5 = directly about this topic, clearly freelancer-relevant\n` +
    `  4 = adjacent topic a freelancer in this space would care about\n` +
    `  3 = related pain point or lateral need\n` +
    `  2 = loosely related\n` +
    `  1 = unrelated to freelancing or this topic\n\n` +
    `Rule: when in doubt, score lower. Single generic words score 1.\n\n` +
    `Also return intent: informational|commercial|transactional|navigational\n` +
    `and cluster: 2-4 word thematic group name\n\n` +
    `Return ONLY JSON array: [{"keyword":"...","intent":"...","audience_fit":N,"cluster":"..."}]\n\n` +
    `Keywords:\n${kwList}`,
    3500, apiKey
  );

  const fallback = (k: KeywordMetrics): ScoredKeyword => ({
    ...k,
    intent: k.search_intent ?? "informational",
    audience_fit: 3,
    cluster: "General",
    opportunity: opportunityScore(k, 3, k.search_intent ?? "informational"),
    tier: deriveTier(k, 3, topic),
  });

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON");
    const scored = JSON.parse(jsonMatch[0]) as Array<{ keyword: string; intent: string; audience_fit: number; cluster: string }>;
    const scoreMap = new Map(scored.map((s) => [s.keyword.toLowerCase().trim(), s]));
    return keywords.map((k) => {
      const s = scoreMap.get(k.keyword.toLowerCase().trim());
      const intent = s?.intent ?? (k.search_intent ?? "informational");
      const audience_fit = Math.min(Math.max(Math.round(s?.audience_fit ?? 2), 1), 5);
      const cluster = s?.cluster ?? "General";
      const tier = deriveTier(k, audience_fit, topic);
      return { ...k, intent, audience_fit, cluster, opportunity: opportunityScore(k, audience_fit, intent), tier };
    });
  } catch (e) {
    console.error("[research-engine] Score parse failed:", e);
    return keywords.map(fallback);
  }
}

async function fetchRelatedWithFallback(seed: string, locationCode: number, limit: number): Promise<KeywordMetrics[]> {
  try { const r = await getRelatedKeywords(seed, { locationCode, limit }); if (r.length > 0) return r; } catch {}
  try { return await getKeywordIdeas(seed, { locationCode, limit }); } catch { return []; }
}

export async function POST(request: Request) {
  const body = await request.json();
  const { topic, clusterId, locationCode = DEFAULT_LOCATION_CODE, limit = 40 } = body as {
    topic: string; clusterId?: string; locationCode?: number; limit?: number;
  };

  if (!topic?.trim()) return NextResponse.json({ error: "topic is required" }, { status: 400 });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

  const { seeds, categories } = await generateSeeds(topic, apiKey);
  if (seeds.length === 0) return NextResponse.json({ error: "Could not generate seeds" }, { status: 502 });

  const round1 = await Promise.all(
    seeds.map((s) => fetchRelatedWithFallback(s, locationCode, 20)
      .then((r) => { console.log(`[research-engine] R1 "${s}" -> ${r.length}`); return r; }))
  );

  const seen = new Set<string>();
  const pool1 = round1.flat()
    .filter((k) => { const key = k.keyword.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  const round2Seeds = pool1.slice(0, 4).map((k) => k.keyword);
  const round2 = await Promise.all(
    round2Seeds.map((s) => fetchRelatedWithFallback(s, locationCode, 15)
      .then((r) => { console.log(`[research-engine] R2 "${s}" -> ${r.length}`); return r; }))
  );

  const allSeen = new Set(seen);
  const combined = [
    ...pool1,
    ...round2.flat().filter((k) => { const key = k.keyword.toLowerCase(); if (allSeen.has(key)) return false; allSeen.add(key); return true; }),
  ].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  const scored = await scoreKeywords(combined.slice(0, 70), topic, apiKey);

  const TIER_RANK: Record<KeywordTier, number> = { recommended: 0, related: 1, check: 2 };
  const results = scored
    .filter((k) => k.audience_fit >= 3)
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.opportunity - a.opportunity)
    .slice(0, limit);

  console.log(`[research-engine] Final: ${results.length} (${results.filter(k=>k.tier==="recommended").length} rec, ${results.filter(k=>k.tier==="related").length} rel, ${results.filter(k=>k.tier==="check").length} chk)`);

  return NextResponse.json({ results, seeds, seedCategories: categories, totalScanned: combined.length, clusterId });
}
