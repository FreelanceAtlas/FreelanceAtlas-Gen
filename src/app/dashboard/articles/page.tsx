import { createClient } from "@/lib/supabase/server";
import { ORIGINALITY_PASS_THRESHOLD } from "@/lib/originality";
import { FACT_CHECK_PASS_THRESHOLD } from "@/lib/factcheck";
import ArticlesManager, { ArticleRow } from "@/components/ArticlesManager";

export default async function ArticlesPage() {
  const supabase = createClient();
  const { data: articles } = await supabase
    .from("articles")
    .select(
      "id, title, slug, status, created_at, scheduled_publish_at, originality_check, fact_check, wp_post_id, wp_edit_link, wp_status, thumbnail_url, clusters(name)"
    )
    .order("created_at", { ascending: false });

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
      clusterName: a.clusters?.name ?? null,
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
