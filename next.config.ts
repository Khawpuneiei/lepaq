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
};

export default nextConfig;
