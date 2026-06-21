"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { checkOriginality, rewriteFlaggedPassages, ORIGINALITY_PASS_THRESHOLD } from "@/lib/originality";
import { factCheckArticle, FACT_CHECK_PASS_THRESHOLD } from "@/lib/factcheck";

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

// Publish gates: an article cannot move to "published" while EITHER its
// originality_score or its fact-check accuracy_score is below its pass
// threshold (or otherwise flagged needs_review), unless the caller explicitly
// force-publishes — same override pattern as the duplicate-content guard in
// /api/generate. Originality is narrowed to flag only verbatim/near-verbatim
// copied wording (true plagiarism), not paraphrase or structure, so this gate
// only blocks on actual copied text. Fact-check blocks on misinformation.
export async function updateArticleStatus(articleId: string, status: string, force = false) {
  const supabase = createClient();

  if (status === "published" && !force) {
    const { data: article, error: fetchError } = await supabase
      .from("articles")
      .select("originality_check, fact_check")
      .eq("id", articleId)
      .single();

    if (fetchError) throw new Error(fetchError.message);

    const originality = article?.originality_check as
      | { originality_score: number; needs_review: boolean }
      | null;
    const factCheck = article?.fact_check as
      | { accuracy_score: number; needs_review: boolean }
      | null;

    const originalityFailed =
      !!originality && (originality.needs_review || originality.originality_score < ORIGINALITY_PASS_THRESHOLD);
    const factCheckFailed =
      !!factCheck && (factCheck.needs_review || factCheck.accuracy_score < FACT_CHECK_PASS_THRESHOLD);

    if (originalityFailed && factCheckFailed) {
      throw new Error(
        `Originality gate & Fact-check gate: this draft scored ${originality!.originality_score}/100 originality ` +
          `(needs ${ORIGINALITY_PASS_THRESHOLD}+) and ${factCheck!.accuracy_score}/100 accuracy (needs ` +
          `${FACT_CHECK_PASS_THRESHOLD}+). Fix the flagged passages and claims, or use "Publish anyway" to override.`
      );
    }
    if (originalityFailed) {
      throw new Error(
        `Originality gate: this draft scored ${originality!.originality_score}/100 (needs ${ORIGINALITY_PASS_THRESHOLD}+ to publish). ` +
          `Rewrite the flagged copied passages, or use "Publish anyway" to override.`
      );
    }
    if (factCheckFailed) {
      throw new Error(
        `Fact-check gate: this draft scored ${factCheck!.accuracy_score}/100 (needs ${FACT_CHECK_PASS_THRESHOLD}+ to publish). ` +
          `Review the flagged claims and fix or regenerate, or use "Publish anyway" to override.`
      );
    }
  }

  const { error } = await supabase.from("articles").update({ status }).eq("id", articleId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/articles");
}

// Re-run the originality and fact checks against an article's existing stored
// content, in place — no new article row is created. This exists for drafts
// whose stored check result is stale (e.g. computed before a bugfix to the
// check itself, such as the max_tokens 2048->8192 truncation fix), so an
// editor can refresh the score without burning a full regeneration.
export async function recheckArticleChecks(articleId: string) {
  const supabase = createClient();

  const { data: article, error: fetchError } = await supabase
    .from("articles")
    .select("content_md, faqs, sources, slug")
    .eq("id", articleId)
    .single();

  if (fetchError) throw new Error(fetchError.message);
  if (!article) throw new Error("Article not found");

  const sources = article.sources ?? [];
  const faqs = article.faqs ?? [];

  const [originalityCheck, factCheck] = await Promise.all([
    checkOriginality(article.content_md, sources),
    factCheckArticle(article.content_md, faqs, sources),
  ]);

  const { error: updateError } = await supabase
    .from("articles")
    .update({ originality_check: originalityCheck, fact_check: factCheck })
    .eq("id", articleId);

  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/dashboard/articles/${article.slug}`);

  return { originalityCheck, factCheck };
}

// Auto-rewrite: takes the article's CURRENT originality_check.issues (whatever the last
// check found) and asks the model to rewrite just those flagged passages — same facts,
// original phrasing/examples/framing — leaving the rest of the article untouched. Saves
// the new content_md, then re-runs both checks against it so the panel reflects the
// rewrite immediately, in the same row (no new article created).
export async function rewriteFlaggedOriginality(articleId: string) {
  const supabase = createClient();

  const { data: article, error: fetchError } = await supabase
    .from("articles")
    .select("content_md, faqs, sources, slug, originality_check")
    .eq("id", articleId)
    .single();

  if (fetchError) throw new Error(fetchError.message);
  if (!article) throw new Error("Article not found");

  const sources = article.sources ?? [];
  const faqs = article.faqs ?? [];
  const existingCheck = article.originality_check as
    | { issues?: { excerpt: string; likely_source: string; concern: string; severity: "low" | "medium" | "high" }[] }
    | null;
  const issues = existingCheck?.issues ?? [];

  if (issues.length === 0) {
    throw new Error("No flagged passages to rewrite — run a recheck first, or this article has none.");
  }

  const rewrite = await rewriteFlaggedPassages(article.content_md, issues, sources);
  if (!rewrite.rewritten) {
    throw new Error(rewrite.error ?? "Rewrite did not produce any changes.");
  }

  const [originalityCheck, factCheck] = await Promise.all([
    checkOriginality(rewrite.content_md, sources),
    factCheckArticle(rewrite.content_md, faqs, sources),
  ]);

  const { error: updateError } = await supabase
    .from("articles")
    .update({
      content_md: rewrite.content_md,
      originality_check: originalityCheck,
      fact_check: factCheck,
    })
    .eq("id", articleId);

  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/dashboard/articles/${article.slug}`);

  return { originalityCheck, factCheck };
}
