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
that gives freelancers practical, no-fluff money and business advice. Match the live site
voice exactly: conversational but authoritative, second-person ("you"), Oxford comma, US
spelling, em-dashes for asides, no exclamation marks, no hollow phrases like
"game-changer" or "dive into". Open every piece with a crisp one-sentence hook that names
the reader's problem; never open with "Are you..." or "Do you...". Every claim needs a
specific number or named source — no vague generalities.

SEO rules
- Primary keyword in H1, meta title (≤ 60 chars), meta description (≤ 160 chars), first
  100 words, and at least two H2s.
- Supporting keywords woven in naturally — never forced.
- Optimal content length: 1 800 – 2 400 words (body only, excl. FAQ).
- H2s every 250–350 words; no more than one H3 cluster per H2.
- No keyword stuffing; read naturally.

Output format — respond with ONLY a JSON object, no markdown fences, matching this schema:
{
  "title": "string",
  "meta_title": "string (≤60 chars)",
  "meta_description": "string (≤160 chars)",
  "h1": "string",
  "content_md": "string (full article body in Markdown)",
  "faqs": [{"question": "string", "answer": "string"}],
  "keywords_used": ["string"],
  "keyword_usage": [{"original": "string", "used_as": "string"}]
}

keyword_usage rules
- Include one entry per keyword (primary + every supporting keyword).
- "original" = the keyword exactly as supplied to you.
- "used_as"  = the exact surface form you wrote into content_md (e.g. the keyword as it
  actually appears, which may be capitalised, pluralised, or merged into a phrase).
- If you used the keyword verbatim, set used_as === original.
- Do NOT invent keywords or omit any from the list you were given.
`;

// ─── Token / cost helpers ───────────────────────────────────────────────────

const INPUT_COST_PER_M  = 3.00;   // $ per 1 M input tokens  (claude-opus-4-5)
const OUTPUT_COST_PER_M = 15.00;  // $ per 1 M output tokens

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M
       + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function buildUserPrompt(input: GenerateInput): string {
  const kw = [input.primaryKeyword, ...input.supportingKeywords].join(", ");
  const sources = input.sources
    .map((s, i) => `${i + 1}. ${s.title} — ${s.url}${s.publishedDate ? " (" + s.publishedDate + ")" : ""}`)
    .join("\n");

  const faqBlock =
    input.suggestedFaqs && input.suggestedFaqs.length > 0
      ? `\n\nSuggested FAQ questions (answer ALL of these; you may add more):\n${input.suggestedFaqs.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
      : "";

  const notesBlock = input.notes ? `\n\nAdditional notes / angle:\n${input.notes}` : "";

  return `Write a FreelanceAtlas article optimised for these keywords: ${kw}.

Cluster / topic: ${input.clusterName}

Sources to reference (fetch and use their actual content — visit each URL):
${sources}${faqBlock}${notesBlock}`;
}

// ---------------------------------------------------------------------------
// Anthropic client — thin fetch wrapper so we stay edge-compatible
// ---------------------------------------------------------------------------

type AnthropicMessage = { role: "user" | "assistant"; content: string };

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function callAnthropic(
  apiKey: string,
  body: AnthropicRequest
): Promise<AnthropicResponse> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<AnthropicResponse>;
}

// ---------------------------------------------------------------------------
// web_fetch tool — lets Claude pull live source content
// ---------------------------------------------------------------------------

const WEB_FETCH_TOOL: AnthropicTool = {
  name: "web_fetch",
  description:
    "Fetches the text content of a URL and returns it as a string. Use this to read the actual content of each source URL before writing.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" },
    },
    required: ["url"],
  },
};

// ---------------------------------------------------------------------------
// Agentic fetch loop: let Claude call web_fetch as many times as it needs
// then return the final text response + all fetched source bodies.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 12_000;
const MAX_FETCH_BYTES  = 400_000; // ~400 KB per page — enough for any article

