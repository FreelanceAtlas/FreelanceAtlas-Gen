"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { checkOriginality, rewriteFlaggedPassages, ORIGINALITY_PASS_THRESHOLD } from "@/lib/originality";
import { factCheckArticle, FACT_CHECK_PASS_THRESHOLD } from "@/lib/factcheck";
import { stripDashes } from "@/lib/textClean";
import { formatArticleToDocHtml, createWordPressDraft, publishWordPressPost } from "@/lib/wordpress";
import {
  sceneForTitle,
  renderThumbnail,
  editThumbnail,
  uploadThumbnailToWp,
  fetchImageAsBase64,
} from "@/lib/thumbnail";
import { regenerateDraftBody } from "@/lib/generate";

// Formats a ready article into the live theme's `.doc` HTML (via OpenRouter)
// and pushes it to freelanceatlas.com as a WordPress DRAFT. Returns the WP
// admin edit link so the editor can review/publish it there. Never publishes
// automatically. Best-effort persists the WP post id/link onto the article row
// so the UI can show "already sent" — silently ignored if those columns don't
// exist yet.
export async function sendArticleToWordPress(articleId: string) {
  const supabase = createClient();
  const { data: article, error } = await supabase
    .from("articles")
    .select("h1, title, meta_title, meta_description, slug, content_md, faqs")
    .eq("id", articleId)
    .single();

  if (error || !article) throw new Error(error?.message ?? "Article not found.");

  const bodyHtml = await formatArticleToDocHtml({
    h1: article.h1 ?? "",
    title: article.title ?? article.h1 ?? "",
    meta_title: article.meta_title ?? "",
    meta_description: article.meta_description ?? "",
    slug: article.slug ?? "",
    content_md: article.content_md ?? "",
    faqs: (article.faqs as { question: string; answer: string }[]) ?? [],
  });

  // If a thumbnail was generated for this article, attach it as the featured image.
  const { data: thumb } = await supabase
    .from("articles")
    .select("thumbnail_media_id")
    .eq("id", articleId)
    .single();

  const draft = await createWordPressDraft(
    {
      h1: article.h1 ?? "",
      title: article.title ?? article.h1 ?? "",
      meta_title: article.meta_title ?? "",
      meta_description: article.meta_description ?? "",
      slug: article.slug ?? "",
      content_md: article.content_md ?? "",
      faqs: (article.faqs as { question: string; answer: string }[]) ?? [],
    },
    bodyHtml,
    thumb?.thumbnail_media_id ?? null
  );

  // Record that we pushed it as a draft so the Articles tab can show it in the
  // "Pushed to site as draft" section (requires the wp_* columns to exist).
  await supabase
    .from("articles")
    .update({ wp_post_id: draft.id, wp_edit_link: draft.editLink, wp_status: "draft" })
    .eq("id", articleId);

  revalidatePath("/dashboard/articles");
  revalidatePath(`/dashboard/articles/${article.slug}`);

  return { id: draft.id, editLink: draft.editLink, link: draft.link };
}

// Publishes (makes live) an article that was already pushed to WordPress as a
// draft. Reads the stored wp_post_id, flips the WP post to "publish", and marks
// wp_status = "published" so the Articles tab moves it to the "Live on site"
// section. Used by the "Publish live" button in the pushed-drafts section.
export async function publishArticleToSite(articleId: string) {
  const supabase = createClient();
  const { data: article, error } = await supabase
    .from("articles")
    .select("slug, wp_post_id")
    .eq("id", articleId)
    .single();

  if (error || !article) throw new Error(error?.message ?? "Article not found.");
  if (!article.wp_post_id) throw new Error("This article has not been pushed to WordPress yet.");

  const { link } = await publishWordPressPost(Number(article.wp_post_id));

  await supabase.from("articles").update({ wp_status: "published" }).eq("id", articleId);

  revalidatePath("/dashboard/articles");
  revalidatePath(`/dashboard/articles/${article.slug}`);

  return { link };
}

