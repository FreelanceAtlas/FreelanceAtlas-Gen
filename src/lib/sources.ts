// Finds high-authority, topically relevant sources for a keyword/cluster using
// Claude's built-in server-side web_search tool — no separate search-API key
// required, just the ANTHROPIC_API_KEY already configured for generation.

export interface SourceCandidate {
  url: string;
  title: string;
  publishedDate?: string;
  domain: string;
  authorityNote: string; // short reason this source is credible / high-authority
}

export interface ResearchResult {
  sources: SourceCandidate[];
  suggestedFaqs: string[]; // real reader questions found while researching (People Also Ask, forums, etc.)
}

const RESEARCH_TOOL = {
  name: "submit_research",
  description: "Submit the final list of researched sources and suggested reader FAQs for this topic.",
  input_schema: {
    type: "object" as const,
    properties: {
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            title: { type: "string" },
            publishedDate: { type: "string", description: "YYYY-MM-DD if known/visible, otherwise omit." },
            domain: { type: "string", description: 'Bare domain, e.g. "nerdwallet.com"' },
            authorityNote: {
              type: "string",
              description: "One short sentence on why this source is credible/high-authority for this topic.",
            },
          },
          required: ["url", "title", "domain", "authorityNote"],
        },
        description: "Up to 10 real, currently-live sources actually returned by your web searches. Never invent a URL, title, or date.",
      },
      suggested_faqs: {
        type: "array",
        items: { type: "string" },
        description: "5-8 real, specific questions readers actually ask about this topic (question text only).",
      },
    },
    required: ["sources", "suggested_faqs"],
  },
};

export async function fetchResearch(
  primaryKeyword: string,
  supportingKeywords: string[],
  clusterName: string
): Promise<ResearchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Add it in your Vercel project's environment variables to enable source fetching."
    );
  }

  const systemPrompt = `You are a research assistant for FreelanceAtlas, a freelancer-finance blog.
Use the web_search tool to find real, currently live pages that would make credible, citable sources
for an article on the given topic.

Prioritize:
- Established publications and recognized industry blogs/platforms (e.g. major business, finance,
  or freelancing-platform publications), government/.edu/.gov pages, and sites with strong topical
  authority for THIS specific topic — not just generically famous sites.
- Pages that are actually about this topic (not just the homepage of a famous site).
- A mix of source types where possible (data/stats pages, platform official blogs, reputable news/trade
  press, expert how-to guides) rather than 10 near-duplicates of the same site.

Do several searches with different phrasings of the topic and supporting keywords before finalizing
your list. Only include a URL if your search actually returned it — never invent a URL, title, or date.

While you search, also note the most relevant questions real readers actually ask about this topic —
"People Also Ask" boxes, related-questions panels, forum/Reddit/Quora thread titles, and FAQ sections
on the pages you find. These will become the FAQ section of the article, so prefer specific, commonly
asked questions over generic ones.

Return exactly 10 sources if you can find 10 genuinely relevant ones; if fewer qualify, return fewer
rather than padding with weak or irrelevant results.

Once you are done researching, call the submit_research tool exactly once with your final sources and
suggested FAQs. Do not respond with plain text.`;

  const userPrompt = `Cluster: ${clusterName}
Primary keyword / topic: ${primaryKeyword}
Supporting keywords: ${supportingKeywords.join(", ") || "none"}

Find 10 high-authority, relevant sources for this topic, and the most relevant reader FAQs, now.`;

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
      messages: [{ role: "user", content: userPrompt }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 6,
        },
        RESEARCH_TOOL,
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Source fetch failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (data.stop_reason === "max_tokens") {
    throw new Error(
      "Source research was cut off because it exceeded the model's output limit. Try again, or narrow the topic."
    );
  }

  const toolUse = (data.content ?? []).find(
    (block: any) => block.type === "tool_use" && block.name === "submit_research"
  );

  if (!toolUse) {
    throw new Error("The model did not return structured research (no submit_research tool call found). Try fetching sources again.");
  }

  const parsed = toolUse.input as { sources?: any[]; suggested_faqs?: any[] };
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const suggestedFaqs = Array.isArray(parsed.suggested_faqs) ? parsed.suggested_faqs : [];

  return {
    sources: sources
      .filter((s: any) => s && s.url && s.title)
      .slice(0, 10)
      .map((s: any) => ({
        url: s.url,
        title: s.title,
        publishedDate: s.publishedDate ?? undefined,
        domain: s.domain ?? new URL(s.url).hostname.replace(/^www\./, ""),
        authorityNote: s.authorityNote ?? "",
      })),
    suggestedFaqs: suggestedFaqs.filter((q: any) => typeof q === "string" && q.trim()).slice(0, 8),
  };
}
