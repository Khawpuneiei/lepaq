import type { Metadata } from "next";

import {
  Finale,
  LandingFooter,
  LandingNav,
  PrivacySection,
  SinglishSection,
} from "@/components/landing/sections";
import { Story } from "@/components/landing/story";

export const metadata: Metadata = {
  title: "Lepaq · Every coffee chat, remembered",
  description:
    "Lepaq turns a coffee chat into a report you check, then keeps each follow-up with the person who asked for it. Built for Singlish and code-switching.",
  openGraph: {
    title: "Lepaq · Every coffee chat, remembered",
    description:
      "AI meeting notes and a built-in CRM for the conversations you want to follow through on. Built for Singlish.",
    type: "website",
  },
};

/**
 * The public landing page: one scroll-driven story, then the proof, the
 * promises and the way in. Static: it reads no session and queries nothing,
 * so a signed-out visitor (and the proxy's public list) is all it needs.
 * "Open Lepaq" goes to /dashboard, which sends a signed-out visitor through
 * /login and back.
 */
export default function LandingPage() {
  return (
    <div id="top" className="flex min-h-screen flex-col bg-background text-foreground">
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
