// Unit tests for security-headers.mjs, the security headers of every page.

import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "../security-headers.mjs";

describe("buildSecurityHeaders", () => {
  const byKey = (env: string) => Object.fromEntries(buildSecurityHeaders(env).map((h) => [h.key, h.value]));

  it("sets the four page headers", () => {
    expect(Object.keys(byKey("production"))).toEqual([
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
    ]);
  });

  it("allows eval only in development", () => {
    expect(byKey("development")["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(byKey("production")["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
  });

  it("keeps everything on the own origin", () => {
    const csp = byKey("production")["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
