// POST /api/keywords/save
// Direct upsert of already-fetched keyword data into a cluster.
// Used by the manual keyword research tool — no DataForSEO call needed
// since the caller already has volume/difficulty/cpc from a prior search.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface KwPayload {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: unknown[];
  search_intent: string | null;
}

export async function POST(request: Request) {
  const supabase = createClient();

  const { clusterId, keywords } = (await request.json()) as {
    clusterId?: string;
    keywords?: KwPayload[];
  };

  if (!clusterId || !keywords?.length) {
    return NextResponse.json({ error: "clusterId and keywords required" }, { status: 400 });
  }

  const rows = keywords.map((kw) => ({
    cluster_id: clusterId,
    keyword: kw.keyword,
    search_intent: kw.search_intent ?? "informational",
    research_source: "DataForSEO/manual",
    volume: kw.volume,
    difficulty: kw.difficulty,
    cpc: kw.cpc,
    competition: kw.competition,
    trend: Array.isArray(kw.trend) && kw.trend.length > 0 ? kw.trend : null,
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

  const { error } = await supabase
    .from("keywords")
    .upsert(rows, { onConflict: "cluster_id,keyword", ignoreDuplicates: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved: rows.length });
}
