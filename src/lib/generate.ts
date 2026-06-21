// Core generation engine: calls the LLM with a FreelanceAtlas-voice system
// prompt, enforces SEO structure, and returns a strict JSON shape we can
// store directly in the `articles` table.

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
- Cite the supplied sources inline where relevant (e.g. "according to [Source Name]") and only use
  facts that are recent and attributable to those sources.
- Output must be publish-ready: no placeholders, no "[insert here]", no lorem ipsum.

Call the submit_article tool exactly once with the completed post. Do not respond with plain text.`;

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

  const faqBlock = input.suggestedFaqs?.length
    ? input.suggestedFaqs.map((q) => `- ${q}`).join("\n")
    : "None supplied — choose the most likely People Also Ask style questions yourself.";

  const userPrompt = `Cluster: ${input.clusterName}
Primary keyword: ${input.primaryKeyword}
Supporting keywords: ${input.supportingKeywords.join(", ") || "none"}
Editor notes: ${input.notes || "none"}

Recent, credible sources to ground this article in (cite these, prefer the most recent):
${sourceBlock}

Real reader questions to address in the FAQ section (cover every one of these, rephrased naturally if needed):
${faqBlock}

Write the full FreelanceAtlas blog post now by calling submit_article.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      // A full article body + 4-6 FAQs + keyword usage table reliably exceeds 4096 tokens.
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: [ARTICLE_TOOL],
      tool_choice: { type: "tool", name: "submit_article" },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Generation failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (data.stop_reason === "max_tokens") {
    throw new Error(
      "Generation was cut off because the article exceeded the model's output limit. Try a narrower topic, or shorten the supporting keyword list, and generate again."
    );
  }

  const toolUse = (data.content ?? []).find((block: any) => block.type === "tool_use");
  if (!toolUse) {
    throw new Error(
      "The model did not return a structured article (no tool call found). Try generating again."
    );
  }

  return toolUse.input as GeneratedArticle;
}
