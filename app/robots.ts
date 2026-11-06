import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * Crawl the public pages; skip the app, which only answers signed-in users,
 * and the API.
 *
 * /s/ (shared summaries) is deliberately not disallowed: a crawler that may
 * not fetch a page never sees its noindex, and can still list the bare URL.
 * Those pages say noindex themselves (metadata and X-Robots-Tag). /demo/frame
 * stays allowed so the walkthrough can be rendered.
 *
 * Built once at build time, like the sitemap: proxy.ts lets both through.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/meetings", "/people", "/companies", "/follow-ups", "/settings"],
    },
    ...(base && { sitemap: new URL("/sitemap.xml", base).href }),
  };
}
