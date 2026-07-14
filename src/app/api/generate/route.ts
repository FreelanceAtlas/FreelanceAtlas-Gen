import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateArticle,
  regenerateDraftBody,
  redactFiguresFlaggedByFactCheck,
  redactDescriptiveClaimsFlaggedByFactCheck,
  type GeneratedArticle,
} from "@/lib/generate";
import { fetchSourcesText } from "@/lib/fetchSourceText";
import { factCheckViaOpenRouter, checkOriginalityViaOpenRouter } from "@/lib/redoScoring";
import { FACT_CHECK_PASS_THRESHOLD } from "@/lib/factcheck";
import { ORIGINALITY_PASS_THRESHOLD } from "@/lib/originality";
import { stripDashes } from "@/lib/textClean";
import {
  slugify,
  findDuplicates,
  applyAffiliateLinks,
  buildKeywordTable,
  pickSupportingKeywords,
  buildInternalLinkCandidates,
  applyInternalLinks,
} from "@/lib/seo";

// The route now runs: server-side source pre-fetch -> generation (writer grounded in the
// real page text) -> grounded OpenRouter scoring -> save draft -> bounded auto-redo loop
// (the same surgical fix machinery as the Redo button) -> update. Several sequential LLM
// round-trips, so keep the maximum duration.
export const maxDuration = 300;

// A generation_logs row younger than this with no article_id yet counts as an IN-FLIGHT
// generation for the duplicate guard, so two parallel requests for near-identical topics
// can't both slip past a guard that only looks at saved articles. Older rows are treated
// as dead (crashed/timed-out runs) and ignored.
const IN_FLIGHT_WINDOW_MS = 15 * 60 * 1000;

// Auto-redo loop bounds. The loop only STARTS a new round while total elapsed route time is
// under this ceiling; the draft is already saved before the loop begins, so even a
// worst-case overrun that hits the platform's 300s kill only loses the improvement round,
// never the article.
const AUTO_REDO_DEADLINE_MS = 175_000;
const AUTO_REDO_MAX_ATTEMPTS = 2;
const AUTO_REDO_REWRITE_TIMEOUT_MS = 70_000;

const isOrigOk = (o: { originality_score: number; needs_review: boolean }) =>
  !o.needs_review && o.originality_score >= ORIGINALITY_PASS_THRESHOLD;
const isFactOk = (f: { accuracy_score: number; needs_review: boolean }) =>
  !f.needs_review && f.accuracy_score >= FACT_CHECK_PASS_THRESHOLD;

// Grounded scoring, identical to the Redo path (OpenRouter/claude-sonnet-4.5 against the
// real fetched page text) — the setup proven to evaluate these figure-heavy drafts
// correctly, unlike the noisier generation-time Anthropic checkers this route used before.
async function scoreCandidate(
  contentMd: string,
  faqs: { question: string; answer: string }[],
  fetched: Record<string, string>
) {
  const [orig, fact] = await Promise.all([
    checkOriginalityViaOpenRouter(contentMd),
    factCheckViaOpenRouter(contentMd, faqs, fetched),
  ]);
  const passes = isOrigOk(orig) && isFactOk(fact);
  const rank = (passes ? 1000 : 0) + orig.originality_score + fact.accuracy_score;
  return { contentMd, faqs, orig, fact, passes, rank };
}

// Applies the deterministic figure/descriptive redaction backstops to whatever is about to
// be persisted, keyed off that candidate's own fact-check issues (same as before, just
// factored out because the route now persists up to twice: baseline draft, then the
// auto-redo improvement).
function applyRedactionBackstops(
  article: GeneratedArticle,
  issues: { claim: string; concern: string; severity: "low" | "medium" | "high" }[],
  fetchedSources: Record<string, string>,
  topicHint: string
): GeneratedArticle {
  const figureRedacted = redactFiguresFlaggedByFactCheck(article, issues, fetchedSources, topicHint);
  return redactDescriptiveClaimsFlaggedByFactCheck(figureRedacted, issues);
}

