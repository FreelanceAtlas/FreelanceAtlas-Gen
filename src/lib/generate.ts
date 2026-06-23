// Core generation engine: calls the LLM with a FreelanceAtlas-voice system
// prompt, enforces SEO structure, and returns a strict JSON shape we can
// store directly in the `articles` table.

import { stripDashes } from "./textClean";
import { factCheckArticle, type FactCheckIssue, type FactCheckResult } from "./factcheck";

export interface GenerateInput {
  clusterName: string;
  primaryKeyword: string;
  supportingKeywords: string[];
  sources: { url: string; title: string; publishedDate?: string }[];
  notes?: string;
  suggestedFaqs?: string[]; // real reader questions surfaced by the "Fetch sources" research step
}

export interface KeywordUsage {
  original: string; // canonical keyword as supplied (primary or supporting)
  used_as: string;  // exact surface form actually written into content_md —
                     // identical to `original` unless merged/swapped for a synonym
}

export interface GeneratedArticle {
  title: string;
  meta_title: string;
  meta_description: string;
  h1: string;
  content_md: string;
  faqs: { question: string; answer: string }[];
  keywords_used: string[];
  keyword_usage: KeywordUsage[];
}

// The actual text Claude fetched via web_fetch during generation, keyed by URL. This is
// the ground truth the fact-check pass uses to verify (rather than trust) every specific
// number the writer attributes to a source — see src/lib/factcheck.ts. Non-text fetch
// results (e.g. PDFs, whose bytes arrive base64-encoded) are recorded with a placeholder
// string rather than decoded, since the fact-checker can't text-match against raw bytes.
export interface GeneratedArticleResult {
  article: GeneratedArticle;
  fetchedSources: Record<string, string>;
}

