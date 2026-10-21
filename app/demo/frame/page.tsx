import type { Metadata } from "next";

import { DemoFrame } from "@/components/demo/frame";

export const metadata: Metadata = {
  title: "Lepaq",
  robots: { index: false },
};

/** The app screens for /demo. Only meaningful inside the player's iframe. */
export default async function DemoFramePage({ searchParams }: PageProps<"/demo/frame">) {
  const { capture } = await searchParams;
  return <DemoFrame capture={capture === "1"} />;
}