async function fetchUrl(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return `[HTTP ${res.status} for ${url}]`;

    const ct = res.headers.get("content-type") ?? "";

    if (!ct.includes("text")) {
      // Non-text body (PDF bytes, images, …): read as base64 so we don't
      // crash the stream, but record a sentinel so the fact-checker knows
      // it can't text-match against this source.
      await res.arrayBuffer(); // drain to free connection
      return `[non-text content-type: ${ct}]`;
    }

    const buf = await res.arrayBuffer();
    clearTimeout(timer);
    const text = new TextDecoder().decode(buf.slice(0, MAX_FETCH_BYTES));
    return text;
  } catch (e: unknown) {
    clearTimeout(timer);
    return `[fetch error: ${e instanceof Error ? e.message : String(e)}]`;
  }
}

interface AgenticResult {
  articleText: string;
  fetchedSources: Record<string, string>;
  usage: { input_tokens: number; output_tokens: number };
}

async function runAgenticGeneration(
  apiKey: string,
  input: GenerateInput
): Promise<AgenticResult> {
  const messages: AnthropicMessage[] = [
    { role: "user", content: buildUserPrompt(input) },
  ];

  const fetchedSources: Record<string, string> = {};
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  const MAX_TURNS = 20;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callAnthropic(apiKey, {
      model: "claude-opus-4-5",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages,
      tools: [WEB_FETCH_TOOL],
    });

    totalUsage.input_tokens  += response.usage.input_tokens;
    totalUsage.output_tokens += response.usage.output_tokens;

    // Collect any text blocks for a potential final answer
    const textBlocks = response.content.filter((b) => b.type === "text");
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      // Claude is done — return the last text block as the article
      const articleText = textBlocks.map((b) => b.text ?? "").join("");
      return { articleText, fetchedSources, usage: totalUsage };
    }

    // Process tool calls
    const toolResults: ContentBlock[] = [];
    for (const toolUse of toolUseBlocks) {
      if (toolUse.name === "web_fetch") {
        const url = (toolUse.input as { url: string }).url;
        const content = await fetchUrl(url);
        fetchedSources[url] = content;
        toolResults.push({
          type: "tool_result",
          // @ts-expect-error tool_use_id is valid in Anthropic tool_result blocks
          tool_use_id: toolUse.id,
          content,
        });
      }
    }

    // Append assistant turn + tool results to conversation
    messages.push({ role: "assistant", content: JSON.stringify(response.content) });
    messages.push({ role: "user", content: JSON.stringify(toolResults) });
  }

  throw new Error("Agentic generation exceeded MAX_TURNS without completing");
}

// ---------------------------------------------------------------------------
// JSON extraction + validation
// ---------------------------------------------------------------------------

function extractJson(raw: string): string {
  // Strip optional markdown code fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Find the outermost { … } block
  const start = raw.indexOf("{");
  const end   = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);

  return raw.trim();
}

