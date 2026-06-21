"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateArticleStatus } from "@/app/dashboard/actions";

export default function StatusControl({ articleId, status }: { articleId: string; status: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function update(next: string, force = false) {
    setError(null);
    setPending(true);
    try {
      await updateArticleStatus(articleId, next, force);
      setCurrent(next);
      router.refresh();
    } catch (err: any) {
      const message = err?.message ?? "Could not update status";
      if (message.startsWith("Originality gate:") && !force) {
        const confirmed = window.confirm(`${message}\n\nPublish anyway?`);
        if (confirmed) {
          await update(next, true);
          return;
        }
      }
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="text-right">
      <select
        value={current}
        disabled={pending}
        onChange={(e) => update(e.target.value)}
        className="rounded-md border border-atlasnavy/20 px-2 py-1 text-xs capitalize disabled:opacity-50"
      >
        <option value="draft">Draft</option>
        <option value="review">In review</option>
        <option value="published">Published</option>
      </select>
      {error && <p className="mt-1 max-w-xs text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
