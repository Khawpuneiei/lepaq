import { ContinueWithGoogleButton } from "@/components/layout/continue-with-google";
import { GUEST_MEETING_LIMIT } from "@/lib/constants";

/**
 * Shown on every page while the account is a guest. There is no other way
 * back into a guest account once it signs out, so the way to keep it is
 * always in view.
 */
export function GuestBanner({ canStartMeeting }: { canStartMeeting: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-butter-soft px-4 py-2.5 text-sm text-on-butter md:px-8 dark:bg-butter">
      {/* min-w-60: on a phone the button wraps below instead of squeezing the text */}
      <p className="min-w-60 flex-1">
        <span className="font-medium">You are using a guest account.</span>{" "}
        {GUEST_MEETING_LIMIT === 0
          ? "Guests can look around but not process meetings."
          : canStartMeeting
            ? "It can process one meeting."
            : "Its one meeting is used; continue with Google to process more."}{" "}
        Signing out or clearing this browser loses it.
      </p>
      <ContinueWithGoogleButton size="sm" variant="outline" className="bg-background">
        Continue with Google to keep it
      </ContinueWithGoogleButton>
    </div>
  );
}
