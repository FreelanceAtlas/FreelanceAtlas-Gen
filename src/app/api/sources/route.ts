import { NextResponse } from "next/server";
import { fetchResearch } from "@/lib/sources";

export async function POST(request: Request) {
  const body = await request.json();
  const { primaryKeyword, supportingKeywords = [], clusterName = "" } = body as {
    primaryKeyword: string;
    supportingKeywords: string[];
    clusterName?: string;
  };

  if (!primaryKeyword) {
    return NextResponse.json({ error: "primaryKeyword is required" }, { status: 400 });
  }

  try {
    const research = await fetchResearch(primaryKeyword, supportingKeywords, clusterName);
    return NextResponse.json(research);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Source fetch failed" }, { status: 500 });
  }
}
