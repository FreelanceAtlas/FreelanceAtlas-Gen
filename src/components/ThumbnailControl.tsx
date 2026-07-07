"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { generateArticleThumbnail, redoArticleThumbnail } from "@/app/dashboard/actions";

// Featured-image control for a ready-to-publish article.
// - No thumbnail yet  -> "Generate image" button (with loading bar).
// - Has a thumbnail   -> preview + a "Redo with notes" box (with loading bar).
// The generated image is stored on the article and attached automatically when
// the article is later sent to WordPress.
export default function ThumbnailControl({
  articleId,
  thumbnailUrl,
  thumbnailStatus,
}: {
  articleId: string;
  thumbnailUrl: string | null;
  thumbnailStatus?: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(thumbnailUrl);
  const [localPending, setLocalPending] = useState(false);
  const [phase, setPhase] = useState<"generate" | "redo" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Keep the preview in sync when a poll refreshes the server prop.
  useEffect(() => {
    if (thumbnailUrl) setUrl(`${thumbnailUrl}?t=${Date.now()}`);
  }, [thumbnailUrl]);

  // Persisted processing state survives refresh: show the bar and poll until done.
  const serverProcessing = thumbnailStatus === "processing";
  const pending = localPending || serverProcessing;

  useEffect(() => {
    if (!serverProcessing) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [serverProcessing, router]);

  async function generate() {
    setError(null);
    setLocalPending(true);
    setPhase("generate");
    try {
      const r = await generateArticleThumbnail(articleId);
      setUrl(`${r.url}?t=${Date.now()}`); // cache-bust
    } catch (e: any) {
      setError(e?.message ?? "Could not generate thumbnail.");
    } finally {
      setLocalPending(false);
      setPhase(null);
      router.refresh();
    }
  }

  async function redo() {
    if (!note.trim()) return;
    setError(null);
    setLocalPending(true);
    setPhase("redo");
    try {
      const r = await redoArticleThumbnail(articleId, note.trim());
      setUrl(`${r.url}?t=${Date.now()}`);
      setNote("");
    } catch (e: any) {
      setError(e?.message ?? "Could not redo thumbnail.");
    } finally {
      setLocalPending(false);
      setPhase(null);
      router.refresh();
    }
  }

  return (
    <div className="w-72 shrink-0 rounded-xl border border-atlasnavy/10 bg-white p-3">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Thumbnail preview" className="aspect-[16/9] w-full rounded-lg object-cover" />
      ) : (
        <div className="flex aspect-[16/9] w-full items-center justify-center rounded-lg bg-atlasnavy/5 text-xs text-atlasnavy/40">
          No thumbnail yet
        </div>
      )}

      {pending && (
        <div className="mt-2">
          <div className="progress-track" />
          <p className="mt-1 text-[11px] text-atlasnavy/50">
            {phase === "redo" ? "Redoing thumbnail…" : "Generating thumbnail…"}
          </p>
        </div>
      )}

      {!pending && !url && (
        <button
          onClick={generate}
          className="mt-2 w-full rounded-md bg-atlasnavy px-3 py-1.5 text-xs font-medium text-white hover:bg-atlasnavy/90"
        >
          Generate image
        </button>
      )}

      {!pending && url && (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Change notes (e.g. make it object-only, add a chart, warmer colors)…"
            rows={2}
            className="w-full resize-none rounded-md border border-atlasnavy/20 px-2 py-1 text-[11px]"
          />
          <button
            onClick={redo}
            disabled={!note.trim()}
            className="w-full rounded-md border border-atlasnavy/20 px-3 py-1.5 text-xs font-medium text-atlasnavy hover:bg-atlassand disabled:opacity-50"
          >
            Redo with notes
          </button>
        </div>
      )}

      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
