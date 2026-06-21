"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recheckArticleChecks, rewriteFlaggedOriginality } from "@/app/dashboard/actions";

export default function RecheckControl({
  articleId,
  hasFlaggedIssues = false,
}: {
  articleId: string;
  hasFlaggedIssues?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"recheck" | "rewrite" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    originalityCheck: { originality_score: number; issues?: unknown[] };
    factCheck: { accuracy_score: number };
  } | null>(null);

  async function runRecheck() {
    setError(null);
    setPending("recheck");
    try {
      const result = await recheckArticleChecks(articleId);
      setLastResult(result);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Recheck failed");
    } finally {
      setPending(null);
    }
  }

  async function runRewrite() {
    setError(null);
    setPending("rewrite");
    try {
      const result = await rewriteFlaggedOriginality(articleId);
      setLastResult(result);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Rewrite failed");
    } finally {
      setPending(null);
    }
  }

  const showRewrite =
    hasFlaggedIssues || (lastResult?.originalityCheck?.issues?.length ?? 0) > 0;

  return (
    <div className="mt-2 text-right">
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={runRecheck}
          disabled={pending !== null}
          className="rounded-md border border-atlasnavy/20 px-2 py-1 text-xs font-medium text-atlasnavy hover:bg-atlasnavy/5 disabled:opacity-50"
        >
          {pending === "recheck" ? "Rechecking…" : "Re-run originality / fact-check"}
        </button>
        {showRewrite && (
          <button
            type="button"
            onClick={runRewrite}
            disabled={pending !== null}
            className="rounded-md border border-atlasnavy/20 px-2 py-1 text-xs font-medium text-atlasnavy hover:bg-atlasnavy/5 disabled:opacity-50"
          >
            {pending === "rewrite" ? "Rewriting…" : "Auto-rewrite flagged passages"}
          </button>
        )}
      </div>
      {lastResult && !error && (
        <p className="mt-1 max-w-xs text-right text-xs text-atlasnavy/60">
          Updated: {lastResult.originalityCheck.originality_score}/100 originality,{" "}
          {lastResult.factCheck.accuracy_score}/100 accuracy
        </p>
      )}
      {error && <p className="mt-1 max-w-xs text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
