import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggestFreshTopic } from "@/lib/suggestTopic";

export async function POST(request: Request) {
  const supabase = createClient();
  const body = await request.json();
  const { clusterId } = body as { clusterId: string };

  if (!clusterId) {
    return NextResponse.json({ error: "clusterId is required" }, { status: 400 });
  }

  const { data: cluster } = await supabase.from("clusters").select("id, name").eq("id", clusterId).single();
  if (!cluster) {
    return NextResponse.json({ error: "Unknown cluster" }, { status: 404 });
  }

  const [{ data: clusterKeywords }, { data: clusterArticles }, { data: existingContent }] = await Promise.all([
    supabase.from("keywords").select("keyword").eq("cluster_id", clusterId),
    supabase.from("articles").select("title").eq("cluster_id", clusterId),
    supabase.from("existing_content").select("title"),
  ]);

  const coveredKeywords = (clusterKeywords ?? []).map((k) => k.keyword);
  const coveredTitles = [
    ...(clusterArticles ?? []).map((a) => a.title),
    ...(existingContent ?? []).map((e) => e.title),
  ];

  try {
    const suggestion = await suggestFreshTopic({
      clusterName: cluster.name,
      coveredKeywords,
      coveredTitles,
    });

    // Save this suggestion to the keyword bank so:
    // 1. It persists for later use even if the user picks a different topic now
    // 2. The next "Suggest a topic" click avoids it (it's now in coveredKeywords)
    await supabase.from("keywords").upsert(
      {
        cluster_id: clusterId,
        keyword: suggestion.topic,
        search_intent: "informational",
        research_source: "ai-suggested",
        is_used: false,
      },
      { onConflict: "cluster_id,keyword", ignoreDuplicates: true }
    );

    return NextResponse.json(suggestion);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not suggest a topic";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
