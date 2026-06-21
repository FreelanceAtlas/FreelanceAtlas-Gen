import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripDashes } from "@/lib/textClean";
import { ORIGINALITY_PASS_THRESHOLD } from "@/lib/originality";
import { FACT_CHECK_PASS_THRESHOLD } from "@/lib/factcheck";

// Triggered on a schedule by Vercel Cron (see vercel.json). Finds every
// non-published article whose scheduled_publish_at has arrived and publishes
// it: same gate logic as the manual "Publish anyway" override in
// updateArticleStatus (a scheduled publish is always allowed through, since
// the editor already chose the time deliberately), and the same defensive
// em-dash/stray-hyphen sanitize pass on h1/meta/content_md. Clears
// scheduled_publish_at on every row it touches, success or failure, so a
// broken article can't retry forever and silently block the cron run.
//
// Auth: requires `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron sends
// this header automatically when CRON_SECRET is set as a project env var.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient();
  const nowIso = new Date().toISOString();

  const { data: due, error: fetchError } = await supabase
    .from("articles")
    .select("id, slug, h1, meta_title, meta_description, content_md")
    .neq("status", "published")
    .not("scheduled_publish_at", "is", null)
    .lte("scheduled_publish_at", nowIso);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const results: { id: string; slug: string; published: boolean; error?: string }[] = [];

  for (const article of due ?? []) {
    try {
      const { error } = await supabase
        .from("articles")
        .update({
          status: "published",
          h1: stripDashes(article.h1 ?? ""),
          meta_title: stripDashes(article.meta_title ?? ""),
          meta_description: stripDashes(article.meta_description ?? ""),
          content_md: stripDashes(article.content_md ?? ""),
          scheduled_publish_at: null,
        })
        .eq("id", article.id);

      if (error) throw new Error(error.message);
      results.push({ id: article.id, slug: article.slug, published: true });
    } catch (err: any) {
      // Don't leave a broken article scheduled forever — clear the schedule
      // and surface the failure in the response so it can be re-scheduled.
      await supabase.from("articles").update({ scheduled_publish_at: null }).eq("id", article.id);
      results.push({ id: article.id, slug: article.slug, published: false, error: err?.message ?? "Unknown error" });
    }
  }

  return NextResponse.json({
    checkedAt: nowIso,
    publishGates: { ORIGINALITY_PASS_THRESHOLD, FACT_CHECK_PASS_THRESHOLD },
    processed: results.length,
    results,
  });
}
