"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { revertKeywordToUnused } from "@/app/dashboard/actions";

// Renders the Status cell for one keyword row. "Used" keywords get a small
// "Revert to unused" control — this never deletes the keyword row, it just
// flips is_used back to false so the keyword reappears as "Available" in the
// bank (and on the Generate form) right away.
export default function KeywordStatusControl({ keywordId, isUsed }: { keywordId: string; isUsed: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(isUsed);

  async function revert() {
    setError(null);
    setPending(true);
    try {
      await revertKeywordToUnused(keywordId);
      setCurrent(false);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not revert keyword");
    } finally {
      setPending(false);
    }
  }

  if (!current) {
    return <span className="text-green-700">Available</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span>Used</span>
      <button
        type="button"
        onClick={revert}
        disabled={pending}
        title="Keep this keyword, just mark it unused again"
        className="rounded-full border border-atlasnavy/20 px-2 py-0.5 text-[10px] font-semibold text-atlasnavy/70 hover:bg-atlasnavy/5 disabled:opacity-50"
      >
        {pending ? "Reverting…" : "Revert to unused"}
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
