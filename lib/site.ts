import { readEnv } from "@/lib/env";

/**
 * The public URL of this deployment, for absolute links in metadata (the
 * preview image, canonical links, the sitemap).
 *
 * NEXT_PUBLIC_APP_URL first (the share dialog builds links from it too), then
 * the production domain Vercel provides. A malformed value is skipped with a
 * warning instead of thrown: this runs while the root layout prerenders, so a
 * throw here would fail the whole build over a typo in a setting. A localhost
 * value is ignored in a Vercel production build, where it can only be a
 * leftover from .env.example.
 *
 * Read at build time for static pages, so change the variable, then redeploy.
 */
export function siteUrl(): URL | undefined {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const candidates = [
    () => readEnv("NEXT_PUBLIC_APP_URL"),
    () => (production ? `https://${production}` : undefined),
  ];
  for (const read of candidates) {
    try {
      const raw = read();
      if (!raw) continue;
      const url = new URL(raw);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (process.env.VERCEL_ENV === "production" && url.hostname === "localhost") continue;
      return url;
    } catch {
      console.warn("[site] ignoring an invalid site URL; check NEXT_PUBLIC_APP_URL");
    }
  }
  return undefined;
}
