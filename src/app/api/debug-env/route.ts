import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const keys = Object.keys(process.env);
  const relevant = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ACCESS_CODE",
    "SESSION_SECRET",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "ANTHROPIC_API_KEY",
  ];

  const report: Record<string, { present: boolean; length: number }> = {};
  for (const k of relevant) {
    const v = process.env[k];
    report[k] = { present: v !== undefined, length: v?.length ?? 0 };
  }

  return NextResponse.json({
    report,
    allKeysContainingSupabaseOrAccessOrSession: keys.filter((k) =>
      /supabase|access|session/i.test(k)
    ),
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  });
}