// Generates a featured-image thumbnail for an article: LLM scene -> Gemini
// render -> upload to WP media library. Stores the media id + url + scene on the
// article so the UI can show it and "Send to WordPress" can attach it. Returns
// the thumbnail url.
export async function generateArticleThumbnail(articleId: string) {
  const supabase = createClient();
  const { data: article, error } = await supabase
    .from("articles")
    .select("title, h1, slug")
    .eq("id", articleId)
    .single();
  if (error || !article) throw new Error(error?.message ?? "Article not found.");

  // Persist a "processing" flag up front so that if the editor refreshes mid-run
  // the UI can show the in-progress state and poll for completion, instead of
  // losing it. This commits immediately, so a concurrent page load sees it even
  // while the (still-running) generation continues.
  await supabase.from("articles").update({ thumbnail_status: "processing" }).eq("id", articleId);
  revalidatePath("/dashboard/articles");

  try {
    const title = article.title || article.h1 || "";
    const scene = await sceneForTitle(title);
    const png = await renderThumbnail(scene);
    const { mediaId, url } = await uploadThumbnailToWp(png, `${article.slug || "article"}-thumb`, title);

    const { error: saveError } = await supabase
      .from("articles")
      .update({
        thumbnail_media_id: mediaId,
        thumbnail_url: url,
        thumbnail_scene: JSON.stringify(scene),
        thumbnail_status: null,
      })
      .eq("id", articleId);

    // The image was uploaded to WP, but if we can't persist the media id/url the
    // thumbnail would vanish on refresh and never attach as the featured image.
    if (saveError) {
      await supabase.from("articles").update({ thumbnail_status: "error" }).eq("id", articleId);
      throw new Error(
        `Thumbnail rendered and uploaded to WordPress (media #${mediaId}), but could not be saved to the article: ${saveError.message}.`
      );
    }

    revalidatePath("/dashboard/articles");
    return { url, mediaId };
  } catch (e) {
    await supabase.from("articles").update({ thumbnail_status: "error" }).eq("id", articleId).then(() => {}, () => {});
    revalidatePath("/dashboard/articles");
    throw e;
  }
}

// Redoes an article's thumbnail from a change note: pulls the last generated
// image, sends it plus the note to Gemini for a revision, uploads the result,
// and updates the stored thumbnail. Returns the new url.
export async function redoArticleThumbnail(articleId: string, changeNote: string) {
  if (!changeNote?.trim()) throw new Error("Add a change note describing what to adjust.");
  const supabase = createClient();
  const { data: article, error } = await supabase
    .from("articles")
    .select("title, h1, slug, thumbnail_url, thumbnail_scene")
    .eq("id", articleId)
    .single();
  if (error || !article) throw new Error(error?.message ?? "Article not found.");
  if (!article.thumbnail_url) throw new Error("Generate a thumbnail first before redoing it.");

  await supabase.from("articles").update({ thumbnail_status: "processing" }).eq("id", articleId);
  revalidatePath("/dashboard/articles");

  try {
    const title = article.title || article.h1 || "";
    let header = title;
    try {
      header = JSON.parse(article.thumbnail_scene || "{}").header || title;
    } catch {}

    const prev = await fetchImageAsBase64(article.thumbnail_url);
    const png = await editThumbnail(prev, changeNote, header);
    const { mediaId, url } = await uploadThumbnailToWp(png, `${article.slug || "article"}-thumb`, title);

    const { error: saveError } = await supabase
      .from("articles")
      .update({ thumbnail_media_id: mediaId, thumbnail_url: url, thumbnail_status: null })
      .eq("id", articleId);

    if (saveError) {
      await supabase.from("articles").update({ thumbnail_status: "error" }).eq("id", articleId);
      throw new Error(
        `New thumbnail uploaded to WordPress (media #${mediaId}), but could not be saved to the article: ${saveError.message}.`
      );
    }

    revalidatePath("/dashboard/articles");
    return { url, mediaId };
  } catch (e) {
    await supabase.from("articles").update({ thumbnail_status: "error" }).eq("id", articleId).then(() => {}, () => {});
    revalidatePath("/dashboard/articles");
    throw e;
  }
}

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

// Manual edit, used by EditArticleControl on the article detail page so an editor
// can fix the body, H1, or meta fields before choosing to publish. Sanitizes em
// dashes and stray dash-hyphens on every save, same as generation and rewrite, so
// hand-edited text can't reintroduce what the generation prompt bans.
export async function updateArticleContent(
  articleId: string,
  input: { h1: string; metaTitle: string; metaDescription: string; contentMd: string }
) {
  const h1 = stripDashes(input.h1.trim());
  const metaTitle = stripDashes(input.metaTitle.trim());
  const metaDescription = stripDashes(input.metaDescription.trim());
  const contentMd = stripDashes(input.contentMd);

  if (!h1 || !metaTitle || !metaDescription || !contentMd.trim()) {
    throw new Error("H1, meta title, meta description, and article body cannot be empty.");
  }

  const supabase = createClient();

  const { data: article, error: fetchError } = await supabase
    .from("articles")
    .select("slug")
    .eq("id", articleId)
    .single();
  if (fetchError) throw new Error(fetchError.message);
  if (!article) throw new Error("Article not found");

  const { error } = await supabase
    .from("articles")
    .update({ h1, meta_title: metaTitle, meta_description: metaDescription, content_md: contentMd })
    .eq("id", articleId);

  if (error) throw new Error(error.message);

  revalidatePath(`/dashboard/articles/${article.slug}`);
}