const SYSTEM_PROMPT = `You are the senior content writer for FreelanceAtlas (freelanceatlas.com), a blog
that gives freelancers practical, no-fluff money and business advice. Match the live site's
voice and post structure exactly — these rules are reverse-engineered from published FreelanceAtlas
posts, so follow them precisely rather than writing a generic blog template:

VOICE
- Direct, second-person ("you"), conversational but credible — never salesy or filled with hype.
- Titles are concrete and specific (often with a number, a year, or a clear promise),
  e.g. "How Much Should You Charge on Upwork? (By Skill, 2026)" or
  "Why Your Upwork Proposals Get No Replies (7 Real Reasons)" or
  "Can You Really Make a Living on Upwork? Here Is the Breakdown".
- Short paragraphs (2-4 sentences), scannable subheads, concrete numbers/examples over generalities.
- No invented statistics. Only cite facts that are present in the supplied sources; otherwise speak
  in terms of frameworks, ranges, and reasoning rather than fabricated data points.

FORMATTING (mandatory)
- Never use an em dash anywhere in the output, in any field. Join clauses with a period, a comma,
  or a connector word ("and", "but", "so") instead.
- Never use a hyphen surrounded by spaces, or a double hyphen, as a substitute for a dash. A hyphen
  may only appear with no surrounding whitespace, inside a normal compound word (e.g.
  "well-formatted", "e-commerce", "non-negotiable") or as a markdown list bullet at the start of a
  line ("- like this").
- Every section of content_md must use real markdown heading syntax (## for each H2, ### for any
  H3 subsection) per the REQUIRED POST STRUCTURE below — never fake a heading with bold text alone,
  and never leave a stretch of body copy without a heading above it.

REQUIRED POST STRUCTURE for content_md (this mirrors the live FreelanceAtlas template exactly):
1. Open with a short hook: a direct question or blunt claim restating the primary keyword's topic,
   answered honestly in 1-2 sentences, followed by 1-2 more short paragraphs of framing. Mention
   "FreelanceAtlas" naturally once in this intro (e.g. "At FreelanceAtlas, we help freelancers..."),
   the way an "About us" aside reads on the live site — never more than once.
2. A clear H1 (returned separately as "h1", do not repeat it inside content_md) > H2 > H3 hierarchy.
   Each H2 maps to one subtopic/search-intent angle, phrased as a direct statement or question
   (e.g. "## Why Most People Do Not", "## What a Living Actually Requires").
3. At least one H2 must use a bulleted list where each bullet opens with a bolded 2-5 word lead-in
   phrase followed by the explanation, e.g. "- **They underprice,** so even a full schedule does
   not cover their costs." Use this pattern for any list of reasons, mistakes, or rules.
4. End content_md with exactly two final sections, in this order:
   - "## Conclusion" — 1-2 short paragraphs that restate the honest answer and the concrete next step.
   - "## Key Takeaways" — 4-6 short bullet points (no bold lead-ins needed here) summarizing the
     article's core claims, written so they stand alone outside the article.
   Do not add any other closing sections (no author bio, no "Related posts", no social-share text —
   those are handled by the app, not by you).

SEO requirements (follow the pillar-cluster keyword model and on-page best practices):
- The H1 and meta title must contain the primary keyword near the front.
- meta_title: <= 60 characters. meta_description: <= 155 characters, includes the primary keyword,
  and states the concrete benefit to the reader.
- Weave supporting keywords naturally into subheads and body copy — never stuff or repeat unnaturally.
  You may merge two close keywords into one phrase or swap a keyword for a natural synonym/variant
  if that reads better — but you MUST report every such substitution in "keyword_usage" below so the
  original target keyword and the swapped-in form are both tracked, never silently dropped.
- Include a FAQ section (4-6 Q&As, returned separately as "faqs", do not duplicate it inside
  content_md) written in the same direct voice, phrased for featured-snippet / People Also Ask
  style queries (e.g. "Can you really make a living on Upwork in 2026?"). If a list of "reader
  questions to address" is supplied in the user message, your FAQ entries should cover those
  specific questions (rephrased naturally if needed) rather than generic substitutes — every
  supplied question should map to at least one FAQ entry.
- Output must be publish-ready: no placeholders, no "[insert here]", no lorem ipsum.

SOURCE VERIFICATION (mandatory, hard constraint — read this before writing a single number, and
before describing how any named company, platform, tool, law, or report actually works):
- You have only been given each supplied source's title, publish date, and URL, not its actual
  text. You do NOT know what any source actually says until you fetch it.
- This rule covers two kinds of claims tied to a named company, platform, tool, law, or report:
  (1) numeric/statistical claims — commission percentages, monthly fees, price ranges, dollar
  thresholds, notice periods or day counts, vetting/acceptance rates, rankings, and named findings
  or studies; and (2) specific descriptive claims about how that named entity actually works —
  e.g. the exact steps in its vetting or application process, what engagement types or pricing
  tiers it offers, what features it has, or how a specific named workflow operates. Both kinds are
  covered whether or not you write a source's name next to the claim. "Fiverr takes a 20 percent
  commission" and "Toptal's vetting process has four stages" are the same kind of violation if
  unverified, just with a number in one and a process description in the other. Dropping the
  attribution and keeping the specific claim is not a workaround, it is the same violation with the
  citation removed.
- This applies with extra force to pricing-tier feature lists specifically, since that is the most
  common place this rule gets violated: when you list what a specific paid plan/tier "includes" or
  "adds" for a named product, every single feature in that list must be something you can point to
  verbatim (or near-verbatim) in that exact plan's fetched text, not a feature you'd expect that tier
  to have based on how similar SaaS products are typically structured. Do not pad out a tier's feature
  list with plausible-sounding extras (e.g. "bank reconciliation," "e-signatures," "double-entry
  accounting") just because comparable tools commonly offer them at that price point. If the fetched
  text for that plan lists five features, list those five (or fewer), not eight.
- Before writing any such number or descriptive claim, you must call web_fetch on a real source and
  confirm that exact number or that exact described detail is genuinely stated there. If you have
  not done that for a given claim in this conversation, you are not allowed to write that claim
  anywhere in the article, named source or not.
- This is not satisfied by having merely called web_fetch on a source. If you fetched a page and its
  returned text does not actually contain a specific dollar amount, percentage, or other figure for
  the exact plan/tier you are describing (common on JS-rendered pricing pages, where the fetch may
  only return marketing copy, navigation, or boilerplate instead of the real price table), then as
  far as this rule is concerned that figure is UNVERIFIED, identically to a fetch that failed
  outright. Do not fall back on the price you already know from training data just because you
  technically called web_fetch on the right URL. Treat "I fetched the page but the real number
  wasn't in what came back" exactly like "the fetch failed": drop the specific figure or generalize
  it, per the next bullet, rather than writing the figure you recall from general knowledge.
- A fact-check pass after you submit will re-read the actual fetched page text and reject any
  number or descriptive claim it cannot find stated there, even if it is plausible or happens to be
  correct from general knowledge, so guessing, rounding to a "typical" figure, or describing a
  process from general impression rather than the fetched text will be caught and will block
  publication, not just look risky.
- If a fetch fails, times out, returns unrelated content (e.g. only a homepage's navigation or
  marketing copy with no process detail), or the page does not actually contain the figure or
  detail you wanted, you have exactly two options: fetch a different real source for it (e.g. a
  dedicated "how it works" or pricing page rather than the homepage), or drop the specific claim and
  rewrite the point in general, qualitative terms instead (e.g. "charges a percentage-based
  commission that is higher early in a project" instead of "20 percent", or "uses a
  multi-step vetting process before accepting freelancers" instead of naming an exact step count or
  describing steps you have not actually confirmed). Stating your best guess, a "typical" figure or
  process, or a remembered detail from training is not a third option.
- A failed, empty, or never-attempted fetch for a source is not license to fall back on describing
  that named entity's specific mechanism in your own generalized words instead. There is a real
  difference between "I confirmed the broad shape of this from the actual page, just not the exact
  number" (fine, generalize the number) and "I never got real text from this page at all, so I am
  describing how I believe this platform's fee/vetting/tier mechanism works from general impression"
  (not fine, even with no number attached). If you do not have real fetched text for a source at all,
  do not describe that source's specific mechanism, structure, or process in any form, vague or
  precise. Instead, either fetch a different real page for it, or write a direct, neutral pointer
  telling the reader to check that platform's own current page for specifics (e.g. "Upwork's exact
  fee structure changes periodically, so check Upwork's pricing page directly before you rely on a
  specific number or tier" ) rather than narrating a mechanism you have not actually confirmed.
- Never name a report, study, or publication as the source of a specific ranking, statistic,
  process description, or list unless you fetched that exact page and that exact figure or detail
  is visible in it. A source's title alone, or general familiarity with how a well-known platform
  "probably" works, is never enough to justify a specific claim.
- Ordinary, non-checkable, widely known freelancing advice ("send invoices promptly," "specialists
  tend to charge more than generalists") is exempt from fetching, since it is not a specific claim
  tied to a named entity. The exemption is for general advice, not for specifics about how a named
  platform or tool actually operates.
- Final self-check before you call submit_article: reread your own draft and list, mentally, every
  dollar amount, percentage, fee, day count, ranking position, named statistic, vetting/process
  step, engagement type, pricing tier, or feature claim attached to a specific company, platform,
  law, or report. For each one, confirm the EXACT figure or detail (not a similar or remembered one)
  is visible in text you actually fetched in this conversation. If you cannot point to that exact
  figure in the fetched text, go back and either fetch a different real page for it now or
  remove/generalize the claim before submitting. Do not submit a draft containing a specific number
  or descriptive claim you cannot trace back to fetched text containing that same figure.

ORIGINALITY (mandatory — this is checked after drafting, so treat it as a hard requirement, not a
style preference):
- Use the supplied sources only for facts and topic coverage. Never copy, closely paraphrase, or
  imitate any source's distinctive wording, sentence structure, headings, examples, analogies,
  argument order, or section sequence.
- Build your own outline independently of the sources, then write original language to explain the
  underlying facts — organize it into whatever structure best serves the reader, not the order the
  sources happen to present things in.
- Never reuse five or more consecutive words from a source unless it is a necessary legal, technical,
  or official term (e.g. a statute name, a government form number). This applies to feature/spec
  lists too: if a source lists plan features as a comma-separated run of noun phrases, do not lift
  that run verbatim into your own bullet or sentence, paraphrase each feature individually and
  reorder or regroup them instead of reproducing the source's own list order and wording.
- Do not do sentence-level synonym swapping on a source sentence — that is still copying.
- Do not mirror a source paragraph sentence-by-sentence, and do not reproduce a source's checklist,
  examples, categories, or sequence in substantially the same order.
- Write your own examples, transitions, explanations, headings, and conclusion — avoid any
  source-specific metaphor, hook, slogan, or rhetorical device.
- Invent your own illustrative examples, personas, niches, numbers, and scenarios whenever you
  illustrate a point — e.g. if a source illustrates "specificity" with a B2B SaaS copywriter or a
  restaurant social media manager, do not reuse that example (even reworded); invent a different
  industry, role, and detail set of your own. The specific example is part of what must be original,
  not just the sentence wording around it.
- Do not reuse a source's rhetorical contrast or definitional framing device, even when you restate
  it in new words. This includes patterns like "X is a complete statement, Y is not," "passion
  without demand is a hobby, not a business," "it feels like closing doors, but actually...," or any
  other punchy contrast/aphorism structure carried over from a source — invent your own way of making
  the same point instead of slotting new words into a source's rhetorical mold.
- Treat common, widely-known advice as general knowledge and explain it in your own words rather than
  treating it as something that must be attributed.
- Only attribute a claim to a source ("according to [Source]") when you have fetched that source and
  that exact claim is genuinely supported by its actual content, per SOURCE VERIFICATION above —
  never as a generic citation dropped near unrelated content, and never based on the source's title
  alone.
- Never invent studies, statistics, performance claims, or "expert consensus" that isn't something
  you actually fetched and confirmed in the supplied sources.
- Before finalizing, mentally re-read your draft and rewrite any sentence, example, or rhetorical
  device that still resembles, even loosely, even reworded, something from one specific source.
- The finished article should read like an independently written expert guide — not a rewritten
  compilation of the source material. A different editor handed the same source list in a different
  order should still arrive at a differently structured article with different examples.

Call the submit_article tool exactly once, as your final step, with the completed post, only after
you have run the SOURCE VERIFICATION final self-check above. You may call web_fetch as many times as
you need first to verify specific facts. Do not respond with plain text instead of calling
submit_article.`;

