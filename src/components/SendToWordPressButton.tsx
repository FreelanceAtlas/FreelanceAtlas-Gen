"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendArticleToWordPress } from "@/app/dashboard/actions";

// "Send to WordPress" control. Formats the article into the live theme's HTML
// and creates a DRAFT on freelanceatlas.com, then surfaces the WP admin edit
// link. `compact` renders the tight inline variant used in the Articles list;
// the default is the roomier variant for the article detail page.
export default function SendToWordPressButton({
  articleId,
  compact = false,
}: {
  articleId: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [editLink, setEditLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await sendArticleToWordPress(articleId);
      setEditLink(result.editLink);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not send to WordPress.");
    } finally {
      setPending(false);
    }
  }

  if (editLink) {
    return (
      <a
        href={editLink}
        target="_blank"
        rel="noopener noreferrer"
        className={
          compact
            ? "rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-200"
            : "inline-block rounded-md bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-200"
        }
      >
        ✓ Open draft in WP
      </a>
    );
  }

  const base = compact
    ? "rounded-md bg-atlasnavy px-2 py-0.5 text-[11px] font-medium text-white hover:bg-atlasnavy/90 disabled:opacity-50"
    : "rounded-md bg-atlasnavy px-3 py-1.5 text-xs font-medium text-white hover:bg-atlasnavy/90 disabled:opacity-50";

  return (
    <div className={compact ? "flex items-center gap-2" : "text-right"}>
      <button onClick={send} disabled={pending} className={base}>
        {pending ? "Sending…" : "Send to WordPress"}
      </button>
      {error && (
        <p className={compact ? "max-w-[16rem] text-[11px] text-red-600" : "mt-1 max-w-xs text-right text-xs text-red-600"}>
          {error}
        </p>
      )}
    </div>
  );
}
