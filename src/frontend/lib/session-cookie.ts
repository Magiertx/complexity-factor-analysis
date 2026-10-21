/**
 * The session cookie before the first request of a page.
 *
 * The API starts a session with the first request that has no cookie. A page fires several
 * requests at once (catalog, datasets, the dataset a link opens), so without a cookie each one
 * started a session of its own, the browser kept the cookie of the last response, and what the
 * others created was gone. The middleware therefore asks the API for the cookie when the
 * browser requests a page, and sends it with that page; every request of the page has it.
 */

/** Longest the page waits for the API; without its answer the page is served as before. */
const TIMEOUT_MS = 2000;

/** Whether the browser asks for a page, not for an asset, a client-side navigation or a prefetch. */
export function isPageRequest(method: string, headers: Pick<Headers, "get" | "has">): boolean {
  if (method !== "GET") return false;
  if (headers.has("rsc") || headers.has("next-router-prefetch")) return false;
  return (headers.get("accept") ?? "").includes("text/html");
}

/**
 * The Set-Cookie lines of GET /session, which the API answers with a cookie when the browser
 * has none or only one it cannot read. Empty when the API does not answer in time: the page
 * then works as it did before, with the session starting on its first request.
 */
export async function sessionCookies(
  apiBase: string,
  headers: Pick<Headers, "get">,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const forward: Record<string, string> = {};
  // The cookie shows the API whether to start a session; the address keeps its rate limit per client.
  for (const name of ["cookie", "x-forwarded-for"]) {
    const value = headers.get(name);
    if (value) forward[name] = value;
  }
  try {
    const response = await fetchImpl(`${apiBase}/session`, {
      headers: forward,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? response.headers.getSetCookie() : [];
  } catch {
    return [];
  }
}