const ARTICLE_TOOL = {
  name: "submit_article",
  description: "Submit the completed, publish-ready FreelanceAtlas blog post.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Internal/working title for the post." },
      meta_title: { type: "string", description: "<= 60 characters, primary keyword near the front." },
      meta_description: {
        type: "string",
        description: "<= 155 characters, includes the primary keyword and the concrete benefit.",
      },
      h1: { type: "string", description: "The on-page H1, containing the primary keyword near the front." },
      content_md: {
        type: "string",
        description:
          "Full article body in markdown per the REQUIRED POST STRUCTURE — using ## and ### headings, " +
          "ending with '## Conclusion' then '## Key Takeaways'. Do NOT include the H1 or the FAQ section here.",
      },
      faqs: {
        type: "array",
        description: "4-6 FAQ entries covering the supplied reader questions.",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
          },
          required: ["question", "answer"],
        },
      },
      keywords_used: {
        type: "array",
        description: "Every keyword (primary + supporting) actually woven into content_md.",
        items: { type: "string" },
      },
      keyword_usage: {
        type: "array",
        description:
          "One entry per keyword in keywords_used, same order. used_as === original unless merged/swapped.",
        items: {
          type: "object",
          properties: {
            original: { type: "string" },
            used_as: { type: "string" },
          },
          required: ["original", "used_as"],
        },
      },
    },
    required: [
      "title",
      "meta_title",
      "meta_description",
      "h1",
      "content_md",
      "faqs",
      "keywords_used",
      "keyword_usage",
    ],
  },
};

// Safety net behind the FORMATTING rules in SYSTEM_PROMPT: strips any em dash
// or stray dash-hyphen that slipped through generation, across every text
// field the model returns (not just content_md).
function sanitizeGeneratedArticle(article: GeneratedArticle): GeneratedArticle {
  return {
    ...article,
    title: stripDashes(article.title),
    meta_title: stripDashes(article.meta_title),
    meta_description: stripDashes(article.meta_description),
    h1: stripDashes(article.h1),
    content_md: stripDashes(article.content_md),
    faqs: (article.faqs ?? []).map((f) => ({
      question: stripDashes(f.question),
      answer: stripDashes(f.answer),
    })),
  };
}

// Per-source cap on how much fetched page text we carry forward into the fact-check
// prompt. Generous enough to cover the section a number actually came from, small
// enough that a handful of fetched pages doesn't blow up the fact-check call's input.
const MAX_FETCHED_TEXT_CHARS = 8000;

// Pulls the actual fetched page text out of the model's response so the fact-check
// pass (src/lib/factcheck.ts) can verify numbers against real source text instead of
// trusting the writer's attribution or its own general knowledge. This is the ground
// truth the prompt-level SOURCE VERIFICATION rule alone couldn't enforce: the writer
// was still pattern-completing plausible-looking numbers even when told to fetch first,
// so the fix has to live in an independent check that can see what was actually fetched.
function extractFetchedSourceText(content: unknown): Record<string, string> {
  const fetchedSources: Record<string, string> = {};
  if (!Array.isArray(content)) return fetchedSources;

  for (const block of content as any[]) {
    if (block?.type !== "web_fetch_tool_result") continue;
    const fetchResult = block.content;
    if (!fetchResult || fetchResult.type !== "web_fetch_result") continue;

    const url = typeof fetchResult.url === "string" ? fetchResult.url : undefined;
    if (!url) continue;

    const doc = fetchResult.content;
    const source = doc?.type === "document" ? doc.source : undefined;

    if (source?.type === "text" && typeof source.data === "string") {
      fetchedSources[url] =
        source.data.length > MAX_FETCHED_TEXT_CHARS
          ? `${source.data.slice(0, MAX_FETCHED_TEXT_CHARS)}\n...[truncated for length]`
          : source.data;
    } else {
      // PDFs and other binary fetch results arrive base64-encoded — record that the
      // page was fetched, but the fact-checker can't text-match against raw bytes here.
      fetchedSources[url] =
        "[fetched non-text content (e.g. a PDF) — raw bytes not decoded, so this cannot be " +
        "text-matched against cited numbers]";
    }
  }

  return fetchedSources;
}

// Matches a dollar-amount-shaped figure ($5, $10.99, $1,200, etc.) anywhere in a string.
const DOLLAR_FIGURE_PATTERN = /\$\s?\d[\d,]*(?:\.\d+)?/g;

// Matches a storage-size figure (10MB, 250 MB, 1GB, etc.) anywhere in a string. Storage
// units are the next most common place after dollar amounts where the model attached a
// confident-sounding, specific number to a named plan/tier with no support in the fetched
// text — e.g. "10MB per file" for Trello Free and "250MB per file" for Trello Standard were
// both fabricated in a live retest; neither figure appears anywhere on Trello's actual
// fetched pricing page.
const STORAGE_FIGURE_PATTERN = /\d[\d,]*(?:\.\d+)?\s?(?:KB|MB|GB|TB)\b/gi;

// Matches a percentage figure (20%, 12.5%, etc.) anywhere in a string.
const PERCENT_FIGURE_PATTERN = /\d[\d,]*(?:\.\d+)?\s?%/g;

