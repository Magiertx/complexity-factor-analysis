// Security headers of every page. One source for the Next.js server (next.config.mjs, Docker
// build) and for the static export, where scripts/build-export.mjs writes the same list to
// out/_headers.json so that whatever serves the files can apply exactly these headers.

// Content-Security-Policy for the frontend. The App Router emits inline scripts, and
// statically rendered pages cannot use nonces, so script-src needs 'unsafe-inline'.
// Everything is still restricted to the own origin; the API is same-origin via /api.
/** The list of security headers (`key`/`value`) for every page; `nodeEnv` only decides whether development may use `eval` in scripts. */
export function buildSecurityHeaders(nodeEnv = process.env.NODE_ENV) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'" + (nodeEnv === "development" ? " 'unsafe-eval'" : ""),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", // artifacts arrive base64-encoded; downloads use blob: URLs
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ];
}
