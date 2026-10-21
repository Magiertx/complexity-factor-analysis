import { NextResponse, type NextRequest } from "next/server";
import { isPageRequest, sessionCookies } from "@/lib/session-cookie";

// The same address as the /api rewrite of next.config.mjs.
const API_BASE = process.env.INTERNAL_API_URL || "http://algoservice:8000";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (!isPageRequest(request.method, request.headers)) return response;

  const cookies = await sessionCookies(API_BASE, request.headers);
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  // A page that carries somebody's session must never be handed to somebody else by a cache
  // in front, which Next.js allows for pages it prerendered.
  if (cookies.length > 0) response.headers.set("cache-control", "private, no-store");
  return response;
}

export const config = {
  // Node.js, so that the address of the API is read when the server starts, as in lib/api.ts.
  runtime: "nodejs",
  // Pages only: not the API (it starts sessions itself), Next.js internals or files with an extension.
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
