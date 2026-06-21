// Post-generation fact-check pass: re-reads the drafted article alongside the
// sources it was supposed to be grounded in, and flags any claim that isn't
// plausibly backed by them, or that is actively wrong. This is the real
// publish gate (see FACT_CHECK_PASS_THRESHOLD + updateArticleStatus in
// src/app/dashboard/actions.ts) — misinformation reaching readers is the
// failure mode worth blocking on, more so than phrasing/originality concerns.

export interface FactCheckIssue {
  claim: string;
  concern: string;
  severity: "low" | "medium" | "high";
}

export interface FactCheckResult {
  accuracy_score: number; // 0-100
  needs_review: boolean;
  issues: FactCheckIssue[];
}

export const FACT_CHECK_PASS_THRESHOLD = 90; // gate: publishing is blocked below this score

const FACTCHECK_TOOL = {
  name: "submit_fact_check",
  description: "Submit the fact-check results for the article.",
  input_schema: {
    type: "object" as const,
    properties: {
      accuracy_score: {
        type: "number",
        description:
          "0-100 overall confidence that the article's factual claims are grounded in, and consistent " +
          "with, the supplied sources. 100 = no ungrounded or incorrect claims. Deduct heavily for any " +
          "claim that actively contradicts a source or states something false, not just claims that " +
          "merely lack a citation.",
      },
      needs_review: {
        type: "boolean",
        description: `true if accuracy_score < ${FACT_CHECK_PASS_THRESHOLD} OR any issue has severity "high".`,
      },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            claim: { type: "string" },
            concern: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["claim", "concern", "severity"],
        },
      },
    },
    required: ["accuracy_score", "needs_review", "issues"],
  },
};

function failSoft(claim: string, concern: string): FactCheckResult {
  return {
    accuracy_score: 0,
    needs_review: true,
    issues: [{ claim, concern, severity: "medium" }],
  };
}

export async function factCheckArticle(
  contentMd: string,
  faqs: { question: string; answer: string }[],
  sources: { url: string; title: string; publishedDate?: string }[]
): Promise<FactCheckResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fact-checking is the publish gate — fail soft-but-closed: missing config
    // returns a deliberately blocking result rather than silently passing.
    return failSoft(
      "(fact-check not run)",
      "ANTHROPIC_API_KEY is not configured, so the fact-check pass could not run."
    );
  }

  const sourceBlock = sources.length
    ? sources.map((s) => `- ${s.title} (${s.publishedDate ?? "date unknown"}): ${s.url}`).join("\n")
    : "No sources were supplied for this article at all.";

  const systemPrompt = `You are a fact-checking editor for FreelanceAtlas, and the most important thing
you do is catch misinformation before it reaches readers — that matters far more than style or
phrasing. You will be given a drafted article body plus its FAQ answers, and the list of sources the
writer was supposed to ground factual claims in. Check every concrete factual claim, statistic, dollar
figure, percentage, date, or "according to X" attribution in the article against that source list and
against your own general knowledge.

Flag a claim, in roughly this priority order:
- HIGH: it is actively wrong, or contradicts a listed source, rather than merely lacking one (e.g. a
  stat that's the opposite sign, a platform fee or rate that's out of date or incorrect, a year/date
  that doesn't match the source's own publish date, a tool/feature attributed to the wrong product).
- HIGH: it cites a named source for a specific number or claim that source does not actually contain
  (a fabricated/invented attribution), as opposed to a claim that's just uncited.
- MEDIUM: it states a number, statistic, or dollar figure that is plausible but not supported by any
  listed source (or by no source at all, when none were supplied) and could be stale or outdated.
- MEDIUM: two passages in the article state numbers for the same thing that don't agree with each
  other (internal inconsistency).
- LOW: it states something as a hard, certain fact that is really an opinion, estimate, or rule of
  thumb, without signaling that.

Do NOT flag general advice, frameworks, opinions, or recommendations that aren't presented as a cited
external fact — that is normal blog content, not a factual claim to verify. Do NOT flag wording or
phrasing similarity to a source — that's a separate originality concern, not your job here.

If you find no issues, return an empty "issues" array and a high accuracy_score.

Call the submit_fact_check tool exactly once with your results. Do not respond with plain text.`;

  const userPrompt = `SOURCES SUPPLIED TO THE WRITER:
${sourceBlock}

ARTICLE BODY:
${contentMd}

FAQS:
${faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n")}

Fact-check this article against the supplied sources now by calling submit_fact_check.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      tools: [FACTCHECK_TOOL],
      tool_choice: { type: "tool", name: "submit_fact_check" },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return failSoft("(fact-check failed)", `Fact-check request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  if (data.stop_reason === "max_tokens") {
    return failSoft(
      "(fact-check not completed)",
      "Fact-check was cut off because it exceeded the model's output limit."
    );
  }

  const toolUse = (data.content ?? []).find((block: any) => block.type === "tool_use");

  if (!toolUse) {
    return failSoft(
      "(fact-check response unparsable)",
      "The fact-check model did not return a structured tool call."
    );
  }

  const parsed = toolUse.input as Partial<FactCheckResult>;
  const issues: FactCheckIssue[] = Array.isArray(parsed.issues) ? parsed.issues : [];
  const accuracy_score = typeof parsed.accuracy_score === "number" ? parsed.accuracy_score : 0;
  const needs_review =
    typeof parsed.needs_review === "boolean"
      ? parsed.needs_review
      : accuracy_score < FACT_CHECK_PASS_THRESHOLD || issues.some((i) => i.severity === "high");

  return { accuracy_score, needs_review, issues };
}
