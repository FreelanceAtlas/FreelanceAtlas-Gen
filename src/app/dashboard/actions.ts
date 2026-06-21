"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { ORIGINALITY_PASS_THRESHOLD } from "@/lib/originality";

export async function updateAffiliateLink(id: string, url: string, isActive: boolean) {
  const supabase = createClient();
  const { error } = await supabase
    .from("affiliate_links")
    .update({ url: url || null, is_active: isActive })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/affiliate-links");
}

export async function createAffiliateLink(input: {
  label: string;
  category: string;
  triggerKeywords: string[];
  url: string;
  isActive: boolean;
}) {
  if (!input.label.trim()) throw new Error("Tool name is required");

  const supabase = createClient();
  const { error } = await supabase.from("affiliate_links").insert({
    label: input.label.trim(),
    category: input.category.trim() || null,
    trigger_keywords: input.triggerKeywords,
    url: input.url.trim() || null,
    is_active: input.isActive,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/affiliate-links");
}

export async function deleteAffiliateLink(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("affiliate_links").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/affiliate-links");
}

// Originality gate: an article cannot move to "published" while its originality_check
// score is below the pass threshold (or otherwise flagged needs_review), unless the
// caller explicitly force-publishes — same override pattern as the duplicate-content
// guard in /api/generate. This is the actual enforcement point; the article page panel
// is just the visibility into why a publish attempt was blocked.
export async function updateArticleStatus(articleId: string, status: string, force = false) {
  const supabase = createClient();

  if (status === "published" && !force) {
    const { data: article, error: fetchError } = await supabase
      .from("articles")
      .select("originality_check")
      .eq("id", articleId)
      .single();

    if (fetchError) throw new Error(fetchError.message);

    const check = article?.originality_check as
      | { originality_score: number; needs_review: boolean }
      | null;

    if (check && (check.needs_review || check.originality_score < ORIGINALITY_PASS_THRESHOLD)) {
      throw new Error(
        `Originality gate: this draft scored ${check.originality_score}/100 (needs ${ORIGINALITY_PASS_THRESHOLD}+ to publish). ` +
          `Rewrite the flagged passages and regenerate, or use "Publish anyway" to override.`
      );
    }
  }

  const { error } = await supabase.from("articles").update({ status }).eq("id", articleId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/articles");
}
