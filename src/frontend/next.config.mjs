/** @type {import('next').NextConfig} */

// Content-Security-Policy for the frontend.
//
// `'unsafe-inline'` in script-src is not an oversight: the App Router emits inline bootstrap
// and streaming-payload scripts, and suppressing them requires per-request nonces, which
// `output: "standalone"` pages cannot use while they are statically rendered. A policy of
// `default-src 'self'` alone blocks those scripts and leaves a blank page. The value here is
// what actually loads.
//
// It still buys the thing it is meant to buy: no external origin can supply script, style,
// font or image, nothing can be framed or frame us, and connections are same-origin (the API
// is reached through the /api rewrite, so it is same-origin too).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
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

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig = {
  experimental: {},
  output: "standalone",
  async headers() {
    // Also set by the nginx template in docs/DEPLOYMENT.md. Duplicated on purpose: a
    // deployment that does not use that template must not silently run without them.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.INTERNAL_API_URL || "http://algoservice:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
