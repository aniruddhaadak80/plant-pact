import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "pp_session";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Session ownership is established here, in the proxy (Next.js 16's successor to
 * middleware), and nowhere else.
 *
 * Next.js forbids writing a cookie during a Server Component render, so a page
 * that lazily created the session would throw a 500 on the visitor's very first
 * request. The proxy runs before rendering and can set a cookie on both the
 * request and the response, which means the page render and the visitor's later
 * API calls share one session from the first request onwards - no race, no
 * session that appears to lose its data on the second page view.
 *
 * The value is an unguessable v4 UUID. It is the ownership boundary for every
 * pact, so it is httpOnly and SameSite=Lax.
 */
export function proxy(request: NextRequest): NextResponse {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (existing && UUID_RE.test(existing)) {
    return NextResponse.next();
  }

  const id = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("cookie", `${SESSION_COOKIE}=${id}`);

  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:woff2?|png|svg|jpg|jpeg|gif|ico|txt|xml)$).*)"],
};