import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * ffmpeg/ffprobe are native binaries. They must not be bundled by the
   * compiler, and they must be traced into the serverless function or the
   * long-audio chunker has nothing to spawn in production.
   *
   * Only the linux/x64 ffprobe is traced — shipping darwin and win32 too
   * would waste ~25MB of the Vercel function budget for nothing.
   */
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  outputFileTracingIncludes: {
    "/api/meetings/[id]/process": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/bin/linux/x64/ffprobe",
    ],
  },
};

export default nextConfig;
