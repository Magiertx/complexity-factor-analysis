// Next.js configuration: standalone server with the /api rewrite for the Docker image, or the static export for the desktop app.

import { buildSecurityHeaders } from "./security-headers.mjs";

// NEXT_OUTPUT=export builds the static export (out/) that a single process serves together with
// the API (desktop app); without it the build is the standalone server of the Docker image.
// Use `npm run build:export`, which also writes out/_headers.json.
const isExport = process.env.NEXT_OUTPUT === "export";

/** @type {import('next').NextConfig} */
const nextConfig = isExport
  ? {
      // No rewrites, headers or proxy settings: a static export has no Next.js server. The
      // server in front of the files serves /api itself and applies out/_headers.json.
      output: "export",
    }
  : {
      experimental: {
        // Requests through the /api rewrite are cut after 30 s by default; dataset uploads, factor
        // fits over many measures and an interpretation by Claude can take longer.
        proxyTimeout: 180_000,
        // Next.js keeps a copy of each request body for the rewrite and cuts it at 10 MB by
        // default; larger uploads then never reach the backend and the request hangs. Same
        // ceiling as the nginx example in docs/DEPLOYMENT.md (500 MB per dataset plus overhead).
        middlewareClientMaxBodySize: "520mb",
      },
      output: "standalone",
      async headers() {
        // Also set by the nginx template in docs/DEPLOYMENT.md, but not every deployment uses it.
        return [{ source: "/:path*", headers: buildSecurityHeaders() }];
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
