// Post-generation originality pass: re-reads the drafted article alongside the
// sources it was researched from, and flags any passage that is a verbatim or
// near-verbatim run of words lifted from one specific source — true plagiarism,
// not general topical overlap or paraphrase. This is a GATE, not just an advisory
// panel — see updateArticleStatus in src/app/dashboard/actions.ts, which blocks
// publishing an article whose originality_score falls below the threshold until
// an editor either rewrites the flagged passages and regenerates, or force-publishes.

export interface OriginalityIssue {
  excerpt: string;       // the article passage that reads as too close to a source
  likely_source: string; // title/domain of the source it resembles, or "multiple sources" / "unclear"
  concern: string;       // what specifically is copied: the exact words/run that match the source
  severity: "low" | "medium" | "high";
}

export interface OriginalityResult {
  originality_score: number; // 0-100. 100 = no verbatim/near-verbatim text traceable to a source.
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
          "0-100. 100 = no passage in the article is a verbatim or near-verbatim run of words copied " +
          "from a single source. Deduct heavily for any five-plus-word verbatim run, or a sentence that " +
          "is identical to a source sentence apart from one or two word substitutions.",
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
    // Nothing to copy from — pass cleanly rather than penalizing topics with no supplied sources.
    return { originality_score: 100, needs_review: false, issues: [] };
  }

  const sourceBlock = sources
    .map((s) => `- ${s.title} (${s.publishedDate ?? "date unknown"}): ${s.url}`)
    .join("\n");

  const systemPrompt = `You are a plagiarism checker for FreelanceAtlas. You will be given a drafted
article body and the list of sources the writer researched from. Your only job is to catch text that
is copied word-for-word (or with only trivial word substitutions) from one of those sources. You are
NOT checking for paraphrase, topical overlap, reused examples, reused structure, or reused rhetorical
style — only literal copied wording.

Flag a passage if:
- It reuses a run of five or more consecutive words from a source, unless that run is a necessary
  legal, technical, or official term (e.g. a statute name, a government form number).
- It is a near-verbatim copy of a source sentence — identical or almost identical wording, with at
  most one or two words changed.

Do NOT flag:
- Paraphrase, synonym swaps, or sentences that make the same point as a source in different words.
- Reused examples, personas, scenarios, checklists, or section/topic order — covering the same ground
  as a source in your own words is expected, not plagiarism.
- Reused metaphors, hooks, slogans, or rhetorical/contrast devices, as long as the actual wording is
  original.
- General, widely-known freelancing/business advice explained independently, even if a source also
  mentions it.
- Necessary legal, technical, or official terminology that must stay precise (e.g. "Form W-9",
  "Schedule C", "DBA").
- Attribution or sourcing concerns ("according to X") — that is a fact-check concern, not an
  originality concern; ignore it here entirely.

Score originality_score 0-100: 100 means no passage in the article is a verbatim or near-verbatim run
of words copied from a single source. Only deduct for actual copied wording, never for similarity of
ideas, examples, or structure.

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
          "passage has been reworded so it is no longer a verbatim or near-verbatim copy of the source " +
          "text. Every part of the article that was NOT flagged must be reproduced unchanged.",
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

  const systemPrompt = `You are an editor fixing plagiarism flags on a FreelanceAtlas article. You will
be given the full article body, the list of sources it was researched from, and a list of specific
passages an originality check flagged as verbatim or near-verbatim copies of a source's wording.

Rewrite ONLY the flagged passages:
- Preserve the same underlying facts, claims, and point being made.
- Reword the passage so it is no longer a verbatim or near-verbatim copy of the source's wording —
  changing structure, sentence order, or word choice as needed so it reads as your own sentence.
- You do NOT need to invent new examples or new rhetorical devices — the same example, persona, or
  framing is fine, as long as the actual wording is no longer copied.
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
