import { createClient } from "@/lib/supabase/server";
import { ORIGINALITY_PASS_THRESHOLD } from "@/lib/originality";
import { FACT_CHECK_PASS_THRESHOLD } from "@/lib/factcheck";
import ArticlesManager, { ArticleRow } from "@/components/ArticlesManager";

export default async function ArticlesPage() {
  const supabase = createClient();

  // Select "*" (never 400s on a missing column) and resolve cluster names via a
  // separate lookup instead of a PostgREST embed — the embed requires a declared
  // articles->clusters FK constraint, which, if absent, would fail the whole query
  // and leave this tab empty even though the drafts exist.
  const [{ data: articles, error: articlesError }, { data: clusters }] = await Promise.all([
    supabase.from("articles").select("*").order("created_at", { ascending: false }),
    supabase.from("clusters").select("id, name"),
  ]);

  if (articlesError) {
    console.error("[articles] query failed:", articlesError);
  }

  const clusterNameById = new Map<string, string>(
    (clusters ?? []).map((c: any) => [c.id, c.name])
  );

  const rows: ArticleRow[] = (articles ?? []).map((a: any) => {
    const originality = a.originality_check as { originality_score: number; needs_review: boolean } | null;
    const factCheck = a.fact_check as { accuracy_score: number; needs_review: boolean } | null;

    const originalityOk =
      !!originality && !originality.needs_review && originality.originality_score >= ORIGINALITY_PASS_THRESHOLD;
    const factCheckOk =
      !!factCheck && !factCheck.needs_review && factCheck.accuracy_score >= FACT_CHECK_PASS_THRESHOLD;

    return {
      id: a.id,
      title: a.title,
      slug: a.slug,
      status: a.status,
      clusterName: a.cluster_id ? clusterNameById.get(a.cluster_id) ?? null : null,
      originalityScore: originality?.originality_score ?? null,
      originalityNeedsReview: originality?.needs_review ?? false,
      factCheckScore: factCheck?.accuracy_score ?? null,
      factCheckNeedsReview: factCheck?.needs_review ?? false,
      scheduledPublishAt: a.scheduled_publish_at ?? null,
      ready: originalityOk && factCheckOk,
      wpPostId: a.wp_post_id ?? null,
      wpEditLink: a.wp_edit_link ?? null,
      wpStatus: a.wp_status ?? null,
      thumbnailUrl: a.thumbnail_url ?? null,
    };
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-atlasnavy">Articles</h1>
      <div className="mt-6">
        <ArticlesManager articles={rows} />
      </div>
    </div>
  );
}
