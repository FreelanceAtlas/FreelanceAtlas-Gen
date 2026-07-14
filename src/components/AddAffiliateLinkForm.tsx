"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAffiliateLink } from "@/app/dashboard/actions";

export default function AddAffiliateLinkForm() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [triggerKeywords, setTriggerKeywords] = useState("");
  const [url, setUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!label.trim()) {
      setError("Tool name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createAffiliateLink({
        label,
        category,
        triggerKeywords: triggerKeywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        url,
        isActive,
      });
      setLabel("");
      setCategory("");
      setTriggerKeywords("");
      setUrl("");
      setIsActive(true);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Could not add tool");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-atlasnavy/5 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-atlasnavy">Add a new tool to the bank</h2>
      <p className="mt-1 text-xs text-atlasnavy/50">
        New tools start with no URL, so the generator will just mention the tool by name until you
        paste a real affiliate link below — never a placeholder.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="block text-xs font-medium text-atlasnavy">Tool name</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. FreshBooks"
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-atlasnavy">Category</label>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. invoicing"
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-atlasnavy">
            Trigger words (comma separated)
          </label>
          <input
            value={triggerKeywords}
            onChange={(e) => setTriggerKeywords(e.target.value)}
            placeholder="freshbooks, fresh books"
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-atlasnavy">Affiliate URL (optional)</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="paste your affiliate URL"
            className="mt-1 w-full rounded-md border border-atlasnavy/20 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-1.5 text-xs text-atlasnavy/70">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active
          </label>
          <button
            onClick={submit}
            disabled={saving}
            className="ml-auto rounded-md bg-atlasteal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add tool"}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