// Matches a count-based figure: a number (optionally comma-grouped or "K"-suffixed)
// immediately followed by one of a fixed set of countable-noun phrases that recur in named
// plan/tier feature claims (board/collaborator/seat counts, automation run counts, AI credit
// allotments, etc.). See the Round 7 comment further down for why this needed a different
// normalization strategy than the dollar/storage/percent rules above, rather than just
// reusing DOLLAR_FIGURE_PATTERN's approach verbatim. Longer, more specific phrases are listed
// before the shorter phrases they contain (e.g. "automation actions?" before "automations?")
// so the regex engine's left-to-right alternative matching doesn't stop at a shorter partial
// match ("automation") when the fuller phrase ("automation actions") is actually present.
const COUNT_UNIT_WORDS = [
  "automation actions?",
  "active automations?",
  "automations?",
  "command runs?",
  "(?:ai )?(?:super )?credits?",
  "collaborators?",
  "boards?",
  "users?",
  "members?",
  "guests?",
  "seats?",
  "forms?",
  "integrations?",
  "dashboards?",
  "views?",
];

// The unit phrase often isn't immediately adjacent to the number — "1,000 workspace
// automation command runs" has "workspace" sitting between the number and the actual unit
// phrase — so this allows up to 3 filler words in between. Two exclusions on those filler
// words turned out to matter on a live test pass: "per"/"a"/"the" are exactly the connector
// words that make a PRICE ("$5 per user per month") look like a count of "users" to this
// pattern if left unguarded, so they're blocked from being treated as filler. The leading
// `(?<!\$)` does the same job from the other direction, refusing to start a count match on a
// digit that's actually part of a dollar amount.
const COUNT_FIGURE_PATTERN = new RegExp(
  `(?<!\\$)\\d[\\d,]*(?:\\.\\d+)?\\s?[kK]?(?:\\s+(?!per\\b|a\\b|the\\b)[a-zA-Z-]+){0,3}?\\s+(?:${COUNT_UNIT_WORDS.join("|")})\\b`,
  "gi"
);

// For each fetched source, the exact set of figure substrings matching a given pattern
// (e.g. "$10.99", "250MB", "20%") that literally appear in its captured text. Figures are
// normalized (whitespace stripped, uppercased) so "250 MB" and "250mb" both collapse to the
// same key, since exact whitespace/casing varies between a source page and how the model
// transcribes it, even when the underlying figure itself is genuinely correct.
//
// An earlier version of the dollar-figure check (findSourcesWithoutPriceSignal, removed)
// only asked a binary question: "does this page contain ANY dollar sign at all?" Live
// retesting on the Asana/Trello/ClickUp pricing topic showed that question is too coarse to
// catch the real failure: Asana's and Trello's fetched pricing pages are JS-rendered SPAs
// whose static fetch never returns the real price table, but the captured marketing copy
// still happened to contain at least one unrelated dollar figure somewhere on the page (a
// promo blurb, an unrelated callout, etc.). That single stray figure was enough to make the
// binary check pass, so the "this source has no price data" warning was silently omitted
// for exactly the two sources that needed it, and the model went on to write fabricated
// Asana/Trello prices it recalled from training, identically to before the check existed.
//
// Comparing against the exact extracted set instead of a yes/no flag closes that gap: a
// fabricated $10.99 is still caught as unverified even when the source page has some other
// real $0 or $49 mentioned elsewhere that has nothing to do with the claim being made.
type FigureNormalizer = (raw: string) => string;

const DEFAULT_FIGURE_NORMALIZER: FigureNormalizer = (raw) => raw.replace(/\s+/g, "").toUpperCase();

// Normalizes a count-figure match ("5,000 automation actions", "5K Automations", "10 boards")
// into a "<numeric value>|<normalized unit>" key, instead of the byte-for-byte string
// normalization DEFAULT_FIGURE_NORMALIZER uses for dollar/storage/percent figures. See the
// Round 7 comment further down for why this is necessary: a source page may state a count as
// "5K Automations Per Month" while a correct article restates the identical real figure as
// "5,000 automation actions per month" — those need to compare equal, which byte-for-byte
// normalization alone could never do, since "5K" and "5,000" share no common substring.
function normalizeCountFigure(raw: string): string {
  const match = raw.match(/^(\d[\d,]*(?:\.\d+)?)\s?([kK])?\s*(.+)$/);
  if (!match) return DEFAULT_FIGURE_NORMALIZER(raw);

  const [, numberPart, kSuffix, unitPart] = match;
  let value = parseFloat(numberPart.replace(/,/g, ""));
  if (kSuffix) value *= 1000;

  // Crude singularization (drop a trailing "s") so "board"/"boards" and "credit"/"credits"
  // collapse to the same unit key regardless of which form the source page or the article
  // happened to use.
  const unit = unitPart
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/s$/, "");

  return `${value}|${unit}`;
}

function extractFigures(
  text: string,
  pattern: RegExp,
  normalize: FigureNormalizer = DEFAULT_FIGURE_NORMALIZER
): Set<string> {
  const matches = text.match(pattern) ?? [];
  return new Set(matches.map(normalize));
}

function extractDollarFigures(text: string): Set<string> {
  return extractFigures(text, DOLLAR_FIGURE_PATTERN);
}

function buildPriceWhitelistWarning(fetchedSources: Record<string, string>): string {
  const entries = Object.entries(fetchedSources);
  if (entries.length === 0) return "";

  const lines = entries.map(([url, text]) => {
    const figures = extractDollarFigures(text);
    const list =
      figures.size > 0
        ? Array.from(figures).join(", ")
        : "(none — this page's fetched text contains zero dollar figures anywhere)";
    return `- ${url}: ${list}`;
  });

  return `

VERIFIED FACT (computed directly from the fetched text via exact string matching, not a model
judgment call): here is the COMPLETE set of dollar-figure substrings that literally appear anywhere
in each source's fetched text below. There is nothing else on the page besides what is listed:
${lines.join("\n")}

Any specific dollar amount, fee, or price you write that is tied to one of these sources and is NOT
in that source's list above is fabricated, full stop, even if it looks like a perfectly reasonable
price, even if you recognize it as that product's real current price from training data, and even if
the source's list above contains some OTHER dollar figure (a different number being present on the
page does not make a different, unlisted number you wrote up correct, it just means the page has some
unrelated number on it). For any plan/tier price you cannot find verbatim in its source's list above,
remove that specific figure and either generalize the point or point the reader to the product's own
pricing page directly, per the instructions above. This applies per-figure: a source can have some
listed figures that are genuinely confirmed (use those normally) while every other figure tied to it
is still unconfirmed and must be removed or generalized.`;
}

