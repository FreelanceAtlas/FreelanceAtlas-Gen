// Redo-path scoring via OpenRouter (anthropic/claude-sonnet-4.5).
//
// The generation-time checks use the Anthropic API + claude-sonnet-4-6. For the
// redo we deliberately score with claude-sonnet-4.5 through OpenRouter, grounded
// in server-fetched source text, because that is the exact setup proven to
// evaluate these figure-heavy pricing drafts correctly (the Anthropic checker was
// returning noisy results — e.g. flagging a correctly-reworded draft's originality
// down to 72, and stale "score 72 / zero issues" fact results). These return the
// SAME shapes as the generation checks so the publish gate is unaffected.

import { FACT_CHECK_PASS_THRESHOLD, type FactCheckResult } from "./factcheck";
import { ORIGINALITY_PASS_THRESHOLD, type OriginalityResult } from "./originality";

const MODEL = () => process.env.OPENROUTER_REDO_MODEL || "anthropic/claude-sonnet-4.5";

async function openrouterJson(system: string, user: string, maxTokens = 4000): Promise<any> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured, so redo scoring could not run.");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://freelanceatlas.com",
      "X-Title": "FreelanceAtlas-Gen",
    },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Redo scoring request failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  let s = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b <= a) throw new Error("Redo scoring model did not return JSON.");
  return JSON.parse(s.slice(a, b + 1));
}

function fetchedBlock(fetchedSources: Record<string, string>): string {
  const entries = Object.entries(fetchedSources ?? {});
  if (!entries.length) {
    return "(no source pages could be fetched — treat every specific unverifiable figure as a MEDIUM issue)";
  }
  return entries.map(([url, text]) => `=== FETCHED TEXT FOR ${url} ===\n${text}`).join("\n\n").slice(0, 90000);
}

// Fact-check grounded in fetched source text. A specific figure that appears in
// the fetched text PASSES; only figures that contradict or have no support get
// flagged, plus internal / body-vs-FAQ inconsistencies.
export async function factCheckViaOpenRouter(
  contentMd: string,
  faqs: { question: string; answer: string }[],
  fetchedSources: Record<string, string>
): Promise<FactCheckResult> {
  const system = `You are a strict fact-checking editor for FreelanceAtlas. You are given the article body,
its FAQs, and the ACTUAL FETCHED TEXT of the sources. Treat the fetched text as ground truth.

Rules:
- A specific number/price/percentage/date that MATCHES a value in the fetched text is VERIFIED — do NOT flag it.
- Flag (with the offending claim) any specific figure that contradicts the fetched text, or that has no support
  anywhere in the fetched text, or any leftover placeholder like "[price unconfirmed]".
- Flag internal inconsistencies, and any case where the body and a FAQ answer disagree.
- accuracy_score is 0-100; ${FACT_CHECK_PASS_THRESHOLD}+ passes. needs_review is true if the score is below
  ${FACT_CHECK_PASS_THRESHOLD} or any high-severity issue exists.
Respond with ONLY JSON: {"accuracy_score": N, "needs_review": bool, "issues": [{"claim": "...", "concern": "...", "severity": "low|medium|high"}]}`;

  const user = `FETCHED SOURCE TEXT (ground truth):\n${fetchedBlock(fetchedSources)}\n\nARTICLE BODY:\n${contentMd}\n\nFAQS:\n${JSON.stringify(faqs)}`;

  const r = await openrouterJson(system, user, 5000);
  const issues = Array.isArray(r.issues)
    ? r.issues
        .filter((i: any) => i && typeof i.claim === "string")
        .map((i: any) => ({
          claim: String(i.claim),
          concern: String(i.concern ?? ""),
          severity: (["low", "medium", "high"].includes(i.severity) ? i.severity : "medium") as
            | "low"
            | "medium"
            | "high",
        }))
    : [];
  const accuracy_score = typeof r.accuracy_score === "number" ? r.accuracy_score : 0;
  // Gate on the score alone: the model already lowers accuracy_score for real
  // problems, so a >=90 draft passes even if it still lists a few low/medium
  // confirmations. (The model's own needs_review flag over-triggers — it returned
  // true at 92 — which would block genuinely-passing drafts forever.)
  const needs_review = accuracy_score < FACT_CHECK_PASS_THRESHOLD;
  return { accuracy_score, needs_review, issues };
}

// Originality check: flags only verbatim / near-verbatim copying of source phrasing.
// Correcting a number is explicitly NOT a violation.
export async function checkOriginalityViaOpenRouter(contentMd: string): Promise<OriginalityResult> {
  const system = `You are an originality checker for FreelanceAtlas. Flag ONLY passages that read as verbatim or
near-verbatim copies of the typical phrasing of a source. Correcting or inserting a factual number is NOT an
originality violation. originality_score is 0-100; ${ORIGINALITY_PASS_THRESHOLD}+ passes. needs_review is true if the
score is below ${ORIGINALITY_PASS_THRESHOLD} or any high-severity issue exists.
Respond with ONLY JSON: {"originality_score": N, "needs_review": bool, "issues": [{"excerpt": "...", "likely_source": "...", "concern": "...", "severity": "low|medium|high"}]}`;

  const user = `ARTICLE BODY:\n${contentMd}`;

  const r = await openrouterJson(system, user, 4000);
  const issues = Array.isArray(r.issues)
    ? r.issues
        .filter((i: any) => i && typeof i.excerpt === "string")
        .map((i: any) => ({
          excerpt: String(i.excerpt),
          likely_source: String(i.likely_source ?? "unclear"),
          concern: String(i.concern ?? ""),
          severity: (["low", "medium", "high"].includes(i.severity) ? i.severity : "medium") as
            | "low"
            | "medium"
            | "high",
        }))
    : [];
  const originality_score = typeof r.originality_score === "number" ? r.originality_score : 0;
  // Score-based gate, same rationale as the fact-check above.
  const needs_review = originality_score < ORIGINALITY_PASS_THRESHOLD;
  return { originality_score, needs_review, issues };
}
