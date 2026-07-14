import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateArticle,
  redactFiguresFlaggedByFactCheck,
  redactDescriptiveClaimsFlaggedByFactCheck,
} from "@/lib/generate";
import { factCheckArticle } from "@/lib/factcheck";
import { checkOriginality } from "@/lib/originality";
import {
  slugify,
  findDuplicates,
  applyAffiliateLinks,
  buildKeywordTable,
  pickSupportingKeywords,
  buildInternalLinkCandidates,
  applyInternalLinks,
} from "@/lib/seo";

// generateArticle() now runs an internal self-correction gate (fact-check, optional
// one-shot revision, optional re-check) before returning, on top of this route's own
// fact-check + originality calls. That's up to ~6 sequential LLM round-trips per
// request, so the platform default timeout no longer has enough margin.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = createClient();

  const body = await request.json();
  const {
    clusterId,
    primaryKeyword,
    supportingKeywords = [],
    sources = [],
    notes = "",
    suggestedFaqs = [],
    force = false,
  } = body as {
    clusterId: string;
    primaryKeyword: string;
    supportingKeywords: string[];
    sources: { url: string; title: string; publishedDate?: string }[];
    notes?: string;
    suggestedFaqs?: string[];
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

  // If the editor didn't pick supporting keywords, auto-pick relevant unused ones
  // from the cluster bank so generation is fully hands-off.
  const effectiveSupporting = supportingKeywords.length
    ? supportingKeywords
    : pickSupportingKeywords(primaryKeyword, clusterKeywords ?? []);

  // fetchedSources carries the actual page text Claude fetched via web_fetch while
  // writing the draft (see src/lib/generate.ts). It's threaded into factCheckArticle
  // below as ground truth, so the fact-check gate can reject a cited number that the
  // writer didn't actually verify, instead of just judging plausibility from its own
  // training knowledge — a prompt-only fix on the writer side alone wasn't enough.
  // generateArticle also now runs this same fact-check internally (the self-correction
  // gate) and attempts one bounded fix before returning, so by the time we get here the
  // draft has already had a chance to be auto-corrected, not just flagged.
  const { article: generated, fetchedSources } = await generateArticle({
    clusterName: cluster.name,
    primaryKeyword,
    supportingKeywords: effectiveSupporting,
    sources,
    notes,
    suggestedFaqs,
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

  // --- Auto internal linking -----------------------------------------------------
  // If the primary or any supporting keyword is already covered by another live blog
  // (a published generated article, or a scraped existing post), link that keyword's
  // first mention to it. Runs after affiliate links; applyInternalLinks skips text
  // that's already inside a link, so the two never collide.
  const [{ data: liveArticles }, { data: existingPosts }] = await Promise.all([
    supabase
      .from("articles")
      .select("slug, title, keyword_table")
      .or("status.eq.published,wp_status.eq.published"),
    supabase.from("existing_content").select("slug, title, source_url"),
  ]);

  const articleTerms = [primaryKeyword, ...effectiveSupporting].map((kw) => ({
    keyword: kw,
    surface:
      usage.find((u) => u.original.toLowerCase() === kw.toLowerCase())?.used_as || kw,
  }));

  const linkCandidates = buildInternalLinkCandidates(
    articleTerms,
    liveArticles ?? [],
    existingPosts ?? [],
    slug
  );
  const { content: contentWithInternalLinks, used: internalLinksUsed } = applyInternalLinks(
    generated.content_md,
    linkCandidates
  );
  generated.content_md = contentWithInternalLinks;

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

  // --- Fact-check + originality check, run in parallel --------------------------
  // Both are non-blocking at save time (the draft is always saved either way), but
  // each result gates something downstream: fact_check surfaces an accuracy score and
  // a list of claims for editor review, and originality_check's score gates the
  // *publish* transition (see updateArticleStatus in src/app/dashboard/actions.ts).
  // factCheckArticle is passed fetchedSources (the real page text fetched during
  // generation) so it can verify cited numbers against what was actually fetched, not
  // just judge plausibility — see src/lib/factcheck.ts. This re-check runs again
  // post-affiliate-link insertion and is the authoritative, stored result (independent
  // of, and run after, generateArticle's own internal self-correction pass).
  // checkOriginality has no dependency on factCheck's result, so the two run via
  // Promise.all rather than sequential awaits — that was costing a full extra LLM
  // round-trip on every request's critical path for no reason.
  const [factCheck, originalityCheck] = await Promise.all([
    factCheckArticle(generated.content_md, generated.faqs, sources, fetchedSources),
    checkOriginality(generated.content_md, sources),
  ]);

  // --- Round 9: re-apply the fact-check-issues redaction backstop against the
  // AUTHORITATIVE fact-check result, not just generateArticle's internal one. -------------
  // generateArticle() already runs redactFiguresFlaggedByFactCheck once, internally, against
  // its own self-correction loop's bestCheck. But bestCheck is one specific LLM fact-check call
  // made *during* generation; factCheck above is a separate, later LLM fact-check call against
  // the same final text, and the two don't always agree — live retesting found a real case
  // (Trello "10 collaborators" / "10 boards" / "250 workspace command runs per month") that
  // this authoritative check flagged HIGH but the internal pass either missed or didn't act on
  // in time, so it reached the stored article completely unredacted, with needs_review left
  // true for an editor to catch by hand instead of being fixed automatically like every other
  // HIGH severity figure fabrication this round-8 backstop was built to handle.
  //
  // Re-running the same deterministic, idempotent redaction here — keyed off factCheck.issues,
  // the actual issues list that gets persisted and shown to the editor — closes that gap
  // regardless of why the internal pass missed it. Figures already redacted by the internal
  // pass simply won't match again (toRedact won't find that literal substring), so this is a
  // strict improvement, never a regression: anything the internal pass already caught is a
  // no-op here, and anything only the authoritative check catches now gets fixed too, instead
  // of only ever being flagged.
  // Round 12: pass cluster.name + primaryKeyword through too — see the Round 12 comment in
  // generate.ts above buildCompanyKeys/extractCompanyKeysFromTopic for why source-hostname-only
  // company detection isn't reliable when the AI fetches third-party aggregator pages instead of
  // a vendor's own pricing page.
  // Round 13: also apply the descriptive (non-numeric) claim backstop against the
  // authoritative factCheck.issues, for the same reason Round 9 re-applies the figure
  // backstop here — see the Round 13 comment in generate.ts above
  // redactDescriptiveClaimsFlaggedByFactCheck for what this catches that the figure-only
  // backstops above it cannot (e.g. "unlimited Power-Ups" with no number attached).
  const figureRedacted = redactFiguresFlaggedByFactCheck(
    generated,
    factCheck.issues,
    fetchedSources,
    `${cluster.name} ${primaryKeyword}`
  );
  const finalRedacted = redactDescriptiveClaimsFlaggedByFactCheck(figureRedacted, factCheck.issues);
  generated.title = finalRedacted.title;
  generated.meta_title = finalRedacted.meta_title;
  generated.meta_description = finalRedacted.meta_description;
  generated.h1 = finalRedacted.h1;
  generated.content_md = finalRedacted.content_md;
  generated.faqs = finalRedacted.faqs;

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
      internal_links_used: internalLinksUsed,
      fact_check: factCheck,
      originality_check: originalityCheck,
      status: "draft",
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
    input_topic: primaryKeyword,
    cluster_id: clusterId,
    duplicate_warning: false,
    duplicate_matches: [],
    article_id: article.id,
  });

  return NextResponse.json({ article });
}
