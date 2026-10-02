import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session-constants";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Anonymous ownership, read-only.
 *
 * The cookie itself is created by src/proxy.ts, because writing a cookie
 * during a Server Component render is not allowed in Next.js. This function
 * only ever reads.
 *
 * There are no accounts. Ownership is an unguessable v4 UUID in an HTTP-only,
 * SameSite=Lax cookie, and every query is scoped by it, so one visitor can never
 * read or mutate another visitor's pacts.
 *
 * If the cookie is somehow absent (a direct call that skipped middleware) a
 * transient id is returned. That request sees an empty session rather than an
 * error, and the next request gets a real cookie.
 */
export async function getSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing && UUID_RE.test(existing)) return existing;
  return crypto.randomUUID();
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}