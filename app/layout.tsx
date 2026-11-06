import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * One editorial typeface moment (spec 8.2 rule 2): the greeting, page titles
 * and the big stat numbers. Everything else is Geist.
 */
const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

/**
 * Shared by every page. The preview image is app/opengraph-image.png, which
 * Next adds to openGraph and twitter here; a page that sets its own openGraph
 * replaces this whole object and loses the image, so pages set a title and a
 * description and let Next copy them into the social tags.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: "Lepaq",
  description:
    "Every coffee chat, remembered. Private AI memory for B2B relationship builders.",
  openGraph: {
    type: "website",
    siteName: "Lepaq",
    locale: "en_SG",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* The toaster lives in the layouts that toast ((app), (auth), demo), so the
            landing page does not ship it */}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
