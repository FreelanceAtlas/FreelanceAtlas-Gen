// Post-generation originality pass: re-reads the drafted article alongside the
// sources it was researched from, and flags any passage that reads as a close
// paraphrase, a sentence-by-sentence mirror, or a reused checklist/section order
// from one specific source. This is a GATE, not just an advisory panel — see
// updateArticleStatus in src/app/dashboard/actions.ts, which blocks publishing
// an article whose originality_score falls below the threshold until an editor
// either rewrites the flagged passages and regenerates, or force-publishes.

export interface OriginalityIssue {
  excerpt: string;       // the article passage that reads as too close to a source
  likely_source: string; // title/domain of the source it resembles, or "multiple sources" / "unclear"
  concern: string;       // what specifically is too close: phrasing, sentence order, checklist order, etc.
  severity: "low" | "medium" | "high";
}

export interface OriginalityResult {
  originality_score: number; // 0-100. 100 = reads as fully independent synthesis, no traceable mirroring.
  needs_review: boolean;
  issues: OriginalityIssue[];
}

export const ORIGINALITY_PASS_THRESHOLD = 80; // gate: publishing is blocked below this score

const ORIGINALITY_TOOL = {
  name: "submit_originality_check",
  description: "Submit the originality-check results for the article.",
  input_schema: {
    type: "object" as const,
    properties: {
      originality_score: {
        type: "number",
        description:
          "0-100. 100 = the article reads as an independently written synthesis with no passage " +
          "traceable to a single source's wording, sentence order, or structure. Deduct heavily for " +
          "any five-plus-word verbatim run, sentence-by-sentence mirroring, or a checklist/section " +
          "order reused from one source.",
      },
      needs_review: {
        type: "boolean",
        description: `true if originality_score < ${ORIGINALITY_PASS_THRESHOLD} OR any issue has severity "high".`,
      },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            excerpt: { type: "string", description: "The article passage in question, quoted verbatim." },
            likely_source: { type: "string" },
            concern: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["excerpt", "likely_source", "concern", "severity"],
        },
      },
    },
    required: ["originality_score", "needs_review", "issues"],
  },
};

function failSoft(reason: string): OriginalityResult {
  return {
    originality_score: 0,
    needs_review: true,
    issues: [
      {
        excerpt: "(originality check not completed)",
        likely_source: "n/a",
        concern: reason,
        severity: "medium",
      },
    ],
  };
}