export async function POST(request: Request) {
  const routeStartedAt = Date.now();
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

  // --- Duplicate-content guard (saved articles + IN-FLIGHT parallel generations) --------
  const inFlightCutoff = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString();
  const [{ data: existing }, { data: priorArticles }, { data: inFlightLogs }] = await Promise.all([
    supabase.from("existing_content").select("slug, title"),
    supabase.from("articles").select("slug, title"),
    supabase
      .from("generation_logs")
      .select("input_topic")
      .is("article_id", null)
      .eq("duplicate_warning", false)
      .gte("created_at", inFlightCutoff),
  ]);
  const allExisting = [
    ...(existing ?? []),
    ...(priorArticles ?? []),
    ...(inFlightLogs ?? []).map((l) => ({ slug: "(generating right now)", title: l.input_topic ?? "" })),
  ];
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

  // Register this run as in-flight BEFORE the long generation starts, so a parallel request
  // for a near-identical topic hits the guard above instead of generating a duplicate.
  const { data: inFlightLog } = await supabase
    .from("generation_logs")
    .insert({
      input_topic: primaryKeyword,
      cluster_id: clusterId,
      duplicate_warning: false,
      duplicate_matches: [],
    })
    .select("id")
    .single();

  // --- Supporting keywords: pick, then CLAIM up front ----------------------------------
  const { data: clusterKeywords } = await supabase
    .from("keywords")
    .select("*")
    .eq("cluster_id", clusterId);

  // If the editor didn't pick supporting keywords, auto-pick relevant unused ones
  // from the cluster bank so generation is fully hands-off.
  const effectiveSupporting = supportingKeywords.length
    ? supportingKeywords
    : pickSupportingKeywords(primaryKeyword, clusterKeywords ?? []);

  // Claim the chosen keywords immediately (is_used = true) so parallel generations on the
  // same cluster auto-pick disjoint sets instead of racing for the same ones. Claimed
  // keywords the model ends up not using — and every claim, if generation fails — are
  // reverted in the cleanup paths below.
  const claimedIds = (clusterKeywords ?? [])
    .filter((k) => !k.is_used && effectiveSupporting.some((s) => s.toLowerCase() === k.keyword.toLowerCase()))
    .map((k) => k.id as string);
  if (claimedIds.length > 0) {
    await supabase.from("keywords").update({ is_used: true }).in("id", claimedIds);
  }

  const releaseClaims = async (ids: string[]) => {
    if (ids.length === 0) return;
    await supabase.from("keywords").update({ is_used: false }).in("id", ids).then(() => {}, () => {});
  };
  const abandonInFlight = async () => {
    if (!inFlightLog?.id) return;
    await supabase.from("generation_logs").delete().eq("id", inFlightLog.id).then(() => {}, () => {});
  };

  try {
    // --- Pre-fetch the sources server-side (real ground truth for the writer) ----------
    // Anthropic's web_fetch fails on JS-rendered vendor/pricing pages; this plain
    // browser-UA fetch gets the real text (see src/lib/fetchSourceText.ts). Feeding it into
    // the writer's prompt is what lets the first draft get figures right instead of
    // fabricating (then getting redacted, then needing a manual Redo).
    const preFetchedSources = await fetchSourcesText(sources);

    // --- Generate -----------------------------------------------------------------------
    const { article: generated, fetchedSources } = await generateArticle({
      clusterName: cluster.name,
      primaryKeyword,
      supportingKeywords: effectiveSupporting,
      sources,
      notes,
      suggestedFaqs,
      preFetchedSources,
    });

    // --- Auto-apply affiliate links wherever a tracked tool is mentioned ----------------
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

    // --- Auto internal linking -----------------------------------------------------------
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

    const topicHint = `${cluster.name} ${primaryKeyword}`;

    // --- Grounded baseline score (same scorers + ground truth as the Redo button) -------
    let best = await scoreCandidate(generated.content_md, generated.faqs, fetchedSources);

    // --- Persist the draft NOW, before the auto-redo loop -------------------------------
    // If a slow improvement round pushes past the platform's 300s kill, the draft (with
    // honest grounded scores) is already saved; only the improvement is lost, and the
    // Redo button picks up from exactly here.
    const baselineRedacted = applyRedactionBackstops(
      { ...generated, content_md: best.contentMd, faqs: best.faqs },
      best.fact.issues,
      fetchedSources,
      topicHint
    );

    const { data: article, error } = await supabase
      .from("articles")
      .insert({
        cluster_id: clusterId,
        title: baselineRedacted.title,
        slug,
        meta_title: baselineRedacted.meta_title,
        meta_description: baselineRedacted.meta_description,
        h1: baselineRedacted.h1,
        content_md: baselineRedacted.content_md,
        faqs: baselineRedacted.faqs,
        keyword_table: keywordTable,
        sources,
        affiliate_links_used: affiliateLinksUsed,
        internal_links_used: internalLinksUsed,
        fact_check: best.fact,
        originality_check: best.orig,
        status: "draft",
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    // Keyword bookkeeping: everything actually used stays claimed; claimed-but-unused goes
    // back to the bank.
    const usedIds = new Set(keywordRecords.map((k) => k.id as string));
    if (keywordRecords.length > 0) {
      await supabase
        .from("keywords")
        .update({ is_used: true })
        .in("id", keywordRecords.map((k) => k.id));
    }
    await releaseClaims(claimedIds.filter((id) => !usedIds.has(id)));

    // Mark the in-flight log as completed by attaching the article id (also what removes it
    // from the in-flight duplicate guard).
    if (inFlightLog?.id) {
      await supabase.from("generation_logs").update({ article_id: article.id }).eq("id", inFlightLog.id);
    } else {
      await supabase.from("generation_logs").insert({
        input_topic: primaryKeyword,
        cluster_id: clusterId,
        duplicate_warning: false,
        duplicate_matches: [],
        article_id: article.id,
      });
    }

    // --- Auto-redo loop: fix what the grounded check flagged, before any human sees it --
    // Same surgical machinery as the Redo button (regenerateDraftBody against the fetched
    // text, re-score, keep the best candidate), run automatically while the route still has
    // time budget. With the writer now grounded up front this usually has little to do.
    let finalArticle = baselineRedacted;
    try {
      for (
        let attempt = 0;
        attempt < AUTO_REDO_MAX_ATTEMPTS &&
        !best.passes &&
        Date.now() - routeStartedAt < AUTO_REDO_DEADLINE_MS;
        attempt++
      ) {
        const origIssues = isOrigOk(best.orig) ? [] : best.orig.issues ?? [];
        const factIssues = isFactOk(best.fact) ? [] : best.fact.issues ?? [];
        if (origIssues.length === 0 && factIssues.length === 0) break;

        const redo = await regenerateDraftBody({
          contentMd: best.contentMd,
          faqs: best.faqs,
          sources,
          originalityIssues: origIssues,
          factIssues,
          fetchedSources,
          timeoutMs: AUTO_REDO_REWRITE_TIMEOUT_MS,
        });
        if (!redo.rewritten) break;

        const candidate = await scoreCandidate(stripDashes(redo.content_md), redo.faqs, fetchedSources);
        if (candidate.rank <= best.rank) break;
        best = candidate;

        finalArticle = applyRedactionBackstops(
          { ...baselineRedacted, content_md: best.contentMd, faqs: best.faqs },
          best.fact.issues,
          fetchedSources,
          topicHint
        );

        const { error: updateError } = await supabase
          .from("articles")
          .update({
            content_md: finalArticle.content_md,
            faqs: finalArticle.faqs,
            fact_check: best.fact,
            originality_check: best.orig,
          })
          .eq("id", article.id);
        if (updateError) break; // draft with baseline scores is already saved — fail soft
      }
    } catch {
      // Best-effort improvement layer — the saved draft above is the fallback.
    }

    return NextResponse.json({
      article: {
        ...article,
        content_md: finalArticle.content_md,
        faqs: finalArticle.faqs,
        fact_check: best.fact,
        originality_check: best.orig,
      },
    });
  } catch (err: any) {
    // Failed generation: release the claimed keywords and drop the in-flight marker so an
    // immediate retry of the same topic isn't blocked or starved of keywords.
    await releaseClaims(claimedIds);
    await abandonInFlight();
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
