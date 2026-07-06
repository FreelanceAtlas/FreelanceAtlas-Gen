"use client";

import { useState } from "react";
import { publishContentToWordPress, publishPostToSiteById } from "@/app/dashboard/actions";

// Standalone test harness: a hardcoded dummy article + a button that runs the
// exact production path (OpenRouter format -> WordPress draft) so you can verify
// formatting and publishing WITHOUT any Supabase data. Safe: always a draft.
const DUMMY = {
  h1: "The Freelance Hourly Rate Formula: What Your Time Is Really Worth",
  title: "The Freelance Hourly Rate Formula (Dummy Test)",
  meta_title: "Freelance Hourly Rate Formula (What Your Time Is Worth)",
  meta_description:
    "Your headline rate is not your income. Use the freelance hourly rate formula to find your true minimum and stop underpricing by accident.",
  slug: "dummy-freelance-hourly-rate-formula-test",
  content_md: `Most freelancers guess their freelance hourly rate, then wonder why they work constantly and still feel broke. The reason is simple: your headline rate is not what you keep.

At FreelanceAtlas, we help freelancers price for a real living, not a guess. In this guide, we will walk through **the freelance hourly rate formula** and what your time is actually worth.

## Why Your Rate Is Not Your Income

A 50-dollar hourly rate does not mean 50 dollars in your pocket. Platform fees, taxes, business expenses, and unpaid hours such as admin, sales, and revisions all reduce it.

## The Freelance Hourly Rate Formula

Work backward from take-home, not forward from a guess:

- **Start with your target monthly take-home,** what you want in your pocket.
- **Add taxes** by grossing it up for your set-aside rate.
- **Add business expenses** like software, fees, and equipment.
- **Divide by real billable hours,** not 40 a week. Most freelancers bill 25 to 30 productive hours.

That gives you a true minimum rate, the number below which you actually lose money.

## Conclusion

Your time is worth more than your headline rate suggests, once you account for what gets taken out. Calculate your true minimum, price above it, and stop trading hours for too little.`,
  faqs: [
    {
      question: "How do I calculate my freelance hourly rate?",
      answer:
        "Start with your target monthly take-home, gross it up for taxes, add business expenses, then divide by your realistic billable hours. The result is your true minimum rate.",
    },
    {
      question: "How many billable hours can a freelancer actually work?",
      answer:
        "Most full-time freelancers bill around 25 to 30 productive hours a week, because sales, admin, and revisions take up the rest.",
    },
    {
      question: "Why do I feel broke despite a decent hourly rate?",
      answer:
        "Because fees, taxes, expenses, and unpaid hours eat into your headline rate. Your real take-home is lower than your quoted rate suggests.",
    },
  ],
};

export default function WpTestPage() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ id: number; editLink: string; link: string; bodyHtml: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [liveLink, setLiveLink] = useState<string | null>(null);

  async function run() {
    setError(null);
    setPending(true);
    setResult(null);
    setLiveLink(null);
    try {
      const r = await publishContentToWordPress(DUMMY);
      setResult({ id: r.id, editLink: r.editLink, link: r.link, bodyHtml: r.bodyHtml });
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  async function publishLive() {
    if (!result) return;
    if (!window.confirm("Publish this dummy post live on freelanceatlas.com?")) return;
    setError(null);
    setPublishing(true);
    try {
      const r = await publishPostToSiteById(result.id);
      setLiveLink(r.link);
    } catch (err: any) {
      setError(err?.message ?? "Could not publish live.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-atlasnavy">WordPress publish test</h1>
      <p className="mt-2 text-sm text-atlasnavy/60">
        This uses a hardcoded dummy article (no Supabase). Clicking the button runs the real path:
        format via OpenRouter into the live theme HTML, then create a <strong>draft</strong> on
        freelanceatlas.com. Always a draft, never published.
      </p>

      <div className="mt-4 rounded-xl bg-white p-4 text-sm shadow-sm">
        <p><span className="font-semibold text-atlasnavy">Title:</span> {DUMMY.title}</p>
        <p className="mt-1"><span className="font-semibold text-atlasnavy">Slug:</span> /{DUMMY.slug}</p>
        <p className="mt-1"><span className="font-semibold text-atlasnavy">Meta title:</span> {DUMMY.meta_title}</p>
        <p className="mt-1"><span className="font-semibold text-atlasnavy">Meta description:</span> {DUMMY.meta_description}</p>
        <p className="mt-1"><span className="font-semibold text-atlasnavy">FAQs:</span> {DUMMY.faqs.length}</p>
      </div>

      <button
        onClick={() => setShowContent((v) => !v)}
        className="mt-4 mr-3 rounded-md border border-atlasnavy/20 px-4 py-2 text-sm font-medium text-atlasnavy hover:bg-atlassand"
      >
        {showContent ? "Hide blog content" : "Read blog content"}
      </button>

      <button
        onClick={run}
        disabled={pending}
        className="mt-4 rounded-md bg-atlasnavy px-4 py-2 text-sm font-medium text-white hover:bg-atlasnavy/90 disabled:opacity-50"
      >
        {pending ? "Formatting & publishing…" : "Format & send draft to WordPress"}
      </button>

      {showContent && (
        <div className="mt-4 space-y-4 rounded-xl border border-atlasnavy/15 bg-white p-5 shadow-sm">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-atlasteal">H1</p>
            <p className="text-base font-bold text-atlasnavy">{DUMMY.h1}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-atlasteal">
              Body (raw markdown, pre-format)
            </p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-atlasnavy/5 p-4 text-xs leading-relaxed text-atlasnavy/80">
              {DUMMY.content_md}
            </pre>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-atlasteal">
              FAQs ({DUMMY.faqs.length})
            </p>
            <ul className="space-y-2">
              {DUMMY.faqs.map((f, i) => (
                <li key={i} className="rounded-lg bg-atlasnavy/5 p-3 text-sm">
                  <p className="font-semibold text-atlasnavy">{f.question}</p>
                  <p className="mt-1 text-atlasnavy/70">{f.answer}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
            <p className="font-semibold text-emerald-800">✓ Draft created on WordPress.</p>
            <a
              href={result.editLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block font-medium text-emerald-700 underline"
            >
              Open draft in WP Admin →
            </a>
            <div className="mt-3 flex items-center gap-3">
              {!liveLink && (
                <button
                  onClick={publishLive}
                  disabled={publishing}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {publishing ? "Publishing…" : "Publish live"}
                </button>
              )}
              {liveLink && (
                <a
                  href={liveLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-emerald-800 underline"
                >
                  ✓ Now live — view post →
                </a>
              )}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-atlasnavy">Formatted HTML that was sent:</p>
            <pre className="max-h-96 overflow-auto rounded-xl bg-atlasnavy/5 p-4 text-xs text-atlasnavy/80">
              {result.bodyHtml}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
