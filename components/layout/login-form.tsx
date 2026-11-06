"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GoogleIcon } from "@/components/layout/google-icon";
import { continueWithGoogle } from "@/lib/auth/google";
import { GUEST_MEETING_LIMIT } from "@/lib/constants";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";
type Busy = null | "email" | "google" | "guest";

export function LoginForm({
  devBypass = false,
  devEmail = null,
}: {
  devBypass?: boolean;
  devEmail?: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // only a path on this site (lib/safe-next.ts); read when a button is
  // pressed, since `window` does not exist while /login prerenders
  const next = () => safeNext(params.get("next"), window.location.origin);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setBusy("google");
    setError(null);
    const problem = await continueWithGoogle(createClient(), next());
    // on success the browser is already on its way to Google
    if (problem) {
      setError(problem);
      setBusy(null);
    }
  }

  async function guest() {
    setBusy("guest");
    setError(null);
    const { error } = await createClient().auth.signInAnonymously();
    if (error) {
      setError(
        error.code === "anonymous_provider_disabled"
          ? "Guest sign-in is switched off in Supabase (Authentication → Sign In / Providers → Allow anonymous sign-ins)."
          : error.message,
      );
      setBusy(null);
      return;
    }
    router.push(next());
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("email");
    setError(null);

    const supabase = createClient();

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;

        // Supabase returns a user with no session when email confirmation is on.
        if (!data.session) {
          toast.success("Check your email to confirm the account, then sign in.");
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      router.push(next());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-display text-3xl">
        {mode === "signin" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {mode === "signin"
          ? "Sign in to pick up where you left off."
          : "One account, just for you. No team admin to ask."}
      </p>

      <Button
        type="button"
        variant="outline"
        className="mt-8 w-full"
        onClick={google}
        disabled={busy !== null}
      >
        {busy === "google" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <GoogleIcon className="size-4" />
        )}
        Continue with Google
      </Button>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or with email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {mode === "signup" && (
          <div className="space-y-2">
            <Label htmlFor="fullName">Your name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Sarah Johnson"
              autoComplete="name"
              required
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
          {mode === "signup" && (
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={busy !== null}>
          {busy === "email" && <Loader2 className="size-4 animate-spin" />}
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <div className="mt-6 rounded-md border p-4">
        <p className="text-sm font-medium">Just trying it out?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {GUEST_MEETING_LIMIT === 0
            ? "Look around as a guest, no email needed. Continue with Google when you want to process a meeting."
            : "Look around and process one meeting as a guest, no email needed. Continue with Google later to keep what you made."}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 -ml-2.5"
          onClick={guest}
          disabled={busy !== null}
        >
          {busy === "guest" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UserRound className="size-4" />
          )}
          Continue as guest
        </Button>
      </div>

      {devBypass && (
        <div className="mt-6 rounded-md border border-dashed border-butter-strong bg-butter-soft p-4 dark:bg-butter">
          <p className="text-xs font-medium uppercase tracking-wide text-on-butter">
            Local development only
          </p>
          <p className="mt-1 text-sm text-on-butter/90">
            Skip the password and sign in as {devEmail ?? "the owner account"}.
          </p>
          {/* a plain link, not fetch: the route replies with a redirect that
              carries the Set-Cookie header, and the browser must follow it */}
          <Button asChild variant="outline" size="sm" className="mt-3">
            <a href="/api/dev/login">Sign in without a password</a>
          </Button>
          <p className="mt-3 text-xs text-on-butter/70">
            This button and the route behind it do not exist in a production
            build.
          </p>
        </div>
      )}

      <p className="mt-6 text-sm text-muted-foreground">
        {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
        <button
          type="button"
          className="font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
        >
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
