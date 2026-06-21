// Post-generation fact-check pass: re-reads the drafted article alongside the
// sources it was supposed to be grounded in, and flags any claim that isn't
// plausibly backed by them. This never blocks saving — it produces a review
// panel so an editor can see exactly what (if anything) needs a second look.

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

export async function factCheckArticle(
  contentMd: string,
  faqs: { question: string; answer: string }[],
  sources: { url: string; title: string; publishedDate?: string }[]
): Promise<FactCheckResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fact-checking is a non-blocking enhancement — fail soft rather than
    // breaking generation if the key is somehow missing at this call site.
    return {
      accuracy_score: 0,
      needs_review: true,
      issues: [
        {
          claim: "(fact-check not run)",
          concern: "ANTHROPIC_API_KEY is not configured, so the fact-check pass could not run.",
          severity: "medium",
        },
      ],
    };
  }

  const sourceBlock = sources.length
    ? sources.map((s) => `- ${s.title} (${s.publishedDate ?? "date unknown"}): ${s.url}`).join("\n")
    : "No sources were supplied for this article at all.";

  const systemPrompt = `You are a fact-checking editor for FreelanceAtlas. You will be given a drafted
article body plus its FAQ answers, and the list of sources the writer was supposed to ground factual
claims in. Check every concrete factual claim, statistic, dollar figure, percentage, or "according to X"
attribution in the article against that source list.

Flag a claim if:
- It states a specific number, statistic, or dollar figure that is not plausibly supported by any
  listed source (or by no source at all, when none were supplied).
- It attributes a claim to a named source/platform that doesn't appear to cover that claim.
- It states something as a hard fact that is really an opinion, estimate, or rule of thumb without
  saying so.

Do NOT flag general advice, frameworks, opinions, or recommendations that aren't presented as a cited
external fact — that is normal blog content, not a factual claim to verify.

Respond with ONLY a JSON object (no markdown fences, no commentary), matching this shape:
{
  "accuracy_score": number, // 0-100, your overall confidence that the article's factual claims are
                             // properly grounded in the supplied sources. 100 = no ungrounded claims.
  "needs_review": boolean,  // true if accuracy_score < 90 OR any issue has severity "high"
  "issues": [
    { "claim": string, "concern": string, "severity": "low" | "medium" | "high" }
  ]
}
If you find no issues, return an empty "issues" array and a high accuracy_score.`;

  const userPrompt = `SOURCES SUPPLIED TO THE WRITER:
${sourceBlock}

ARTICLE BODY:
${contentMd}

FAQS:
${faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n")}

Fact-check this article against the supplied sources now.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      accuracy_score: 0,
      needs_review: true,
      issues: [
        {
          claim: "(fact-check failed)",
          concern: `Fact-check request failed (${res.status}): ${text.slice(0, 200)}`,
          severity: "medium",
        },
      ],
    };
  }

  const data = await res.json();
  const raw = data.content?.[0]?.text ?? "{}";
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");

  try {
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    const issues: FactCheckIssue[] = Array.isArray(parsed.issues) ? parsed.issues : [];
    const accuracy_score =
      typeof parsed.accuracy_score === "number" ? parsed.accuracy_score : 0;
    const needs_review =
      typeof parsed.needs_review === "boolean"
        ? parsed.needs_review
        : accuracy_score < 90 || issues.some((i) => i.severity === "high");

    return { accuracy_score, needs_review, issues };
  } catch {
    return {
      accuracy_score: 0,
      needs_review: true,
      issues: [
        {
          claim: "(fact-check response unparsable)",
          concern: "The fact-check model response could not be parsed as JSON.",
          severity: "medium",
        },
      ],
    };
  }
}
