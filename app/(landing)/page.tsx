import type { Metadata, Viewport } from "next";

import { FragmentHistory } from "@/components/landing/fragment-history";
import {
  Finale,
  LandingFooter,
  LandingNav,
  PrivacySection,
  SinglishSection,
} from "@/components/landing/sections";
import { Story } from "@/components/landing/story";
import { siteUrl } from "@/lib/site";

/*
 * No openGraph block here: it would replace the root layout's, and with it the
 * preview image. Next copies this title and description into the og: and
 * twitter: tags.
 */
export const metadata: Metadata = {
  title: "Lepaq · Every coffee chat, remembered",
  description:
    "Lepaq turns a coffee chat into a report you check, then keeps each follow-up with the person who asked for it. Built for Singlish and code-switching.",
  alternates: { canonical: "/" },
};

/** The page's paper colour, for the browser's own chrome on phones. */
export const viewport: Viewport = {
  themeColor: "#f7f5f1",
};

/**
 * What a search engine needs to name the site and its maker. No offers,
 * ratings or app listing: Lepaq has none to show. Only when the site's URL is
 * known, since every id here is an absolute URL.
 */
function structuredData() {
  const base = siteUrl();
  if (!base) return null;
  const home = new URL("/", base).href;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        url: home,
        name: "Lepaq",
        description: metadata.description,
        inLanguage: "en-SG",
        publisher: { "@id": `${home}#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${home}#organization`,
        name: "Lepaq",
        url: home,
        logo: new URL("/apple-icon.png", base).href,
      },
    ],
  };
}

/**
 * The public landing page: one scroll-driven story, then the proof, the
 * promises and the way in. Static: it reads no session and queries nothing,
 * and the session proxy does not run on it (proxy.ts, the matcher), so it
 * never waits on Supabase. "Open Lepaq" goes to /dashboard, which sends a
 * signed-out visitor through /login and back.
 *
 * npm run check:landing checks it in a browser (scripts/check-landing.ts).
 */
export default function LandingPage() {
  const ld = structuredData();
  return (
    <div id="top" className="flex min-h-screen flex-col bg-background text-foreground">
      {ld && (
        <script
          type="application/ld+json"
          // escaped so nothing in the JSON can close the script element
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }}
        />
      )}
      <FragmentHistory />
      <LandingNav />
      <main id="main" className="flex-1">
        <Story />
        <SinglishSection />
        <PrivacySection />
        <Finale />
      </main>
      <LandingFooter />
    </div>
  );
}
