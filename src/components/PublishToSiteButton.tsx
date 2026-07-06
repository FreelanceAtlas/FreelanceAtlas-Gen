"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { publishArticleToSite } from "@/app/dashboard/actions";

// "Publish live" control for articles already pushed to WordPress as a draft.
// Confirms first (this makes the post publicly live), then flips the WP post to
// published and moves the row to the "Live on site" section.
export default function PublishToSiteButton({ articleId, compact = false }: { articleId: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    if (pending) return;
    if (!window.confirm("Publish this post live on freelanceatlas.com? It will be publicly visible.")) return;
    setError(null);
    setPending(true);
    try {
      await publishArticleToSite(articleId);
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
        {pending ? "Publishing…" : "Publish live"}
      </button>
      {error && <p className="max-w-[16rem] text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
