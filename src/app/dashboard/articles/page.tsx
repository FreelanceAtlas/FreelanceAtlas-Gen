import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ArticlesPage() {
  const supabase = createClient();
  const { data: articles } = await supabase
    .from("articles")
    .select("id, title, slug, status, created_at, clusters(name)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-2xl font-bold text-atlasnavy">Articles</h1>
      <ul className="mt-6 divide-y divide-atlasnavy/10 rounded-xl bg-white shadow-sm">
        {(articles ?? []).map((a: any) => (
          <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
            <Link href={`/dashboard/articles/${a.slug}`} className="font-medium text-atlasnavy hover:underline">
              {a.title}
            </Link>
            <div className="flex items-center gap-3 text-xs text-atlasnavy/50">
              <span>{a.clusters?.name}</span>
              <span className="rounded-full bg-atlassand px-2 py-0.5 capitalize">{a.status}</span>
            </div>
          </li>
        ))}
        {(!articles || articles.length === 0) && (
          <li className="px-5 py-3 text-sm text-atlasnavy/50">No articles yet.</li>
        )}
      </ul>
    </div>
  );
}
