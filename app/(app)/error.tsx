"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A missing Supabase env var surfaces here first, so the copy names that
 * rather than saying "something went wrong" to somebody who has just cloned
 * the repo.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const looksLikeConfig = /supabase|fetch failed|Invalid URL|SUPABASE/i.test(
    error.message,
  );

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-20 text-center">
      <h1 className="font-display text-3xl">That did not load</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {looksLikeConfig
          ? "This usually means the Supabase environment variables are missing or wrong. Check .env.local against .env.example, and that the migration has been run."
          : error.message}
      </p>
      <Button className="mt-6" onClick={reset}>
        <RotateCcw className="size-4" />
        Try again
      </Button>
    </div>
  );
}
