// Core generation engine: calls the LLM with a FreelanceAtlas-voice system
// prompt, enforces SEO structure, and returns a strict JSON shape we can
// store directly in the `articles` table.

export interface GenerateInput {
  clusterName: string;
  primaryKeyword: string;
  supportingKeywords: string[];
  sources: { url: string; title: string; publishedDate?: string }[];
  notes?: string;
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

const SYSTEM_PROMPT = `You are the senior content writer for FreelanceAtlas, a blog that gives
freelancers practical, no-fluff money and business advice. Match this voice exactly:
- Direct, second-person ("you"), conversational but credible — never salesy or filled with hype.
- Titles are concrete and specific (often with a number, a year, or a clear promise),
  e.g. "How Much Should You Charge on Upwork? (By Skill, 2026)" or
  "Why Your Upwork Proposals Get No Replies (7 Real Reasons)".
- Short paragraphs (2-4 sentences), scannable subheads, concrete numbers/examples over generalities.
- No invented statistics. Only cite facts that are present in the supplied sources; otherwise speak
  in terms of frameworks, ranges, and reasoning rather than fabricated data points.

SEO requirements (follow the pillar-cluster keyword model and on-page best practices):
- The H1 and meta title must contain the primary keyword near the front.
- Use a clear H1 > H2 > H3 hierarchy. Each H2 should map to one subtopic/search-intent angle.
- meta_title: <= 60 characters. meta_description: <= 155 characters, includes the primary keyword,
  and states the concrete benefit to the reader.
- Weave supporting keywords naturally into subheads and body copy — never stuff or repeat unnaturally.
  You may merge two close keywords into one phrase or swap a keyword for a natural synonym/variant
  if that reads better — but you MUST report every such substitution in "keyword_usage" below so the
  original target keyword and the swapped-in form are both tracked, never silently dropped.
- Include a FAQ section (4-6 Q&As) written for featured-snippet / People Also Ask style queries.
- Cite the supplied sources inline where relevant (e.g. "according to [Source Name]") and only use
  facts that are recent and attributable to those sources.
- Output must be publish-ready: no placeholders, no "[insert here]", no lorem ipsum.

Respond with ONLY a JSON object matching this TypeScript shape, no markdown fences, no commentary:
{
  "title": string,
  "meta_title": string,
  "meta_description": string,
  "h1": string,
  "content_md": string, // full article body in markdown, using ## and ### headings, NOT including the H1 or FAQ section
  "faqs": [{ "question": string, "answer": string }],
  "keywords_used": string[], // every keyword (primary + supporting) actually woven into content_md
  "keyword_usage": [{ "original": string, "used_as": string }]
  // ONE entry per keyword in keywords_used, in the SAME order. If you wrote the keyword exactly as
  // given, used_as === original. If you merged it with another keyword or swapped in a synonym,
  // used_as is the literal text that actually appears in content_md so it can still be located and
  // tied back to the original target keyword.
}`;

export async function generateArticle(input: GenerateInput): Promise<GeneratedArticle> {
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

  const userPrompt = `Cluster: ${input.clusterName}
Primary keyword: ${input.primaryKeyword}
Supporting keywords: ${input.supportingKeywords.join(", ") || "none"}
Editor notes: ${input.notes || "none"}

Recent, credible sources to ground this article in (cite these, prefer the most recent):
${sourceBlock}

Write the full FreelanceAtlas blog post now.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Generation failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const raw = data.content?.[0]?.text ?? "{}";
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  return parsed as GeneratedArticle;
}