// --- Deterministic post-processing backstop (Round 4, extended in Round 5/6/7) ----------
// Rounds 1 through 3 all tried to fix the fabricated-price problem by making the prompt more
// convincing: a severity-aware self-correction loop, then a binary "this source has no $
// signal at all" warning, then an exact per-figure whitelist warning (passed into
// reviseArticleForFactIssues's revision prompt, still used above). Three independent live
// retests on the same Asana/Trello/ClickUp pricing topic all converged on the identical
// result: the model wrote the exact same fabricated Asana/Trello prices and invented add-on
// names every time, even when handed a computed whitelist stating in plain terms that those
// exact figures don't appear in the fetched source text. That consistency across runs is
// strong evidence the model is reproducing a specific remembered number with enough
// confidence that no prompt-level instruction reliably overrides it.
//
// Round 4 closed that gap mechanically for dollar figures instead of attempting a fourth,
// even more forceful prompt: after the self-correction loop below finishes (whether or not
// it actually cleared every flagged issue), this scans the final draft's text fields for any
// dollar-figure-shaped substring not present anywhere in the fetched sources and replaces it
// with a visible placeholder. A live retest confirmed this works: every previously-fabricated
// Asana/Trello price in the stored content_md was correctly replaced, while genuinely
// verified ClickUp figures passed through untouched.
//
// That same retest showed needs_review stayed true for a different reason: the model had
// shifted the identical fabrication behavior into non-dollar specifics the dollar-only check
// couldn't see (e.g. "10MB per file" and "250MB per file" storage limits for Trello, neither
// of which is on Trello's actual fetched pricing page). Round 5 extends the same exact-match
// approach to storage-size figures and percentages, since both are mechanically close
// cousins of a dollar figure: a number glued to a fixed, low-variance unit token, so exact
// string verification (after normalizing away whitespace/case) is about as reliable here as
// it is for "$10.99".
//
// This is deliberately NOT extended to named feature/process claims (e.g. "Atlassian Guard
// Standard", a specific list of view types) — those aren't numeric at all, so exact-match
// redaction has no number to anchor on and would just be guessing. That category stays the
// responsibility of the self-correction loop above and human review in the dashboard.
//
// Count-based claims (board/collaborator/guest counts, automation run counts) were excluded
// for the same reason through Round 6: higher surface-form variance against the fetched text
// than a price or storage size ("5K" vs "5,000", singular vs plural noun forms). Round 7
// closes that gap instead of leaving it unhandled, after a live retest of Round 6 turned up
// two fabricated counts that slipped straight through: "Trello Free supports up to 10
// collaborators per workspace" (the real, fetched figure is a 10-board cap, not a
// collaborator cap) and "Trello's free plan includes 250 workspace command runs per month"
// (no fetched source mentions a Free-tier command-run limit at all). Both are exactly the
// kind of fabrication Round 4 already kills for dollar figures, just with a different unit.
//
// The fix is normalizeCountFigure (above) rather than reusing the byte-for-byte string
// normalization the dollar/storage/percent rules use: it parses out the numeric value
// (handling a "K" suffix as a x1000 multiplier and stripping comma grouping) and the unit
// word (singularized) separately, then compares those parsed parts. That specifically
// bridges the "5K Automations Per Month" vs "5,000 automation actions per month" gap that
// blocked a naive extension before, while a board/collaborator/command-run figure with no
// real source support anywhere still has nothing to match against and gets redacted.
//
// Round 5 checked every figure against the union of verified figures across ALL sources
// rather than attributing each figure in the article back to the one specific source it's
// describing (the article's prose doesn't tag which sentence came from which source). A live
// retest exposed the cost of that shortcut: a fabricated "Trello Premium: $10/user/month" was
// left unredacted because *some* dollar figure happened to appear somewhere in the combined
// Asana/Trello/ClickUp fetched text, even though Trello's own fetched page contained zero
// dollar figures at all. A figure that's genuinely verified for one company was silently
// treated as verifying an unrelated, fabricated figure for a different company.
//
// Round 6 closes that specific gap with a scoped check, without trying to solve full claim
// attribution: for each match, look at a window of text immediately before it (see
// CONTEXT_WINDOW_CHARS) for a mention of exactly one known company name (derived from each
// fetched source's hostname). If exactly one company is identifiable nearby, verify the figure
// only against that company's own fetched text, the stricter and more correct check. If zero
// or multiple companies are mentioned nearby (e.g. a cross-company comparison sentence or the
// Key Takeaways section, which legitimately references several companies' figures together),
// fall back to the looser union-of-all-sources check from Round 5, since attribution is
// genuinely ambiguous there and a false redaction of a correct cross-referenced figure is its
// own failure mode. This keeps the common, unambiguous case (a figure inside a single
// company's own pricing-tier section) strict, while leaving the genuinely ambiguous case no
// worse than before.
const PRICE_UNCONFIRMED_PLACEHOLDER = "[price unconfirmed, check the provider's current pricing page]";
const FIGURE_UNCONFIRMED_PLACEHOLDER = "[figure unconfirmed, check the provider's current pricing page]";

// How far back (in characters) before a figure's match position to look for a company-name
// mention when deciding which source to scope verification against. Wide enough to cover a
// company name stated earlier in the same bullet/sentence or in the subsection's heading
// just above it, narrow enough to avoid pulling in an unrelated company mentioned several
// paragraphs earlier in a long comparison post.
const CONTEXT_WINDOW_CHARS = 400;

interface FigureRedactionRule {
  pattern: RegExp;
  // Fallback verified set: the union of this figure type across every fetched source. Used
  // whenever the text around a match doesn't unambiguously identify a single company.
  globalVerified: Set<string>;
  // Per-company verified sets (keyed by a lowercase company key derived from each fetched
  // source's hostname, e.g. "trello" from "trello.com"). Used when exactly one company is
  // identifiable in the text immediately before a match, for a stricter, correctly-scoped check.
  byCompany: Map<string, Set<string>>;
  placeholder: string;
  normalize: FigureNormalizer;
}

function buildVerifiedFigureSet(
  fetchedSources: Record<string, string>,
  pattern: RegExp,
  normalize: FigureNormalizer = DEFAULT_FIGURE_NORMALIZER
): Set<string> {
  const verified = new Set<string>();
  for (const text of Object.values(fetchedSources)) {
    for (const figure of extractFigures(text, pattern, normalize)) verified.add(figure);
  }
  return verified;
}

