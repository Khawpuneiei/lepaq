import { Suspense } from "react";
import { LoginForm } from "@/components/layout/login-form";
import { LepaqLogo } from "@/components/layout/logo";

export const metadata = { title: "Sign in · Lepaq" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* editorial panel, hidden on small screens */}
      <div className="hidden lg:flex w-1/2 flex-col justify-between bg-sidebar p-12">
        <LepaqLogo className="text-3xl text-white" />
        <div className="max-w-md">
          <p className="font-display text-4xl leading-tight text-white">
            Walk out of the meeting. Keep the relationship.
          </p>
          <p className="mt-6 text-sm leading-relaxed text-sidebar-foreground/80">
            Upload the recording and get the report, the follow-ups and what
            you should remember about the people in the room. Everything stays
            a private draft until you approve it.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/60">
          Private by default. Nothing is sent to anyone without your click.
        </p>
      </div>

      <div className="flex w-full lg:w-1/2 items-center justify-center p-6">
        <Suspense>
          {/* Same two locks as the route itself, so this cannot render in a
              production build even if the env var were set by mistake. */}
          <LoginForm
            devBypass={
              process.env.NODE_ENV !== "production" &&
              process.env.DEV_AUTH_BYPASS === "true"
            }
            devEmail={process.env.OWNER_EMAIL ?? null}
          />
        </Suspense>
      </div>
    </div>
  );
}
