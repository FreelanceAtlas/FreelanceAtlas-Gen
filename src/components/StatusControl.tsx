"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function StatusControl({ articleId, status }: { articleId: string; status: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [current, setCurrent] = useState(status);

  async function update(next: string) {
    setCurrent(next);
    await supabase.from("articles").update({ status: next }).eq("id", articleId);
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