// Derives a simple lowercase company key from a fetched source's URL, e.g.
// "https://www.trello.com/pricing" -> "trello", "https://asana.com/pricing" -> "asana".
// Used both to build per-company verified sets and to recognize a company's name mentioned
// in the article's own prose (the article writes plain English company names like "Trello",
// which conveniently matches this same key case-insensitively in the vast majority of cases).
function deriveCompanyKey(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const labels = host.split(".").filter(Boolean);
    if (labels.length === 0) return null;
    // Second-level label covers the common case (trello.com -> trello, asana.com -> asana).
    // Falls back to the first label for unusual hostnames with only one.
    const key = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    return key.toLowerCase();
  } catch {
    return null;
  }
}

function buildVerifiedFigureSetByCompany(
  fetchedSources: Record<string, string>,
  pattern: RegExp,
  normalize: FigureNormalizer = DEFAULT_FIGURE_NORMALIZER
): Map<string, Set<string>> {
  const byCompany = new Map<string, Set<string>>();
  for (const [url, text] of Object.entries(fetchedSources)) {
    const key = deriveCompanyKey(url);
    if (!key) continue;
    const figures = extractFigures(text, pattern, normalize);
    const existing = byCompany.get(key) ?? new Set<string>();
    for (const figure of figures) existing.add(figure);
    byCompany.set(key, existing);
  }
  return byCompany;
}

function buildFigureRedactionRules(fetchedSources: Record<string, string>): FigureRedactionRule[] {
  const patterns: { pattern: RegExp; placeholder: string; normalize?: FigureNormalizer }[] = [
    { pattern: DOLLAR_FIGURE_PATTERN, placeholder: PRICE_UNCONFIRMED_PLACEHOLDER },
    { pattern: STORAGE_FIGURE_PATTERN, placeholder: FIGURE_UNCONFIRMED_PLACEHOLDER },
    { pattern: PERCENT_FIGURE_PATTERN, placeholder: FIGURE_UNCONFIRMED_PLACEHOLDER },
    { pattern: COUNT_FIGURE_PATTERN, placeholder: FIGURE_UNCONFIRMED_PLACEHOLDER, normalize: normalizeCountFigure },
  ];

  return patterns.map(({ pattern, placeholder, normalize = DEFAULT_FIGURE_NORMALIZER }) => ({
    pattern,
    globalVerified: buildVerifiedFigureSet(fetchedSources, pattern, normalize),
    byCompany: buildVerifiedFigureSetByCompany(fetchedSources, pattern, normalize),
    placeholder,
    normalize,
  }));
}

// Looks for exactly one known company key mentioned in the text immediately before a match.
// Returns that company key if exactly one is found, or null if zero or multiple are found
// (an ambiguous or cross-company context, where the caller should fall back to the looser
// global verified set rather than risk scoping against the wrong company).
function findCompanyInContext(precedingText: string, companyKeys: string[]): string | null {
  const context = precedingText.toLowerCase();
  const found = companyKeys.filter((key) => context.includes(key));
  return found.length === 1 ? found[0] : null;
}

function redactTextWithRules(text: string, rules: FigureRedactionRule[]): string {
  return rules.reduce((result, rule) => {
    const companyKeys = Array.from(rule.byCompany.keys());
    return result.replace(rule.pattern, (match: string, ...args: unknown[]) => {
      // Per String.replace's callback signature, when the pattern has no capture groups the
      // last two arguments are always the match offset and the full input string.
      const offset = typeof args[args.length - 2] === "number" ? (args[args.length - 2] as number) : 0;
      const fullString = typeof args[args.length - 1] === "string" ? (args[args.length - 1] as string) : result;

      const normalized = rule.normalize(match);
      const windowStart = Math.max(0, offset - CONTEXT_WINDOW_CHARS);
      const company = findCompanyInContext(fullString.slice(windowStart, offset), companyKeys);
      const verified = company ? rule.byCompany.get(company)! : rule.globalVerified;

      return verified.has(normalized) ? match : rule.placeholder;
    });
  }, text);
}

function redactUnverifiedFiguresFromArticle(
  article: GeneratedArticle,
  fetchedSources: Record<string, string>
): GeneratedArticle {
  const rules = buildFigureRedactionRules(fetchedSources);
  const redact = (text: string): string => redactTextWithRules(text, rules);

  return {
    ...article,
    title: redact(article.title),
    meta_title: redact(article.meta_title),
    meta_description: redact(article.meta_description),
    h1: redact(article.h1),
    content_md: redact(article.content_md),
    faqs: article.faqs.map((f) => ({ question: redact(f.question), answer: redact(f.answer) })),
  };
}

// --- Generation-time self-correction gate ----------------------------------------------
// Relying on the downstream fact-check (src/app/api/generate/route.ts) as the only line of
// defense meant every fabricated number reached a human editor as a "needs review" draft
// instead of being caught and fixed automatically. This gate runs the same ground-truth
// fact-check internally, right after drafting, and — if anything comes back flagged — gives
// the model a bounded number of chances to fix the flagged claims directly against the
// fetched source text (not re-fetch, not re-imagine) before generateArticle ever returns.
// That's the point: stop the fabrication from reaching the draft at all, rather than only
// flagging it after. The downstream check still runs independently afterward as the final,
// authoritative record.
const SELF_CORRECTION_SEVERITIES = new Set(["high", "medium"]);

// A single revision pass often doesn't clear every flagged claim in one shot, especially
// when the initial draft has many issues (e.g. a padded-out pricing-tier feature list with
// several fabricated entries) — see reviseArticleForFactIssues's own per-claim instructions.
// Allow one extra attempt at whatever is still flagged after the first pass, rather than
// accepting "still flagged" as final after a single try.
const MAX_SELF_CORRECTION_ATTEMPTS = 2;

// Total wall-clock budget for the whole self-correction loop (initial check + every
// revise/recheck round), independent of GENERATION_TIMEOUT_MS above. Without this, a
// pathological run where every revise/fact-check call happened to be slow could stack
// 2 attempts worth of REVISION_TIMEOUT_MS + fact-check time on top of an already-long
// generation call and blow through the route's 300s maxDuration, reintroducing the exact
// 504 failure mode this gate's timeouts were meant to prevent. In normal operation these
// calls are well under their individual ceilings, so this budget is rarely the limiting
// factor, it just caps the rare worst case.
const SELF_CORRECTION_BUDGET_MS = 110_000;

