"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { publishArticleToSite } from "@/app/dashboard/actions";

// "Publish" control for articles already pushed to WordPress as a draft. Publishing takes
// the next open slot in the 2-3 posts/week cadence: if the last post on the site's calendar
// is 2-3+ days old the post goes live immediately, otherwise it is scheduled (WP-native
// "future" status) a couple of days after that last post and WordPress publishes it itself.
export default function PublishToSiteButton({ articleId, compact = false }: { articleId: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function publish() {
    if (pending) return;
    if (
      !window.confirm(
        "Publish this post on freelanceatlas.com? It takes the next open slot in the 2-3 posts/week cadence — live immediately if the slot is open, otherwise auto-scheduled a couple of days after the latest post."
      )
    )
      return;
    setError(null);
    setNote(null);
    setPending(true);
    try {
      const result = await publishArticleToSite(articleId);
      if (result.scheduledFor) {
        setNote(
          `Scheduled for ${new Date(result.scheduledFor).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}`
        );
      }
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not publish.");
    } finally {
      setPending(false);
    }
  }

  const cls = compact
    ? "rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
    : "rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50";

  return (
    <div className={compact ? "flex items-center gap-2" : ""}>
      <button onClick={publish} disabled={pending} className={cls}>
        {pending ? "Publishing…" : "Publish (auto-slot)"}
      </button>
      {note && <span className="text-[11px] text-sky-700">{note}</span>}
      {error && <p className="max-w-[16rem] text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
