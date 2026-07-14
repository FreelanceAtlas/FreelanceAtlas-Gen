"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/generate", label: "Generate" },
  { href: "/dashboard/articles", label: "Articles" },
  { href: "/dashboard/clusters", label: "Clusters" },
  { href: "/dashboard/keyword-research", label: "Keyword research" },
  { href: "/dashboard/affiliate-links", label: "Affiliate links" },
];

// Site-style header: mist band, wordmark left, horizontal nav — mirrors the
// live freelanceatlas.com header so the tool feels like part of the site.
export default function TopNav({ onLogout }: { onLogout: () => void }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-atlasnavy/10 bg-atlassand/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <Image src="/logo.png" alt="FreelanceAtlas" width={154} height={40} priority className="h-9 w-auto" />
          <span className="rounded-full bg-atlasnavy px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            Gen
          </span>
        </Link>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-sm font-semibold">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 transition-colors ${
                  active
                    ? "bg-atlasnavy text-white"
                    : "text-atlasnavy/70 hover:bg-atlasnavy/5 hover:text-atlasnavy"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <form action={onLogout}>
          <button
            type="submit"
            className="whitespace-nowrap rounded-full border border-atlasnavy/20 px-3.5 py-1.5 text-xs font-semibold text-atlasnavy/60 transition-colors hover:bg-atlasnavy/5 hover:text-atlasnavy"
          >
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
