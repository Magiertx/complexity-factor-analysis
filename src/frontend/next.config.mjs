/** @type {import('next').NextConfig} */

// Content-Security-Policy for the frontend. The App Router emits inline scripts, and
// statically rendered pages cannot use nonces, so script-src needs 'unsafe-inline'.
// Everything is still restricted to the own origin; the API is same-origin via /api.
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
  experimental: {
    // Requests through the /api rewrite are cut after 30 s by default; dataset uploads, factor
    // fits over many measures and an interpretation by Claude can take longer.
    proxyTimeout: 180_000,
  },
  output: "standalone",
  async headers() {
    // Also set by the nginx template in docs/DEPLOYMENT.md, but not every deployment uses it.
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
