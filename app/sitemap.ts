import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * The pages worth finding: the landing page and the walkthrough. Never the
 * app, and never a shared summary. A sitemap needs absolute URLs, so it is
 * empty until NEXT_PUBLIC_APP_URL (or Vercel's production URL) is known.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  if (!base) return [];
  return [
    { url: new URL("/", base).href, changeFrequency: "monthly", priority: 1 },
    { url: new URL("/demo", base).href, changeFrequency: "monthly", priority: 0.6 },
  ];
}
