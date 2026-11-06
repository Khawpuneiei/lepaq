import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * ffmpeg is a native binary. It must not be bundled by the compiler, and it
   * must be traced into the serverless function or the long-audio chunker has
   * nothing to spawn in production.
   *
   * The explicit include names the Linux binary because that is what Vercel
   * runs; on a Windows or macOS dev machine the path simply does not match and
   * automatic tracing covers it instead.
   *
   * ffprobe is deliberately absent. Duration is parsed out of ffmpeg itself
   * (lib/audio/chunk.ts) rather than shipping a second ~80MB binary for one
   * number.
   */
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/meetings/[id]/process": ["./node_modules/ffmpeg-static/ffmpeg"],
  },

  poweredByHeader: false,

  /**
   * One set for every route, deliberately. A header that limits what a page
   * may do (Permissions-Policy here, a CSP later) belongs to the document, and
   * a soft navigation keeps the document: a stricter rule on "/" alone would
   * follow a visitor into /login and the recorder until they reloaded.
   *
   * - SAMEORIGIN, not DENY: /demo frames /demo/frame.
   * - microphone=(self): the in-browser recorder needs it; nothing else does.
   * - HSTS is left to Vercel, which sets it on every custom domain.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(self), browsing-topics=()",
          },
        ],
      },
      {
        // a shared meeting summary is for the person it was sent to, not for
        // search engines; its link token must not leak out in a Referer either
        source: "/s/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
