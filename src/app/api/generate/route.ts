import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateArticle } from "@/lib/generate";
import { slugify, findDuplicates, applyAffiliateLinks, buildKeywordTable } from "@/lib/seo";

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const {
    clusterId,
    primaryKeyword,
    supportingKeywords = [],
    sources = [],
    notes = "",
    force = false,
  } = body as {
    clusterId: string;
    primaryKeyword: string;
    supportingKeywords: string[];
    sources: { url: string; title: string; publishedDate?: string }[];
    notes?: string;
    force?: boolean;
  };

  if (!clusterId || !primaryKeyword) {
    return NextResponse.json({ error: "clusterId and primaryKeyword are required" }, { status: 400 });
  }

  const { data: cluster } = await supabase.from("clusters").select("*").eq("id", clusterId).single();
  if (!cluster) {
    return NextResponse.json({ error: "Unknown cluster" }, { status: 404 });
  }

  // --- Duplicate-content guard -------------------------------------------------
  const { data: existing } = await supabase.from("existing_content").select("slug, title");
  const { data: priorArticles } = await supabase.from("articles").select("slug, title");
  const allExisting = [...(existing ?? []), ...(priorArticles ?? [])];
  const duplicateMatches = findDuplicates(primaryKeyword, allExisting);

  if (duplicateMatches.length > 0 && !force) {
    await supabase.from("generation_logs").insert({
      user_id: user.id,
      input_topic: primaryKeyword,
      cluster_id: clusterId,
      duplicate_warning: true,
      duplicate_matches: duplicateMatches,
    });
    return NextResponse.json(
      { duplicate: true, matches: duplicateMatches },
      { status: 409 }
    );
  }

  // --- Generate ------------------------------------------------------------
  const { data: clusterKeywords } = await supabase
    .from("keywords")
    .select("*")
    .eq("cluster_id", clusterId);

  const generated = await generateArticle({
    clusterName: cluster.name,
    primaryKeyword,
    supportingKeywords,
    sources,
    notes,
  });

  // --- Auto-apply affiliate links wherever a tracked tool is mentioned ----------
  const { data: affiliateLinks } = await supabase
    .from("affiliate_links")
    .select("id, label, url, trigger_keywords")
    .eq("is_active", true);

  const { content: contentWithAffiliateLinks, used: affiliateLinksUsed } = applyAffiliateLinks(
    generated.content_md,
    affiliateLinks ?? []
  );
  generated.content_md = contentWithAffiliateLinks;

  const slug = slugify(generated.title);

  const keywordRecords = (clusterKeywords ?? []).filter((k) =>
    generated.keywords_used.some((u) => u.toLowerCase() === k.keyword.toLowerCase())
  );

  // Fall back gracefully if an older model response didn't include keyword_usage —
  // treat every keyword as used verbatim (original === used_as) rather than dropping it.
  const usage =
    generated.keyword_usage?.length
      ? generated.keyword_usage
      : generated.keywords_used.map((kw) => ({ original: kw, used_as: kw }));

  const keywordTable = buildKeywordTable(
    generated.content_md,
    usage,
    (clusterKeywords ?? []).map((k) => ({
      keyword: k.keyword,
      cluster: cluster.name,
      search_intent: k.search_intent,
      research_source: k.research_source ?? (sources[0]?.title ?? "Editorial research"),
    }))
  );

  const { data: article, error } = await supabase
    .from("articles")
    .insert({
      cluster_id: clusterId,
      title: generated.title,
      slug,
      meta_title: generated.meta_title,
      meta_description: generated.meta_description,
      h1: generated.h1,
      content_md: generated.content_md,
      faqs: generated.faqs,
      keyword_table: keywordTable,
      sources,
      affiliate_links_used: affiliateLinksUsed,
      status: "draft",
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (keywordRecords.length > 0) {
    await supabase
      .from("keywords")
      .update({ is_used: true })
      .in("id", keywordRecords.map((k) => k.id));
  }

  await supabase.from("generation_logs").insert({
    user_id: user.id,
    input_topic: primaryKeyword,
    cluster_id: clusterId,
    duplicate_warning: false,
    duplicate_matches: [],
    article_id: article.id,
  });

  return NextResponse.json({ article });
}