// Bounds for the raw Anthropic fetch calls below. Without these, a single hung or very
// slow request had no ceiling of its own and could consume the rest of the route's 300s
// maxDuration, surfacing as an opaque platform-level 504 instead of a handled error or
// fallback. The main generation call gets the largest share since it's the one doing real
// work (drafting + up to 6 web_fetch round trips); the revision pass is a best-effort
// bonus step layered on top of an already-good draft, so it gets a much tighter budget.
const GENERATION_TIMEOUT_MS = 200_000;
const REVISION_TIMEOUT_MS = 60_000;

function buildIssuesBlock(issues: FactCheckIssue[]): string {
  return issues
    .map(
      (issue, i) =>
        `${i + 1}. [${issue.severity.toUpperCase()}] Claim: "${issue.claim}"\n   Concern: ${issue.concern}`
    )
    .join("\n\n");
}

// How many HIGH and MEDIUM severity issues a fact-check result contains. Used to compare
// drafts on what actually matters for publication safety (fabricated/incorrect claims),
// rather than the raw accuracy_score alone, which is noisier run to run — the fact-check
// model sometimes lists a confirmed-accurate claim as a "low" severity "issue" (effectively
// just commentary), which nudges the score without reflecting any real problem.
function severityCounts(issues: FactCheckIssue[]): { high: number; medium: number } {
  return {
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
  };
}

// True if `next` is a real improvement over `current`: strictly fewer HIGH severity issues,
// or (tied on HIGH) strictly fewer MEDIUM, or (tied on both) a better accuracy_score as a
// final tiebreaker. This is intentionally looser than requiring the raw score to improve —
// see the comment on severityCounts above for why the raw score alone isn't trustworthy
// enough to gate on, and the comment on the self-correction loop below for what this fixes.
function isImprovement(current: FactCheckResult, next: FactCheckResult): boolean {
  const a = severityCounts(current.issues);
  const b = severityCounts(next.issues);
  if (b.high !== a.high) return b.high < a.high;
  if (b.medium !== a.medium) return b.medium < a.medium;
  return next.accuracy_score > current.accuracy_score;
}

