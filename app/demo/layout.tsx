import { Instrument_Serif } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";

/**
 * The walkthrough's title cards set whole lines in the app's display face,
 * with an italic accent the app itself never needs — so the italic cut is
 * loaded here rather than on every page.
 */
const serif = Instrument_Serif({
  variable: "--font-demo-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export default function DemoLayout({ children }: LayoutProps<"/demo">) {
  return (
    <div className={`${serif.variable} contents`}>
      {children}
      <Toaster richColors closeButton position="top-right" />
    </div>
  );
}
