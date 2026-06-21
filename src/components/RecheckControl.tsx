"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recheckArticleChecks } from "@/app/dashboard/actions";

export default function RecheckControl({ articleId }: { articleId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    originalityCheck: { originality_score: number };
    factCheck: { accuracy_score: number };
  } | null>(null);

  async function run() {
    setError(null);
    setPending(true);
    try {
      const result = await recheckArticleChecks(articleId);
      setLastResult(result);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Recheck failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 text-right">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-md border border-atlasnavy/20 px-2 py-1 text-xs font-medium text-atlasnavy hover:bg-atlasnavy/5 disabled:opacity-50"
      >
        {pending ? "Rechecking…" : "Re-run originality / fact-check"}
      </button>
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
