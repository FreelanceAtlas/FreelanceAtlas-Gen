"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateArticleStatus } from "@/app/dashboard/actions";

export default function StatusControl({ articleId, status }: { articleId: string; status: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);

  async function update(next: string) {
    setCurrent(next);
    await updateArticleStatus(articleId, next);
    router.refresh();
  }

  return (
    <select
      value={current}
      onChange={(e) => update(e.target.value)}
      className="rounded-md border border-atlasnavy/20 px-2 py-1 text-xs capitalize"
    >
      <option value="draft">Draft</option>
      <option value="review">In review</option>
      <option value="published">Published</option>
    </select>
  );
}
