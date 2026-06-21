// AI-generated "Suggest a topic" — finds a fresh angle for a cluster instead
// of just randomly picking from the (small, finite, often-fully-used)
// keyword bank. Checks the suggestion against every keyword and title
// already associated with the cluster so it doesn't repeat ground that's
// already been covered.

import { stripDashes } from "./textClean";

export interface SuggestTopicInput {
  clusterName: string;
  coveredKeywords: string[];
  coveredTitles: string[];
}

export interface SuggestedTopic {
  topic: string;
  rationale: string;
}

const SYSTEM_PROMPT = `You are the content strategist for FreelanceAtlas (freelanceatlas.com), a blog
that gives freelancers practical, no-fluff money and business advice. You're picking the next
topic to write about within a single content cluster.

Titles/topics are concrete and specific (often with a number, a year, or a clear promise), matching
the live site's style, e.g. "How Much Should You Charge on Upwork? (By Skill, 2026)" or
"Why Your Upwork Proposals Get No Replies (7 Real Reasons)" or
"Can You Really Make a Living on Upwork? Here Is the Breakdown".

You will be given the cluster name, every keyword already in that cluster's research bank
(used or not), and every title already published or drafted in that cluster. Your job is to propose
exactly ONE new topic for this cluster that:
- Is a genuinely different angle, not a rephrasing, narrowing, or close variant of anything already
  covered. Skip it if a reasonable reader would feel they already read this.
- Is specific enough to write a focused, useful post about, not a vague generic theme.
- Fits naturally within the named cluster and would make sense as a primary SEO keyword/topic for it.
- Never uses an em dash. Join clauses with a period, comma, or connector word instead.
- Never uses a hyphen surrounded by spaces, or a double hyphen, as a substitute for a dash.

Call the submit_topic tool exactly once with your suggestion. Do not respond with plain text.`;

const TOPIC_TOOL = {
  name: "submit_topic",
  description: "Submit one fresh topic suggestion for the cluster.",
  input_schema: {
    type: "object" as const,
    properties: {
      topic: {
        type: "string",
        description: "The suggested primary keyword/topic, phrased the way a FreelanceAtlas title would be.",
      },
      rationale: {
        type: "string",
        description: "One short sentence on why this angle is fresh and fits the cluster.",
      },
    },
    required: ["topic", "rationale"],
  },
};

export async function suggestFreshTopic(input: SuggestTopicInput): Promise<SuggestedTopic> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Add it in your Vercel project's environment variables to enable topic suggestions."
    );
  }

  const keywordBlock = input.coveredKeywords.length
    ? input.coveredKeywords.map((k) => `- ${k}`).join("\n")
    : "None yet, this cluster's bank is empty.";

  const titleBlock = input.coveredTitles.length
    ? input.coveredTitles.map((t) => `- ${t}`).join("\n")
    : "None yet, nothing has been published or drafted in this cluster.";

  const userPrompt = `Cluster: ${input.clusterName}

Keywords already in this cluster's research bank (used or not, all already explored):
${keywordBlock}

Titles already published or drafted in this cluster:
${titleBlock}

Suggest one fresh topic for this cluster now by calling submit_topic.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [TOPIC_TOOL],
      tool_choice: { type: "tool", name: "submit_topic" },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Topic suggestion failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const toolUse = (data.content ?? []).find((block: any) => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("The model did not return a topic suggestion. Try again.");
  }

  const result = toolUse.input as SuggestedTopic;
  return {
    topic: stripDashes(result.topic),
    rationale: stripDashes(result.rationale),
  };
}
