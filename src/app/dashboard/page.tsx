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

  return (
    <div>
      <h1 className="text-2xl font-bold text-atlasnavy">Overview</h1>
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm text-atlasnavy/60">Articles generated</p>
          <p className="text-3xl font-bold text-atlasnavy">{articleCount ?? 0}</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm text-atlasnavy/60">Topic clusters</p>
          <p className="text-3xl font-bold text-atlasnavy">{clusterCount ?? 0}</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm text-atlasnavy/60">Unused keywords in bank</p>
          <p className="text-3xl font-bold text-atlasnavy">{keywordCount ?? 0}</p>
        </div>
      </div>

      <h2 className="mt-10 text-lg font-semibold text-atlasnavy">Recent drafts</h2>
      <ul className="mt-3 divide-y divide-atlasnavy/10 rounded-xl bg-white shadow-sm">
        {(recent ?? []).map((a) => (
          <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
            <span>{a.title}</span>
            <span className="rounded-full bg-atlassand px-2 py-0.5 text-xs capitalize text-atlasnavy/70">{a.status}</span>
          </li>
        ))}
        {(!recent || recent.length === 0) && (
          <li className="px-5 py-3 text-sm text-atlasnavy/50">No articles yet — generate your first post.</li>
        )}
      </ul>
    </div>
  );
}
