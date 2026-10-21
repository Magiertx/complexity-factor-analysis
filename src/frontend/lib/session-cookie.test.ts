import { describe, expect, it, vi } from "vitest";
import { isPageRequest, sessionCookies } from "./session-cookie";

describe("isPageRequest", () => {
  const html = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };

  it("accepts the browser asking for a page", () => {
    expect(isPageRequest("GET", new Headers(html))).toBe(true);
  });

  it("leaves out everything else", () => {
    expect(isPageRequest("POST", new Headers(html))).toBe(false);
    // The health check of the image and scripts do not ask for HTML.
    expect(isPageRequest("GET", new Headers({ accept: "*/*" }))).toBe(false);
    expect(isPageRequest("GET", new Headers())).toBe(false);
    // Client-side navigations and prefetches of the router come with a session already.
    expect(isPageRequest("GET", new Headers({ ...html, rsc: "1" }))).toBe(false);
    expect(isPageRequest("GET", new Headers({ ...html, "next-router-prefetch": "1" }))).toBe(false);
  });
});

describe("sessionCookies", () => {
  const answer = (init: ResponseInit, cookies: string[] = []) => {
    const headers = new Headers();
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    return vi.fn(async () => new Response(null, { ...init, headers }));
  };

  it("returns the cookies of the API and sends it the cookie and the address of the visitor", async () => {
    const fetchImpl = answer({ status: 204 }, ["session_id=abc; path=/; httponly"]);
    const headers = new Headers({ cookie: "session_id=old; theme=dark", "x-forwarded-for": "203.0.113.7", host: "example.org" });
    expect(await sessionCookies("http://api:8000", headers, fetchImpl)).toEqual(["session_id=abc; path=/; httponly"]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api:8000/session");
    expect(init.headers).toEqual({ cookie: "session_id=old; theme=dark", "x-forwarded-for": "203.0.113.7" });
  });

  it("sends nothing the visitor did not send", async () => {
    const fetchImpl = answer({ status: 204 });
    await sessionCookies("http://api:8000", new Headers(), fetchImpl);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({});
  });

  it("serves the page without a cookie when the API fails or does not answer", async () => {
    expect(await sessionCookies("http://api:8000", new Headers(), answer({ status: 429 }, ["session_id=x"]))).toEqual([]);
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await sessionCookies("http://api:8000", new Headers(), down)).toEqual([]);
  });
});
