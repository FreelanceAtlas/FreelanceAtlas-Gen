"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { signToken, ACCESS_COOKIE_NAME } from "@/lib/access";

export async function verifyAccessCode(formData: FormData) {
  const submitted = String(formData.get("code") ?? "");
  const expected = process.env.ACCESS_CODE ?? "";
  const secret = process.env.SESSION_SECRET ?? "";

  if (!expected || !secret) {
    throw new Error("Server is not configured with ACCESS_CODE / SESSION_SECRET");
  }

  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) {
    redirect("/access?error=1");
  }

  const token = await signToken(secret);
  cookies().set(ACCESS_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });

  redirect("/dashboard");
}

export async function logout() {
  cookies().delete(ACCESS_COOKIE_NAME);
  redirect("/access");
}
