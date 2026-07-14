import { createClient } from "@/lib/supabase/server";

export default async function DashboardHome() {
  const supabase = createClient();
  const [{ count: articleCount }, { count: clusterCount }, { count: keywordCount }, { data: recent }] =
    await Promise.all([
      supabase.from("articles").select("*", { count: "exact", head: true }),
      supabase.from("clusters").select("*", { count: "exact", head: true }),
      supabase.from("keywords").select("*", { count: "exact", head: true }).eq("is_used", false),
      supabase.from("articles").select("id, title, status, created_at").order("created_at", { ascending: false }).limit(5),
    ]);

  const stats = [
    { label: "Articles generated", value: articleCount ?? 0 },
    { label: "Topic clusters", value: clusterCount ?? 0 },
    { label: "Unused keywords in bank", value: keywordCount ?? 0 },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-atlasnavy">Overview</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-atlasnavy/5 bg-white p-6 shadow-sm">
            <p className="text-4xl font-extrabold tracking-tight text-atlasnavy">{s.value}</p>
            <p className="mt-1.5 text-sm font-medium text-atlasnavy/50">{s.label}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-bold text-atlasnavy">Recent drafts</h2>
      <ul className="mt-3 divide-y divide-atlasnavy/5 overflow-hidden rounded-2xl border border-atlasnavy/5 bg-white shadow-sm">
        {(recent ?? []).map((a) => (
          <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
            <span>{a.title}</span>
            <span className="rounded-full bg-atlassky/60 px-2.5 py-0.5 text-xs font-semibold capitalize text-atlasnavy/70">{a.status}</span>
          </li>
        ))}
        {(!recent || recent.length === 0) && (
          <li className="px-5 py-3 text-sm text-atlasnavy/50">No articles yet — generate your first post.</li>
        )}
      </ul>
    </div>
  );
}