// Publish gates: an article cannot move to "published" while EITHER its
// originality_score or its fact-check accuracy_score is below its pass
// threshold (or otherwise flagged needs_review), unless the caller explicitly
// force-publishes — same override pattern as the duplicate-content guard in
// /api/generate. Originality is narrowed to flag only verbatim/near-verbatim
// copied wording (true plagiarism), not paraphrase or structure, so this gate
// only blocks on actual copied text. Fact-check blocks on misinformation.
//
// When the move to "published" actually goes through (gates passed, or
// force === true), this also re-sanitizes h1/meta/content_md as a last
// defensive pass for em dashes and stray dash-hyphens, and clears any pending
// scheduled_publish_at (the article is already published, so there is
// nothing left to auto-publish). The [n] keyword reference markers are a
// display-only overlay (applied by highlightKeywords at render time, never
// stored in content_md), so they're hidden for published articles directly
// in the page render rather than here.
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

  if (status === "published") {
    const { data: current, error: contentFetchError } = await supabase
      .from("articles")
      .select("h1, meta_title, meta_description, content_md")
      .eq("id", articleId)
      .single();
    if (contentFetchError) throw new Error(contentFetchError.message);

    const { error } = await supabase
      .from("articles")
      .update({
        status,
        h1: stripDashes(current?.h1 ?? ""),
        meta_title: stripDashes(current?.meta_title ?? ""),
        meta_description: stripDashes(current?.meta_description ?? ""),
        content_md: stripDashes(current?.content_md ?? ""),
        scheduled_publish_at: null,
      })
      .eq("id", articleId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("articles").update({ status }).eq("id", articleId);
    if (error) throw new Error(error.message);
  }

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
// the new content_md (sanitized for em dashes/stray hyphens, same as generation), then
// re-runs both checks against it so the panel reflects the rewrite immediately, in the
// same row (no new article created).
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

  const cleanedContent = stripDashes(rewrite.content_md);

  const [originalityCheck, factCheck] = await Promise.all([
    checkOriginality(cleanedContent, sources),
    factCheckArticle(cleanedContent, faqs, sources),
  ]);

  const { error: updateError } = await supabase
    .from("articles")
    .update({
      content_md: cleanedContent,
      originality_check: originalityCheck,
      fact_check: factCheck,
    })
    .eq("id", articleId);

  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/dashboard/articles/${article.slug}`);

  return { originalityCheck, factCheck };
}

// AI Redo for a failing draft: if the draft's originality and/or fact-check
// scored below its pass threshold, regenerate the WHOLE article body (fixing the
// flagged originality + factual problems), re-score both checks neutrally, and
// save the new content + scores in place. Because "Ready to publish" is computed
// from those scores (see articles/page.tsx + ArticlesManager), a draft that now
// passes both gates automatically moves into the Ready section on the next
// refresh — no status write needed. Returns whether it now passes both gates.
export async function redoDraftArticle(articleId: string): Promise<{
  ranRedo: boolean;
  promoted: boolean;
  originalityScore: number | null;
  factCheckScore: number | null;
  message?: string;
}> {
  const supabase = createClient();

  const { data: article, error: fetchError } = await supabase
    .from("articles")
    .select("content_md, faqs, sources, slug, originality_check, fact_check")
    .eq("id", articleId)
    .single();

  if (fetchError) throw new Error(fetchError.message);
  if (!article) throw new Error("Article not found");

  const sources = article.sources ?? [];
  const faqs = article.faqs ?? [];

  const originality = article.originality_check as
    | { originality_score: number; needs_review: boolean; issues?: { excerpt: string; likely_source: string; concern: string }[] }
    | null;
  const factCheck = article.fact_check as
    | { accuracy_score: number; needs_review: boolean; issues?: { claim: string; concern: string; severity: "low" | "medium" | "high" }[] }
    | null;

  const originalityFailing =
    !originality || originality.needs_review || originality.originality_score < ORIGINALITY_PASS_THRESHOLD;
  const factFailing =
    !factCheck || factCheck.needs_review || factCheck.accuracy_score < FACT_CHECK_PASS_THRESHOLD;

  // Nothing to fix — already passing both gates. Leave it untouched so a redo
  // never risks regressing a good draft.
  if (!originalityFailing && !factFailing) {
    return {
      ranRedo: false,
      promoted: true,
      originalityScore: originality?.originality_score ?? null,
      factCheckScore: factCheck?.accuracy_score ?? null,
      message: "Already passes both gates.",
    };
  }

  // Persist a "processing" flag so a mid-run refresh shows the redo in progress
  // and can poll for completion instead of losing it.
  await supabase.from("articles").update({ redo_status: "processing" }).eq("id", articleId);
  revalidatePath("/dashboard/articles");

  let cleanedContent: string;
  try {
    // Regenerate the whole body, feeding in whichever checks are failing so the
    // model targets the actual problems. If a check is passing we still pass its
    // (empty) issues so the rewrite doesn't undo what already works.
    const redo = await regenerateDraftBody({
      contentMd: article.content_md ?? "",
      sources,
      originalityIssues: originalityFailing ? originality?.issues ?? [] : [],
      factIssues: factFailing ? factCheck?.issues ?? [] : [],
    });

    if (!redo.rewritten) {
      throw new Error(redo.error ?? "Redo did not produce a rewrite.");
    }
    cleanedContent = stripDashes(redo.content_md);
  } catch (e) {
    await supabase.from("articles").update({ redo_status: "error" }).eq("id", articleId).then(() => {}, () => {});
    revalidatePath("/dashboard/articles");
    throw e;
  }

  // Re-score both checks neutrally against the fresh content.
  const [originalityCheck, newFactCheck] = await Promise.all([
    checkOriginality(cleanedContent, sources),
    factCheckArticle(cleanedContent, faqs, sources),
  ]);

  const { error: updateError } = await supabase
    .from("articles")
    .update({
      content_md: cleanedContent,
      originality_check: originalityCheck,
      fact_check: newFactCheck,
      redo_status: null,
    })
    .eq("id", articleId);

  if (updateError) {
    await supabase.from("articles").update({ redo_status: "error" }).eq("id", articleId).then(() => {}, () => {});
    throw new Error(updateError.message);
  }

  const nowOriginalityOk =
    !originalityCheck.needs_review && originalityCheck.originality_score >= ORIGINALITY_PASS_THRESHOLD;
  const nowFactOk = !newFactCheck.needs_review && newFactCheck.accuracy_score >= FACT_CHECK_PASS_THRESHOLD;

  revalidatePath("/dashboard/articles");
  revalidatePath(`/dashboard/articles/${article.slug}`);

  return {
    ranRedo: true,
    promoted: nowOriginalityOk && nowFactOk,
    originalityScore: originalityCheck.originality_score,
    factCheckScore: newFactCheck.accuracy_score,
  };
}

// Schedule a draft (or review) article to auto-publish at a future date/time.
// The actual publish is performed later by the /api/cron/publish-scheduled
// route (triggered by Vercel Cron), which applies the same gate checks and
// sanitize-and-publish logic as a manual "Publish anyway" would. Refuses to
// schedule an already-published article and refuses a time in the past.
export async function scheduleArticle(articleId: string, isoDatetime: string) {
  const when = new Date(isoDatetime);
  if (Number.isNaN(when.getTime())) {
    throw new Error("Invalid date/time.");
  }
  if (when.getTime() <= Date.now()) {
    throw new Error("Scheduled time must be in the future.");
  }

  const supabase = createClient();

  const { data: article, error: fetchError } = await supabase
    .from("articles")
    .select("status")
    .eq("id", articleId)
    .single();
  if (fetchError) throw new Error(fetchError.message);
  if (!article) throw new Error("Article not found");
  if (article.status === "published") {
    throw new Error("This article is already published.");
  }

  const { error } = await supabase
    .from("articles")
    .update({ scheduled_publish_at: when.toISOString() })
    .eq("id", articleId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/articles");
}

export async function unscheduleArticle(articleId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("articles")
    .update({ scheduled_publish_at: null })
    .eq("id", articleId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/articles");
}

// Permanently deletes the given articles. Used by the bulk-select toolbar on
// the Articles list. Irreversible — the client is expected to confirm with
// the user before calling this.
export async function bulkDeleteArticles(articleIds: string[]) {
  if (!articleIds || articleIds.length === 0) return;

  const supabase = createClient();
  const { error } = await supabase.from("articles").delete().in("id", articleIds);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/articles");
}

// Keywords are never hard-deleted from the bank — they're a valuable research
// asset (sourced from Wordstream/SEMrush/Ahrefs/etc.) and stay useful for future
// drafts even after a cluster's article that used them gets removed. This just
// flips a keyword's is_used flag back to false so it reappears as "Available"
// in the keyword bank and becomes selectable again on the Generate form. Used
// by the "Revert to unused" control on the Clusters & keyword bank page.
export async function revertKeywordToUnused(keywordId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("keywords")
    .update({ is_used: false })
    .eq("id", keywordId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/clusters");
  revalidatePath("/dashboard/generate");
}
