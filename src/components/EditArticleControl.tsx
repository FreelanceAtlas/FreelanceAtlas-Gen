"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateArticleContent } from "@/app/dashboard/actions";

export default function EditArticleControl({
  articleId,
  h1,
  metaTitle,
  metaDescription,
  contentMd,
}: {
  articleId: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  contentMd: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formH1, setFormH1] = useState(h1);
  const [formMetaTitle, setFormMetaTitle] = useState(metaTitle);
  const [formMetaDescription, setFormMetaDescription] = useState(metaDescription);
  const [formContentMd, setFormContentMd] = useState(contentMd);

  function openEditor() {
    setFormH1(h1);
    setFormMetaTitle(metaTitle);
    setFormMetaDescription(metaDescription);
    setFormContentMd(contentMd);
    setError(null);
    setEditing(true);
  }

  function cancelEditor() {
    setError(null);
    setEditing(false);
  }

  async function save() {
    setError(null);
    setPending(true);
    try {
      await updateArticleContent(articleId, {
        h1: formH1,
        metaTitle: formMetaTitle,
        metaDescription: formMetaDescription,
        contentMd: formContentMd,
      });
      setEditing(false);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Save failed");
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="mt-4 text-right">
        <button
          type="button"
          onClick={openEditor}
          className="rounded-md border border-atlasnavy/20 px-2 py-1 text-xs font-medium text-atlasnavy hover:bg-atlasnavy/5"
        >
          Edit article
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-atlasnavy/20 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-atlasnavy/60">
          Edit article
        </h2>
        <span className="text-xs text-atlasnavy/50">Save before choosing to publish</span>
      </div>

      <label className="mt-3 block text-xs font-medium text-atlasnavy/70">H1 / Title</label>
      <input
        type="text"
        value={formH1}
        onChange={(e) => setFormH1(e.target.value)}
        className="mt-1 w-full rounded-md border border-atlasnavy/20 px-2 py-1 text-sm"
      />

      <label className="mt-3 block text-xs font-medium text-atlasnavy/70">Meta title</label>
      <input
        type="text"
        value={formMetaTitle}
        onChange={(e) => setFormMetaTitle(e.target.value)}
        className="mt-1 w-full rounded-md border border-atlasnavy/20 px-2 py-1 text-sm"
      />

      <label className="mt-3 block text-xs font-medium text-atlasnavy/70">Meta description</label>
      <textarea
        value={formMetaDescription}
        onChange={(e) => setFormMetaDescription(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-md border border-atlasnavy/20 px-2 py-1 text-sm"
      />

      <label className="mt-3 block text-xs font-medium text-atlasnavy/70">
        Article body (Markdown)
      </label>
      <textarea
        value={formContentMd}
        onChange={(e) => setFormContentMd(e.target.value)}
        rows={20}
        className="mt-1 w-full rounded-md border border-atlasnavy/20 px-2 py-2 font-mono text-xs leading-relaxed"
      />

      <p className="mt-2 text-xs text-atlasnavy/50">
        Em dashes and stray dash-hyphens are auto-cleaned on save.
      </p>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={cancelEditor}
          disabled={pending}
          className="rounded-md border border-atlasnavy/20 px-3 py-1.5 text-xs font-medium text-atlasnavy hover:bg-atlasnavy/5 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-atlasnavy px-3 py-1.5 text-xs font-medium text-white hover:bg-atlasnavy/90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
