"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateAffiliateLink } from "@/app/dashboard/actions";

export default function AffiliateLinkRow({
  id, label, category, url: initialUrl, triggerKeywords, isActive,
}: {
  id: string; label: string; category: string | null; url: string | null;
  triggerKeywords: string[]; isActive: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl ?? "");
  const [active, setActive] = useState(isActive);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await updateAffiliateLink(id, url, active);
    setSaving(false);
    router.refresh();
  }

  return (
    <tr className="border-b border-atlasnavy/5 text-sm">
      <td className="py-2 font-medium text-atlasnavy">{label}</td>
      <td className="py-2 text-atlasnavy/60">{category}</td>
      <td className="py-2 text-atlasnavy/60">{triggerKeywords.join(", ")}</td>
      <td className="py-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="paste your affiliate URL"
          className="w-64 rounded-md border border-atlasnavy/20 px-2 py-1 text-xs"
        />
      </td>
      <td className="py-2 text-center">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </td>
      <td className="py-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-atlasteal px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </td>
    </tr>
  );
}