export async function checkOriginality(
  contentMd: string,
  sources: { url: string; title: string; publishedDate?: string }[]
): Promise<OriginalityResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Non-blocking on missing config — but flagged so the publish gate still catches it
    // (needs_review: true with score 0 keeps the gate closed rather than silently passing).
    return failSoft("ANTHROPIC_API_KEY is not configured, so the originality check could not run.");
  }

  if (sources.length === 0) {
    // Nothing to mirror — pass cleanly rather than penalizing topics with no supplied sources.
    return { originality_score: 100, needs_review: false, issues: [] };
  }

  const sourceBlock = sources
    .map((s) => `- ${s.title} (${s.publishedDate ?? "date unknown"}): ${s.url}`)
    .join("\n");

  const systemPrompt = `You are an originality/anti-plagiarism editor for FreelanceAtlas. You will be
given a drafted article body and the list of sources the writer researched from. Your job is to catch
content that is too close to one specific source, even if no single sentence is a perfect verbatim
copy.

Flag a passage if:
- It reuses a run of five or more consecutive words from a source, unless that run is a necessary
  legal, technical, or official term (e.g. a statute name, a government form number).
- It is a sentence-level synonym swap of a source sentence — same structure and claims, different
  words.
- It mirrors a source paragraph sentence-by-sentence, in the same order, even with different wording.
- It reproduces a source's checklist, list of examples, categories, or section sequence in
  substantially the same order.
- It uses a source-specific metaphor, hook, slogan, or rhetorical device rather than an original one.
- It attributes a claim to a named source ("according to X") that doesn't actually support that exact
  claim, or cites a source for something that's really just common, widely-known advice.

Do NOT flag:
- General, widely-known freelancing/business advice explained independently, even if a source also
  mentions it — shared facts and common advice are not plagiarism.
- Necessary legal, technical, or official terminology that must stay precise (e.g. "Form W-9",
  "Schedule C", "DBA").
- Normal topical overlap — covering the same subtopics as the sources is expected; the concern is only
  reused wording, sentence order, or structure.

Score originality_score 0-100: 100 means the article reads as an independently written expert guide
that could not be traced back to any single source's phrasing or structure, even though it covers the
same underlying facts. Deduct heavily for any high-severity issue. If a different editor were handed
the same source list in a different order, would this article still look the same? If yes, that is a
red flag for low originality.

If you find no issues, return an empty "issues" array and a high originality_score.

Call the submit_originality_check tool exactly once with your results. Do not respond with plain text.`;

  const userPrompt = `SOURCES THE WRITER RESEARCHED FROM:
${sourceBlock}

ARTICLE BODY:
${contentMd}

Check this article for originality against the supplied sources now by calling submit_originality_check.`;

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
      tools: [ORIGINALITY_TOOL],
      tool_choice: { type: "tool", name: "submit_originality_check" },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return failSoft(`Originality check request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  if (data.stop_reason === "max_tokens") {
    return failSoft("Originality check was cut off because it exceeded the model's output limit.");
  }

  const toolUse = (data.content ?? []).find((block: any) => block.type === "tool_use");
  if (!toolUse) {
    return failSoft("The originality-check model did not return a structured tool call.");
  }

  const parsed = toolUse.input as Partial<OriginalityResult>;
  const issues: OriginalityIssue[] = Array.isArray(parsed.issues) ? parsed.issues : [];
  const originality_score =
    typeof parsed.originality_score === "number" ? parsed.originality_score : 0;
  const needs_review =
    typeof parsed.needs_review === "boolean"
      ? parsed.needs_review
      : originality_score < ORIGINALITY_PASS_THRESHOLD || issues.some((i) => i.severity === "high");

  return { originality_score, needs_review, issues };
}

const REWRITE_TOOL = {
  name: "submit_rewritten_article",
  description: "Submit the full article body with the flagged passages rewritten.",
  input_schema: {
    type: "object" as const,
    properties: {
      content_md: {
        type: "string",
        description:
          "The COMPLETE article body in markdown, identical to the original except that every flagged " +
          "passage has been rewritten to convey the same point/facts using genuinely original phrasing, " +
          "examples, and rhetorical framing. Every part of the article that was NOT flagged must be " +
          "reproduced unchanged.",
      },
    },
    required: ["content_md"],
  },
};

// Rewrites only the passages a prior checkOriginality call flagged, leaving the rest of the
// article untouched, so an editor doesn't have to manually retype flagged excerpts. Fail-soft:
// on any failure this returns the original contentMd unchanged (never partially-applied or
// corrupted output), so the caller can safely overwrite content_md with the return value.
export async function rewriteFlaggedPassages(
  contentMd: string,
  issues: OriginalityIssue[],
  sources: { url: string; title: string; publishedDate?: string }[]
): Promise<{ content_md: string; rewritten: boolean; error?: string }> {
  if (issues.length === 0) {
    return { content_md: contentMd, rewritten: false };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      content_md: contentMd,
      rewritten: false,
      error: "ANTHROPIC_API_KEY is not configured, so the rewrite could not run.",
    };
  }

  const sourceBlock = sources.length
    ? sources.map((s) => `- ${s.title} (${s.publishedDate ?? "date unknown"}): ${s.url}`).join("\n")
    : "No sources were supplied.";

  const issueBlock = issues
    .map(
      (issue, i) =>
        `${i + 1}. Excerpt: "${issue.excerpt}"\n   Resembles: ${issue.likely_source}\n   Concern: ${issue.concern}`
    )
    .join("\n\n");

  const systemPrompt = `You are an editor fixing originality flags on a FreelanceAtlas article. You will
be given the full article body, the list of sources it was researched from, and a list of specific
passages an originality check flagged as too close to a source (in wording, sentence structure,
specific examples, or rhetorical framing — not necessarily verbatim copying).

Rewrite ONLY the flagged passages:
- Preserve the same underlying facts, claims, and point being made.
- Use genuinely original phrasing — do not do a sentence-level synonym swap.
- If the flagged passage used a specific illustrative example (a persona, industry, scenario, or
  number) that resembles a source's example, invent a different one of your own.
- If the flagged passage used a source's rhetorical contrast/definitional device (e.g. "X is a
  complete statement, Y is not"), invent your own way of making the same point.
- Keep the rewritten passage roughly the same length and keep it fitting naturally into the
  surrounding paragraph/list/heading structure.
- Reproduce every other part of the article — every sentence, heading, and list item that was not
  flagged — completely unchanged, verbatim.

Call submit_rewritten_article exactly once with the full article body. Do not respond with plain text.`;

  const userPrompt = `SOURCES THE ARTICLE WAS RESEARCHED FROM:
${sourceBlock}

FULL ARTICLE BODY:
${contentMd}

FLAGGED PASSAGES TO REWRITE:
${issueBlock}

Return the full article body with only these passages rewritten, by calling submit_rewritten_article.`;

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
      tools: [REWRITE_TOOL],
      tool_choice: { type: "tool", name: "submit_rewritten_article" },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      content_md: contentMd,
      rewritten: false,
      error: `Rewrite request failed (${res.status}): ${text.slice(0, 200)}`,
    };
  }

  const data = await res.json();

  if (data.stop_reason === "max_tokens") {
    return {
      content_md: contentMd,
      rewritten: false,
      error: "Rewrite was cut off because it exceeded the model's output limit.",
    };
  }

  const toolUse = (data.content ?? []).find((block: any) => block.type === "tool_use");
  if (!toolUse || typeof toolUse.input?.content_md !== "string" || !toolUse.input.content_md.trim()) {
    return {
      content_md: contentMd,
      rewritten: false,
      error: "The rewrite model did not return a structured tool call.",
    };
  }

  return { content_md: toolUse.input.content_md, rewritten: true };
}
