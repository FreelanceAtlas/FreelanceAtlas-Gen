import { NextResponse } from "next/server";

// Batch generation fan-out: accepts a list of topics and runs them as PARALLEL calls to
// /api/generate (each child is its own serverless invocation with its own 300s budget, so
// N articles take roughly as long as the slowest one, not the sum). This is the entry
// point for "plan and create a month's content in one go".
//
// Parallel-safety inside each child is handled by /api/generate itself: supporting
// keywords are claimed up front (so same-cluster runs pick disjoint sets) and in-flight
// topics join the duplicate guard (so two near-identical topics can't both generate).
//
// The caller's access cookie is forwarded to the children, so this route needs no auth
// logic of its own beyond the middleware gate both routes share. Children keep running
// server-side even if THIS request times out; drafts still land in the dashboard.
export const maxDuration = 300;

// Keeps a single batch inside one serverless fan-out comfortably: a month of content at
// 2-3 posts/week is 8-13 articles, well under this.
const MAX_BATCH_ITEMS = 15;

interface BatchItem {
  clusterId: string;
  primaryKeyword: string;
  supportingKeywords?: string[];
  sources?: { url: string; title: string; publishedDate?: string }[];
  notes?: string;
  suggestedFaqs?: string[];
  force?: boolean;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const items = (body?.items ?? []) as BatchItem[];

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items[] is required" }, { status: 400 });
  }
  if (items.length > MAX_BATCH_ITEMS) {
    return NextResponse.json(
      { error: `Too many items — max ${MAX_BATCH_ITEMS} per batch. Split the plan into multiple batches.` },
      { status: 400 }
    );
  }
  for (const item of items) {
    if (!item?.clusterId || !item?.primaryKeyword) {
      return NextResponse.json({ error: "Every item needs clusterId and primaryKeyword" }, { status: 400 });
    }
  }

  const generateUrl = new URL("/api/generate", request.url).toString();
  const cookie = request.headers.get("cookie") ?? "";

  const results = await Promise.all(
    items.map(async (item, index) => {
      // Small stagger so N simultaneous requests don't all read the duplicate-guard /
      // keyword-bank state in the same instant, before any sibling has registered itself.
      await new Promise((r) => setTimeout(r, index * 1500));
      try {
        const res = await fetch(generateUrl, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            clusterId: item.clusterId,
            primaryKeyword: item.primaryKeyword,
            supportingKeywords: item.supportingKeywords ?? [],
            sources: item.sources ?? [],
            notes: item.notes ?? "",
            suggestedFaqs: item.suggestedFaqs ?? [],
            force: item.force ?? false,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data?.duplicate) {
          return { primaryKeyword: item.primaryKeyword, ok: false, duplicate: true, matches: data.matches };
        }
        if (!res.ok) {
          return { primaryKeyword: item.primaryKeyword, ok: false, error: data?.error ?? `HTTP ${res.status}` };
        }
        const a = data?.article ?? {};
        return {
          primaryKeyword: item.primaryKeyword,
          ok: true,
          articleId: a.id,
          slug: a.slug,
          originalityScore: a.originality_check?.originality_score ?? null,
          factCheckScore: a.fact_check?.accuracy_score ?? null,
        };
      } catch (err: any) {
        return { primaryKeyword: item.primaryKeyword, ok: false, error: String(err?.message ?? err) };
      }
    })
  );

  return NextResponse.json({
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    results,
  });
}