function validateArticle(obj: unknown): GeneratedArticle {
  if (typeof obj !== "object" || obj === null) throw new Error("Response is not an object");
  const a = obj as Record<string, unknown>;
  const required = ["title", "meta_title", "meta_description", "h1", "content_md", "faqs", "keywords_used"];
  for (const field of required) {
    if (!(field in a)) throw new Error(`Missing field: ${field}`);
  }
  if (!Array.isArray(a.faqs)) throw new Error("faqs must be an array");
  if (!Array.isArray(a.keywords_used)) throw new Error("keywords_used must be an array");
  // keyword_usage is new — tolerate absence so old cached responses still parse.
  if ("keyword_usage" in a && !Array.isArray(a.keyword_usage)) {
    throw new Error("keyword_usage must be an array when present");
  }
  return obj as GeneratedArticle;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  delayMs: number
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Self-correction loop: revise the article based on fact-check issues
// ---------------------------------------------------------------------------

const MAX_SELF_CORRECTION_ATTEMPTS = 2;
const SELF_CORRECTION_BUDGET_MS    = 120_000; // 2 min total for revision turns
const SELF_CORRECTION_SEVERITIES   = new Set<FactCheckIssue["severity"]>(["high", "critical"]);

function isImprovement(prev: FactCheckResult, next: FactCheckResult): boolean {
  const severityScore = (r: FactCheckResult) =>
    r.issues.reduce((sum, i) => {
      const w = i.severity === "critical" ? 4 : i.severity === "high" ? 3 : i.severity === "medium" ? 2 : 1;
      return sum + w;
    }, 0);
  return severityScore(next) < severityScore(prev);
}

async function reviseArticleForFactIssues(
  apiKey: string,
  article: GeneratedArticle,
  fetchedSources: Record<string, string>,
  issues: FactCheckIssue[]
): Promise<GeneratedArticle | null> {
  const issueList = issues
    .map(
      (iss, i) =>
        `${i + 1}. [${iss.severity.toUpperCase()}] Claim: "${iss.claim}"\n   Problem: ${iss.explanation}\n   Source evidence: ${iss.sourceEvidence ?? "none"}`
    )
    .join("\n\n");

  const sourceSnippets = Object.entries(fetchedSources)
    .map(([url, text]) => `### ${url}\n${text.slice(0, 2000)}`)
    .join("\n\n");

  const revisionPrompt = `The following article has fact-check issues that must be corrected.

Current article JSON:
${JSON.stringify(article, null, 2)}

Fact-check issues to fix:
${issueList}

Source material (use these to find correct figures):
${sourceSnippets}

Return ONLY a corrected JSON object matching the same schema. Fix each issue by either:
- Correcting the figure to match what the source actually says
- Removing the claim if no source supports it
- Softening the claim to "according to [source]" if the number is approximate
Do not introduce new unsupported claims.`;

  try {
    const response = await callAnthropic(apiKey, {
      model: "claude-opus-4-5",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: revisionPrompt }],
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const json = extractJson(text);
    return validateArticle(JSON.parse(json));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerationStats {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface GenerationResult {
  article: GeneratedArticle;
  stats: GenerationStats;
  factCheck: FactCheckResult;
  fetchedSources: Record<string, string>;
}

/**
 * Main entry-point used by the API route.
 *
 * Returns the generated article together with token-usage stats and a
 * fact-check result so the caller can surface quality signals in the UI.
 */
export async function generateArticle(
  apiKey: string,
  input: GenerateInput
): Promise<GenerationResult> {
  // ── 1. Generate (with agentic web_fetch loop) ──────────────────────────
  const { articleText, fetchedSources, usage } = await withRetry(
    () => runAgenticGeneration(apiKey, input),
    3,
    2000
  );

  // ── 2. Parse + validate ────────────────────────────────────────────────
  let article: GeneratedArticle;
  try {
    const jsonStr = extractJson(articleText);
    article = validateArticle(JSON.parse(jsonStr));
  } catch (e) {
    throw new Error(`Failed to parse article JSON: ${e instanceof Error ? e.message : String(e)}\n\nRaw response:\n${articleText.slice(0, 500)}`);
  }

  // ── 3. Post-process ─────────────────────────────────────────────────────
  article.content_md = stripDashes(article.content_md);

  // ── 4. Fact-check + self-correction loop ────────────────────────────────
  const { article: factCheckedArticle, fetchedSources: finalFetchedSources } =
    await generateWithFactCheck(apiKey, article, fetchedSources, input);

  // ── 5. Stats ────────────────────────────────────────────────────────────
  const stats: GenerationStats = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    estimatedCostUsd: estimateCost(usage.input_tokens, usage.output_tokens),
  };

  // ── 6. Final fact-check for UI display ─────────────────────────────────
  const factCheck = await factCheckArticle(
    factCheckedArticle.content_md,
    factCheckedArticle.faqs,
    input.sources,
    finalFetchedSources
  );

  return { article: factCheckedArticle, stats, factCheck, fetchedSources: finalFetchedSources };
}

// ---------------------------------------------------------------------------
// Unverified-figure redaction — deterministic safety net
// ---------------------------------------------------------------------------

/**
 * Strips or neutralises specific numbers that cannot be verified against any
 * fetched source text.
 *
 * Why a deterministic pass on top of the LLM fact-checker?
 * The LLM fact-checker (factcheck.ts) catches issues by reasoning about claims,
 * but it can miss very specific figures (percentages, dollar amounts, years) that
 * were hallucinated outright and therefore have no source evidence to compare
 * against.  This regex-based pass provides a hard safety net: if a figure
 * doesn't appear verbatim (or near-verbatim) in at least one fetched source it
 * is redacted before the article is stored.
 *
 * The function is intentionally conservative — it only targets isolated numeric
 * tokens that look like statistics (e.g. "73%", "$4,200", "2.5x") rather than
 * prose numbers like "three steps" or "Chapter 4".
 */

// Matches things like "73%", "$4,200", "£1.2 million", "2.5x", "1,800"
const STAT_PATTERN = /(?:[$£€]\s*)?\b\d[\d,]*(?:\.\d+)?\s*(?:%|percent|x\b|k\b|K\b|million|billion|[Mm])?\b/g;

// How close a figure needs to appear in a source (within N chars either side)
const CONTEXT_WINDOW = 120;

function figureAppearsInSources(figure: string, sources: Record<string, string>): boolean {
  // Normalise: collapse whitespace, remove currency symbols for fuzzy matching
  const norm = figure.replace(/[$£€,\s]/g, "").toLowerCase();
  for (const text of Object.values(sources)) {
    if (text.toLowerCase().replace(/[$£€,\s]/g, "").includes(norm)) return true;
  }
  return false;
}

function redactStatInContext(match: string, offset: number, fullText: string, sources: Record<string, string>): string {
  if (figureAppearsInSources(match, sources)) return match; // verified — keep as-is

  // Check surrounding prose for a source attribution ("according to X", "per X", etc.)
  const window = fullText.slice(Math.max(0, offset - CONTEXT_WINDOW), offset + match.length + CONTEXT_WINDOW);
  if (/according to|per |source:|via |reports? that|found that|shows? that/i.test(window)) {
    // Attributed claim — soften rather than delete
    return match; // leave attributed figures; the LLM checker will flag if wrong
  }

  // Unverified bare statistic — replace with a redaction marker
  return "[figure removed — unverified]";
}

export function redactUnverifiedFiguresFromArticle(
  article: GeneratedArticle,
  fetchedSources: Record<string, string>
): GeneratedArticle {
  if (Object.keys(fetchedSources).length === 0) return article; // nothing to check against

  const redact = (text: string) =>
    text.replace(STAT_PATTERN, (match, offset, full) =>
      redactStatInContext(match, offset, full, fetchedSources)
    );

  return {
    ...article,
    content_md: redact(article.content_md),
    faqs: article.faqs.map((faq) => ({
      ...faq,
      answer: redact(faq.answer),
    })),
  };
}

// ---------------------------------------------------------------------------
// LLM-flag redaction — remove/neutralise figures flagged by the fact-checker
// ---------------------------------------------------------------------------

/**
 * Redacts or neutralises figures that the LLM fact-checker explicitly flagged
 * as incorrect or unverifiable.
 *
 * This is the second layer of defence (after redactUnverifiedFiguresFromArticle).
 * While the regex pass catches any bare statistic absent from source text, this
 * function acts on the structured `issues` list the fact-checker returns, letting
 * us be surgical: we search for the exact claim text and remove just the offending
 * figure rather than blanket-deleting everything.
 *
 * Design decisions
 * - We match on `issue.claim` because that's the verbatim sentence the LLM
 *   identified as problematic.  If the claim appears in both content_md and a
 *   FAQ answer we redact both occurrences.
 * - For "high" and "critical" severity issues we replace the entire claim sentence
 *   with a redaction notice.  For "medium" and "low" we leave the text untouched
 *   (the UI surfaces these as warnings instead).
 * - If no match is found (the claim was paraphrased or the LLM hallucinated the
 *   claim text) we skip silently — better to leave a potentially-wrong sentence
 *   than to corrupt unrelated text.
 */

const REDACT_SEVERITIES = new Set<FactCheckIssue["severity"]>(["high", "critical"]);

function buildTopicKeySet(fetchedSources: Record<string, string>, extraHints: string[] = []): Set<string> {
  const keys = new Set<string>();
  for (const hint of extraHints) {
    hint.toLowerCase().split(/\s+/).filter((t) => t.length >= 3).forEach((t) => keys.add(t));
  }
  return keys;
}

export function redactFiguresFlaggedByFactCheck(
  article: GeneratedArticle,
  issues: FactCheckIssue[],
  fetchedSources: Record<string, string> = {},
  topicHint: string = ""
): GeneratedArticle {
  // Guards against a real false-positive a live test turned up: the fact-check model often
  // quotes a whole sentence verbatim inside `claim`/`concern` (e.g. "...'The main lim
  // itation is X'...") that looks unverifiable but is actually fine.  We build a small
  // set of topic-domain keywords and skip redaction for issues whose claim overlaps
  // heavily with those keywords — these are almost always correctly-sourced domain facts
  // that the fact-checker mis-classified because the exact phrasing didn't match.
  const topicKeys = buildTopicKeySet(fetchedSources, topicHint ? [topicHint] : []);

  function shouldSkip(claim: string): boolean {
    if (topicKeys.size === 0) return false;
    const claimTokens = claim.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
    const overlap = claimTokens.filter((t) => topicKeys.has(t)).length;
    return overlap / Math.max(claimTokens.length, 1) > 0.5;
  }

  function redactFromText(text: string): string {
    let result = text;
    for (const issue of issues) {
      if (!REDACT_SEVERITIES.has(issue.severity)) continue;
      if (shouldSkip(issue.claim)) continue;

      // Try to find and remove the claim sentence
      const claimIdx = result.indexOf(issue.claim);
      if (claimIdx === -1) continue;

      result =
        result.slice(0, claimIdx) +
        "[statistic removed — could not be verified against cited sources]" +
        result.slice(claimIdx + issue.claim.length);
    }
    return result;
  }

  return {
    ...article,
    content_md: redactFromText(article.content_md),
    faqs: article.faqs.map((faq) => ({
      ...faq,
      answer: redactFromText(faq.answer),
    })),
  };
}

// ---------------------------------------------------------------------------
// extractKeywordsFromSources — pull topic-relevant keys from fetched text
// ---------------------------------------------------------------------------

export function extractKeywordsFromSources(
  fetchedSources: Record<string, string>,
  primaryKeyword: string
): string[] {
  const stopWords = new Set([
    "the", "and", "for", "that", "this", "with", "from", "are", "was", "were",
    "have", "has", "had", "not", "but", "they", "you", "your", "our", "their",
    "will", "can", "may", "also", "more", "some", "all", "any", "its", "been",
  ]);

  const freq: Record<string, number> = {};
  const primaryTokens = new Set(primaryKeyword.toLowerCase().split(/\s+/));

  for (const text of Object.values(fetchedSources)) {
    const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
    for (const w of words) {
      if (stopWords.has(w) || primaryTokens.has(w)) continue;
      freq[w] = (freq[w] ?? 0) + 1;
    }
  }

  return Object.entries(freq)
    .filter(([, count]) => count >= 3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([word]) => word);
}

// ---------------------------------------------------------------------------
// extractSourceKeys — list all URLs that contributed to fetched sources
// ---------------------------------------------------------------------------

export function extractSourceKeys(fetchedSources: Record<string, string>): string[] {
  const keys = new Set<string>();
  for (const key of Object.keys(fetchedSources)) {
    keys.add(key);
  }
  return Array.from(keys);
}

// ---------------------------------------------------------------------------
// generateWithFactCheck — wraps generate + fact-check + self-correction
// ---------------------------------------------------------------------------

/**
 * Runs the article through a fact-check → self-correction loop, then applies
 * both redaction layers before returning.
 *
 * Separated from generateArticle so it can be unit-tested independently and
 * reused if we ever want to re-run fact-checking on an already-generated draft.
 */
export async function generateWithFactCheck(
  apiKey: string,
  article: GeneratedArticle,
  fetchedSources: Record<string, string>,
  input: GenerateInput
): Promise<GeneratedArticleResult> {
  // The self-correction loop lives inside a try/catch so that any unexpected
  // failure (network error, parse error, timeout) falls through gracefully to
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

    const regexRedacted = redactUnverifiedFiguresFromArticle(bestArticle, fetchedSources);
    const finalArticle = redactFiguresFlaggedByFactCheck(regexRedacted, bestCheck.issues, fetchedSources);
    return { article: finalArticle, fetchedSources };
  } catch {
    // Best-effort layer — fall through to the unmodified draft below, still redacted.
  }

  return { article: redactUnverifiedFiguresFromArticle(article, fetchedSources), fetchedSources };
}
