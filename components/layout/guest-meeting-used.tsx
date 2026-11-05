import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { ContinueWithGoogleButton } from "@/components/layout/continue-with-google";
import { GUEST_MEETING_LIMIT } from "@/lib/constants";

/**
 * In place of the new-meeting wizard for a guest who cannot process another
 * meeting, before anything is recorded or uploaded.
 */
export function GuestMeetingUsed() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New meeting" />
      <Card className="gap-4 p-6">
        <div>
          <h2 className="font-medium">
            {GUEST_MEETING_LIMIT === 0
              ? "Guests cannot process meetings"
              : "Your guest meeting is used"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {GUEST_MEETING_LIMIT === 0
              ? "A guest account is for looking around."
              : "A guest account can process one meeting."}{" "}
            Continue with Google to process as many as you like. Everything you
            made as a guest comes with you.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ContinueWithGoogleButton>Continue with Google</ContinueWithGoogleButton>
          <Button variant="outline" asChild>
            <Link href="/meetings">Back to meetings</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
