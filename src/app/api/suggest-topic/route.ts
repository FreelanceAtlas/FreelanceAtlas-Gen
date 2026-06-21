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
    return NextResponse.json(suggestion);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not suggest a topic" }, { status: 500 });
  }
}
