import { NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(request: Request) {
  const { topic } = (await request.json()) as { topic?: string };
  if (!topic?.trim()) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content:
            `Generate a blog post outline for: "${topic}"\n\n` +
            `Return 6-8 H2 section headings, one per line, no numbering, no bullets, no markdown formatting. ` +
            `Each heading should be a specific, practical angle a reader would care about. ` +
            `Skip generic headings like Introduction, Conclusion, Final Thoughts, or FAQ.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[generate/outline] Claude error:", res.status, text.slice(0, 300));
    return NextResponse.json({ error: "Claude API error" }, { status: 502 });
  }

  const data = await res.json();
  const raw: string = data.content?.[0]?.text ?? "";

  const headings = raw
    .split("\n")
    .map((h) => h.trim().replace(/^#+\s*/, "").replace(/^[\*\-]\s*/, ""))
    .filter((h) => h.length > 5 && h.length < 120);

  return NextResponse.json({ headings });
}
