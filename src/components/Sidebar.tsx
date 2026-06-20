import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Sidebar() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <aside className="flex w-56 flex-col justify-between border-r border-atlasnavy/10 bg-white p-5">
      <div>
        <p className="text-lg font-bold text-atlasnavy">FreelanceAtlas</p>
        <p className="text-xs font-medium uppercase tracking-wide text-atlasteal">Gen</p>
        <nav className="mt-8 flex flex-col gap-1 text-sm">
          <Link href="/dashboard" className="rounded-md px-3 py-2 hover:bg-atlassand">Overview</Link>
          <Link href="/dashboard/generate" className="rounded-md px-3 py-2 hover:bg-atlassand">Generate post</Link>
          <Link href="/dashboard/articles" className="rounded-md px-3 py-2 hover:bg-atlassand">Articles</Link>
          <Link href="/dashboard/clusters" className="rounded-md px-3 py-2 hover:bg-atlassand">Clusters & keywords</Link>
          <Link href="/dashboard/affiliate-links" className="rounded-md px-3 py-2 hover:bg-atlassand">Affiliate links</Link>
        </nav>
      </div>
      <div className="text-xs text-atlasnavy/50">{user?.email}</div>
    </aside>
  );
}
