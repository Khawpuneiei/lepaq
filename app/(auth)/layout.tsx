import { Toaster } from "@/components/ui/sonner";

/**
 * Only here for the toaster: the sign-in form confirms a new account with a
 * toast. It lives in each layout that toasts rather than the root, so the
 * landing page does not ship it.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {children}
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}