async function reviseArticleForFactIssues(
  apiKey: string,
  article: GeneratedArticle,
  fetchedSources: Record<string, string>,
  issues: FactCheckIssue[]
): Promise<GeneratedArticle | null> {
  const fetchedEntries = Object.entries(fetchedSources);
  const fetchedTextBlock = fetchedEntries.length
    ? fetchedEntries.map(([url, text]) => `=== FETCHED TEXT FOR ${url} ===\n${text}`).join("\n\n")
    : "(no fetched source text is available for this draft)";

  const revisionSystemPrompt = `You are fixing a draft FreelanceAtlas article that an independent
fact-checker flagged for ungrounded or incorrect factual claims. You will be given the full article,
the actual page text that was fetched from its sources while it was being written, and the specific
list of flagged claims.

Flagged claims fall into two kinds, and both need the same treatment: numeric/statistical claims
(a fee, percentage, dollar amount, day count, ranking, or named statistic) AND specific descriptive
claims about a named company, platform, or tool (e.g. the exact steps in its vetting or application
process, what engagement types or pricing tiers it offers, what features it has, or how a specific
named workflow operates). A flagged claim with no number in it is not exempt, it is the same kind of
problem in different form. This includes pricing-tier feature lists specifically: if a plan's feature
bullet list in the article contains more or different features than what is actually visible in that
plan's fetched text, trim it down to only the features you can point to verbatim or near-verbatim in
the fetched text, even if that means a shorter list than the original draft had.

For each flagged claim, first check whether the source it concerns actually appears in the FETCHED
TEXT block below at all, and whether that text actually contains the specific figure, not just the
general topic:
- If that source's real fetched text IS present below and it actually contains the EXACT figure or
  descriptive detail (the article may have just stated it slightly wrong, attributed it to the
  wrong source, or gotten a step or detail slightly off), correct the article so it matches the
  fetched text exactly.
- If that source's real fetched text IS present below but does NOT contain that exact figure or
  detail at all, remove the specific number, step count, or descriptive detail and any named-source
  attribution tied to it, and rephrase the point in general, qualitative terms instead. This applies
  even if you personally recall the real number from general knowledge and believe it is accurate.
  Recalled-from-training numbers are exactly what this fix is removing, they are not a substitute for
  a number actually present in the fetched text. For numeric claims: write something like "a
  percentage-based fee that is typically higher early in a project" rather than a specific invented
  percentage. For descriptive claims: write something like "uses a multi-step vetting process before
  accepting freelancers" rather than naming an exact number or sequence of steps you cannot confirm,
  or drop the named-entity specifics entirely if even a vague version is not supported.
- If that source is MISSING from the FETCHED TEXT block entirely (the fetch failed, was never
  attempted, or returned nothing usable), do not just soften the claim into generalized qualitative
  language about that entity's mechanism, since that is still an unverified claim about how a
  specific named platform works, just without a number attached. Instead, replace it with a direct,
  neutral pointer telling the reader to check that platform's own current page for specifics (e.g.
  "Upwork's exact fee structure changes periodically, so check Upwork's pricing page directly before
  you rely on a specific number or tier"), or remove the named-entity specifics entirely and make the
  surrounding point in general, platform-agnostic terms instead.
- Do not introduce any new specific number, statistic, process detail, feature claim, or
  named-source claim anywhere in the article that isn't already supported by the fetched text below.
- Leave every other part of the article (structure, voice, unflagged claims, FAQs, keyword usage)
  unchanged.${buildPriceWhitelistWarning(fetchedSources)}

Call submit_article exactly once with the complete, corrected article — every field, not just the
parts you changed.`;

  const userPrompt = `ORIGINAL ARTICLE:
${JSON.stringify(article, null, 2)}

FLAGGED ISSUES FROM THE FACT-CHECK PASS:
${buildIssuesBlock(issues)}

ACTUAL FETCHED SOURCE TEXT (ground truth — use this, and only this, to decide what to fix; if a
source you'd expect to see is not listed below at all, treat it as a failed/missing fetch per the
instructions above):
${fetchedTextBlock}

Fix the flagged issues now and call submit_article with the complete corrected article.`;

  // Best-effort layer: any failure here — including a timeout or network error, not just
  // a non-OK response — just means the caller's current best draft is kept unchanged, not
  // that generation itself fails.
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        system: revisionSystemPrompt,
        tools: [ARTICLE_TOOL],
        tool_choice: { type: "tool", name: "submit_article" },
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(REVISION_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const data = await res.json();
  if (data.stop_reason === "max_tokens") return null;

  const toolUse = (data.content ?? []).find(
    (block: any) => block.type === "tool_use" && block.name === "submit_article"
  );
  if (!toolUse) return null;

  return sanitizeGeneratedArticle(toolUse.input as GeneratedArticle);
}

export async function generateArticle(input: GenerateInput): Promise<GeneratedArticleResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Add it in your Vercel project's environment variables to enable generation."
    );
  }

  const sourceBlock = input.sources.length
    ? input.sources
        .map((s) => `- ${s.title} (${s.publishedDate ?? "date unknown"}): ${s.url}`)
        .join("\n")
    : "No external sources were supplied — keep claims general and avoid invented statistics.";

  const faqBlock = input.suggestedFaqs?.length
    ? input.suggestedFaqs.map((q) => `- ${q}`).join("\n")
    : "None supplied — choose the most likely People Also Ask style questions yourself.";

  const userPrompt = `Cluster: ${input.clusterName}
Primary keyword: ${input.primaryKeyword}
Supporting keywords: ${input.supportingKeywords.join(", ") || "none"}
Editor notes: ${input.notes || "none"}

Sources available below — remember, you only have each one's title/date/URL, not its content. Per
SOURCE VERIFICATION, any specific number tied to a named company, platform, tool, law, or report
(fee, percentage, dollar amount, day count, ranking, statistic) requires a web_fetch confirming it
first, named source or not, and the fetched text must actually contain that exact figure, not just
be a page you successfully fetched on the right topic. If a fetch for one of these sources fails, or
succeeds but its returned text doesn't actually contain the figure you wanted (common on JS-rendered
pricing pages, where a static fetch can return marketing copy instead of the real price table), drop
the specific figure or generalize it rather than filling it in from what you already know about that
product, and do not fall back on describing that source's specific mechanism in your own generalized
words either, point the reader to the platform's own page instead. Build your own outline
independently of these sources either way, per the ORIGINALITY rules:
${sourceBlock}

Real reader questions to address in the FAQ section (cover every one of these, rephrased naturally if needed):
${faqBlock}

Research and verify whatever specific facts you intend to cite, run the SOURCE VERIFICATION final
self-check, then write the full FreelanceAtlas blog post by calling submit_article as your final step.`;

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        // Fetched source pages now count against this turn's token budget alongside the
        // article itself, so this needs more headroom than a plain single-shot generation.
        max_tokens: 20000,
        system: SYSTEM_PROMPT,
        tools: [
          // citations.enabled lets Claude anchor specific sentences to fetched pages, and
          // (more importantly for us) guarantees fetch results come back as plain document
          // text rather than some other shape, which extractFetchedSourceText relies on.
          // max_uses capped at 6 (was 10) to bound worst-case latency when a source is slow
          // or repeatedly fails to fetch — see GENERATION_TIMEOUT_MS below for the other
          // half of that mitigation.
          { type: "web_fetch_20250910", name: "web_fetch", max_uses: 6, citations: { enabled: true } },
          ARTICLE_TOOL,
        ],
        // Must be "auto" (not forced to submit_article) so the model can call web_fetch
        // first to verify facts, then call submit_article once it's actually ready.
        messages: [{ role: "user", content: userPrompt }],
      }),
      // Bounds how long this single call (including any web_fetch round trips) can run, so
      // a slow/hanging fetch can't silently consume the rest of the route's 300s maxDuration
      // and surface as an opaque platform-level 504. Failing here throws a clear, catchable
      // error instead.
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new Error(
      timedOut
        ? `Generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s, likely a slow or hanging source fetch. Try fewer/faster sources, or generate again.`
        : `Generation request failed before completing: ${String(err?.message ?? err)}`
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Generation failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (data.stop_reason === "max_tokens") {
    throw new Error(
      "Generation was cut off because the article (plus source verification) exceeded the model's output limit. Try a narrower topic, fewer supporting keywords, or fewer sources, and generate again."
    );
  }

  const toolUse = (data.content ?? []).find(
    (block: any) => block.type === "tool_use" && block.name === "submit_article"
  );
  if (!toolUse) {
    throw new Error(
      "The model did not return a structured article (no submit_article tool call found). Try generating again."
    );
  }

  const article = sanitizeGeneratedArticle(toolUse.input as GeneratedArticle);
  const fetchedSources = extractFetchedSourceText(data.content);

  // --- Self-correction loop (see comment above reviseArticleForFactIssues) --------------
  // Run the ground-truth fact-check now, before returning, instead of only downstream, and
  // give it up to MAX_SELF_CORRECTION_ATTEMPTS chances to clear whatever is still flagged.
  // Tracks the best draft seen so far via isImprovement (HIGH/MEDIUM issue counts, not raw
  // score) so a later attempt can never silently regress to something worse than an earlier
  // one. Wrapped in try/catch so this best-effort layer can never crash the whole
  // generation — any unexpected failure (timeout, network error, etc.) just falls through
  // to the best draft found so far (or the original, unmodified draft if nothing improved
  // on it), same as a normal "nothing flagged" outcome.
  //
  // Whatever comes out of this block (the best self-corrected draft, or the original draft
  // if the loop never improved on it or failed outright) still passes through
  // redactUnverifiedFiguresFromArticle before returning — see that function's comment for
  // why this final deterministic pass exists independent of how well the loop above worked.
  try {
    const loopStartedAt = Date.now();
    let bestArticle = article;
    let bestCheck = await factCheckArticle(article.content_md, article.faqs, input.sources, fetchedSources);

    for (let attempt = 0; attempt < MAX_SELF_CORRECTION_ATTEMPTS; attempt++) {
      const flagged = bestCheck.issues.filter((issue) => SELF_CORRECTION_SEVERITIES.has(issue.severity));
      if (flagged.length === 0) break;
      if (Date.now() - loopStartedAt > SELF_CORRECTION_BUDGET_MS) break;

      const revised = await reviseArticleForFactIssues(apiKey, bestArticle, fetchedSources, flagged);
      if (!revised) break;

      const revisedCheck = await factCheckArticle(revised.content_md, revised.faqs, input.sources, fetchedSources);
      if (!isImprovement(bestCheck, revisedCheck)) break;

      bestArticle = revised;
      bestCheck = revisedCheck;
    }

    return { article: redactUnverifiedFiguresFromArticle(bestArticle, fetchedSources), fetchedSources };
  } catch {
    // Best-effort layer — fall through to the unmodified draft below, still redacted.
  }

  return { article: redactUnverifiedFiguresFromArticle(article, fetchedSources), fetchedSources };
}
