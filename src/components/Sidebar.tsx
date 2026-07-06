import Link from "next/link";
import { logout } from "@/app/access/actions";

export default function Sidebar() {
  return (
    <aside className="flex w-56 flex-col justify-between border-r border-atlasnavy/10 bg-white p-5">
      <div>
        <p className="text-lg font-bold text-atlasnavy">FreelanceAtlas</p>
        <p className="text-xs font-medium uppercase tracking-wide text-atlasteal">Gen</p>
        <nav className="mt-8 flex flex-col gap-1 text-sm">
          <Link href="/dashboard" className="rounded-md px-3 py-2 hover:bg-atlassand">Overview</Link>
          <Link href="/dashboard/generate" className="rounded-md px-3 py-2 hover:bg-atlassand">Generate post</Link>
          <Link href="/dashboard/articles" className="rounded-md px-3 py-2 hover:bg-atlassand">Articles</Link>
          <Link href="/dashboard/clusters" className="rounded-md px-3 py-2 hover:bg-atlassand">Clusters &amp; keywords</Link>
          <Link href="/dashboard/keyword-research" className="rounded-md px-3 py-2 hover:bg-atlassand">Keyword research</Link>
          <Link href="/dashboard/affiliate-links" className="rounded-md px-3 py-2 hover:bg-atlassand">Affiliate links</Link>
          <Link href="/dashboard/wp-test" className="rounded-md px-3 py-2 hover:bg-atlassand">WP publish test</Link>
        </nav>
      </div>
      <form action={logout}>
        <button type="submit" className="text-xs text-atlasnavy/50 underline">Log out</button>
      </form>
    </aside>
  );
}
