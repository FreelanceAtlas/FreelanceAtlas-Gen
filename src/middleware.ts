import { NextResponse, type NextRequest } from "next/server";
import { signToken, ACCESS_COOKIE_NAME } from "@/lib/access";

export async function middleware(request: NextRequest) {
  const secret = process.env.SESSION_SECRET ?? "";
  const expectedToken = secret ? await signToken(secret) : null;
  const cookieToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value;

  const authorized = !!expectedToken && cookieToken === expectedToken;

  if (!authorized) {
    const url = request.nextUrl.clone();
    url.pathname = "/access";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/generate"],
};
