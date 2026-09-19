import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-6xl text-muted-foreground">404</p>
      <h1 className="mt-4 font-display text-3xl">Nothing here</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        This page does not exist, or a share link was revoked.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
