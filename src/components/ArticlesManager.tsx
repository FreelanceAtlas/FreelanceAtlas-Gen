"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { scheduleArticle, unscheduleArticle, bulkDeleteArticles } from "@/app/dashboard/actions";

export interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  clusterName: string | null;
  originalityScore: number | null;
  originalityNeedsReview: boolean;
  factCheckScore: number | null;
  factCheckNeedsReview: boolean;
  scheduledPublishAt: string | null;
  ready: boolean;
}

function formatScheduled(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ScoreBadges({ row }: { row: ArticleRow }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span
        className={`rounded-full px-1.5 py-0.5 ${
          row.originalityScore === null
            ? "bg-atlasnavy/10 text-atlasnavy/50"
            : row.originalityNeedsReview || row.originalityScore < 80
            ? "bg-amber-100 text-amber-700"
            : "bg-emerald-100 text-emerald-700"
        }`}
      >
        Orig {row.originalityScore ?? "—"}
      </span>
      <span
        className={`rounded-full px-1.5 py-0.5 ${
          row.factCheckScore === null
            ? "bg-atlasnavy/10 text-atlasnavy/50"
            : row.factCheckNeedsReview || row.factCheckScore < 90
            ? "bg-amber-100 text-amber-700"
            : "bg-emerald-100 text-emerald-700"
        }`}
      >
        Fact {row.factCheckScore ?? "—"}
      </span>
    </div>
  );
}

function ScheduleControl({ row }: { row: ArticleRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!value) return;
    setPending(true);
    setError(null);
    try {
      await scheduleArticle(row.id, new Date(value).toISOString());
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not schedule");
    } finally {
      setPending(false);
    }
  }

  async function clear() {
    setPending(true);
    setError(null);
    try {
      await unscheduleArticle(row.id);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not unschedule");
    } finally {
      setPending(false);
    }
  }

  if (row.scheduledPublishAt) {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">
          Scheduled {formatScheduled(row.scheduledPublishAt)}
        </span>
        <button
          onClick={clear}
          disabled={pending}
          className="text-atlasnavy/50 underline hover:text-atlasnavy disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] text-atlasnavy/60 underline hover:text-atlasnavy"
      >
        Schedule
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-md border border-atlasnavy/20 px-1.5 py-0.5 text-[11px]"
      />
      <button
        onClick={save}
        disabled={pending || !value}
        className="rounded-md bg-atlasnavy px-2 py-0.5 text-[11px] text-white disabled:opacity-50"
      >
        Set
      </button>
      <button onClick={() => setOpen(false)} className="text-[11px] text-atlasnavy/50 hover:text-atlasnavy">
        Cancel
      </button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

function ArticleRowItem({
  row,
  selected,
  onToggle,
}: {
  row: ArticleRow;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 rounded border-atlasnavy/30"
        />
        <div className="min-w-0">
          <Link href={`/dashboard/articles/${row.slug}`} className="font-medium text-atlasnavy hover:underline">
            {row.title}
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <span className="text-xs text-atlasnavy/50">{row.clusterName}</span>
            <ScoreBadges row={row} />
          </div>
        </div>
      </div>
      <ScheduleControl row={row} />
    </li>
  );
}

function SelectableSection({
  title,
  description,
  rows,
  selected,
  setSelected,
}: {
  title: string;
  description: string;
  rows: ArticleRow[];
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
}) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    const next = new Set(selected);
    if (allSelected) {
      rows.forEach((r) => next.delete(r.id));
    } else {
      rows.forEach((r) => next.add(r.id));
    }
    setSelected(next);
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-atlasnavy">{title}</h2>
          <p className="text-xs text-atlasnavy/50">{description}</p>
        </div>
        {rows.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-atlasnavy/60">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-3.5 w-3.5" />
            Select all
          </label>
        )}
      </div>
      <ul className="mt-2 divide-y divide-atlasnavy/10 rounded-xl bg-white shadow-sm">
        {rows.map((row) => (
          <ArticleRowItem key={row.id} row={row} selected={selected.has(row.id)} onToggle={() => toggleOne(row.id)} />
        ))}
        {rows.length === 0 && <li className="px-5 py-3 text-sm text-atlasnavy/50">None right now.</li>}
      </ul>
    </div>
  );
}

export default function ArticlesManager({ articles }: { articles: ArticleRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSchedule, setBulkSchedule] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { ready, drafts, published } = useMemo(() => {
    const ready: ArticleRow[] = [];
    const drafts: ArticleRow[] = [];
    const published: ArticleRow[] = [];
    for (const a of articles) {
      if (a.status === "published") published.push(a);
      else if (a.ready) ready.push(a);
      else drafts.push(a);
    }
    return { ready, drafts, published };
  }, [articles]);

  const selectedCount = selected.size;

  async function handleBulkDelete() {
    if (selectedCount === 0) return;
    const confirmed = window.confirm(
      `Permanently delete ${selectedCount} article${selectedCount === 1 ? "" : "s"}? This cannot be undone.`
    );
    if (!confirmed) return;
    setPending(true);
    setError(null);
    try {
      await bulkDeleteArticles(Array.from(selected));
      setSelected(new Set());
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not delete selected articles");
    } finally {
      setPending(false);
    }
  }

  async function handleBulkSchedule() {
    if (selectedCount === 0 || !bulkSchedule) return;
    setPending(true);
    setError(null);
    try {
      const iso = new Date(bulkSchedule).toISOString();
      await Promise.all(Array.from(selected).map((id) => scheduleArticle(id, iso)));
      setSelected(new Set());
      setBulkSchedule("");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not schedule selected articles");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-8">
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-atlasnavy/20 bg-atlassand px-4 py-3">
          <span className="text-sm font-medium text-atlasnavy">{selectedCount} selected</span>
          <input
            type="datetime-local"
            value={bulkSchedule}
            onChange={(e) => setBulkSchedule(e.target.value)}
            className="rounded-md border border-atlasnavy/20 px-2 py-1 text-xs"
          />
          <button
            onClick={handleBulkSchedule}
            disabled={pending || !bulkSchedule}
            className="rounded-md bg-atlasnavy px-3 py-1 text-xs text-white disabled:opacity-50"
          >
            Schedule selected
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={pending}
            className="rounded-md bg-red-600 px-3 py-1 text-xs text-white disabled:opacity-50"
          >
            Delete selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-atlasnavy/50 underline hover:text-atlasnavy"
          >
            Clear selection
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <SelectableSection
        title="Ready to publish"
        description="Passed both the originality and fact-check gates — just needs a click, or schedule it."
        rows={ready}
        selected={selected}
        setSelected={setSelected}
      />

      <SelectableSection
        title="Drafts"
        description="Still needs work, a recheck, or hasn't been checked yet."
        rows={drafts}
        selected={selected}
        setSelected={setSelected}
      />

      <div>
        <h2 className="text-sm font-semibold text-atlasnavy">Published</h2>
        <ul className="mt-2 divide-y divide-atlasnavy/10 rounded-xl bg-white shadow-sm">
          {published.map((row) => (
            <li key={row.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <Link href={`/dashboard/articles/${row.slug}`} className="font-medium text-atlasnavy hover:underline">
                {row.title}
              </Link>
              <span className="text-xs text-atlasnavy/50">{row.clusterName}</span>
            </li>
          ))}
          {published.length === 0 && <li className="px-5 py-3 text-sm text-atlasnavy/50">None yet.</li>}
        </ul>
      </div>
    </div>
  );
}
