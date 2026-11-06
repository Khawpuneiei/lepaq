import { Instrument_Serif } from "next/font/google";

/**
 * The landing page sets its opening line in the app's display face and
 * needs the italic cut for the "can?", which the app itself never uses — so
 * it is loaded here, the way /demo loads it, rather than on every page.
 */
const serif = Instrument_Serif({
  variable: "--font-landing-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export default function LandingLayout({ children }: LayoutProps<"/">) {
  return <div className={`${serif.variable} contents`}>{children}</div>;
}
