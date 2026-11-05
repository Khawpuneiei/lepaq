import Link from "next/link";

import { Button } from "@/components/ui/button";
import { LepaqLogo } from "@/components/layout/logo";
import { SignOutToGoogle } from "@/components/layout/sign-out-to-google";

export const metadata = { title: "Sign in · Lepaq" };

const COPY = {
  // a guest picked a Google account that already has things of its own
  google_taken: {
    title: "That Google account already has a Lepaq account",
    body: "It has meetings, people or companies of its own, or a password, so the guest account cannot be moved into it. Nothing was changed: you are still signed in as the guest. To use that Google account instead, sign out and sign in with Google; what you made as the guest stays behind.",
  },
  // the move itself failed, usually because migration 0006 is missing
  move_failed: {
    title: "Your guest account could not be moved",
    body: "Something went wrong while moving what you made as a guest into the Google account. Nothing was changed: you are still signed in as the guest. Try again in a moment.",
  },
  failed: {
    title: "Google sign-in did not finish",
    body: "It was cancelled, or took too long. Nothing was changed. Try again.",
  },
} as const;

/** Where /auth/callback sends a Google sign-in that did not finish. */
export default async function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  const { reason } = await searchParams;
  const key = reason === "google_taken" || reason === "move_failed" ? reason : "failed";
  const { title, body } = COPY[key];

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <LepaqLogo className="text-2xl" />
        <h1 className="mt-8 font-display text-3xl">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{body}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {key === "failed" ? (
            // a guest is sent on from /login to the app, where the banner is
            <Button asChild>
              <Link href="/login">Try again</Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href="/dashboard">Back to Lepaq</Link>
            </Button>
          )}
          {key === "google_taken" && <SignOutToGoogle />}
        </div>
      </div>
    </div>
  );
}
