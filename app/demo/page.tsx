import type { Metadata } from "next";

import { DemoPlayer } from "@/components/demo/player";

export const metadata: Metadata = {
  title: "Lepaq · product walkthrough",
  description: "A 71-second walkthrough of Lepaq, played by the real app with made-up data.",
};

/**
 * The product walkthrough. Public, and it queries nothing: the app screens
 * come from /demo/frame with fixture data.
 *
 * `?capture=1` drops the controls and pins the stage at 1920x1080 for
 * `npm run demo:record`, which steps through it one frame at a time.
 */
export default async function DemoPage({ searchParams }: PageProps<"/demo">) {
  const { capture } = await searchParams;
  return <DemoPlayer capture={capture === "1"} />;
}
