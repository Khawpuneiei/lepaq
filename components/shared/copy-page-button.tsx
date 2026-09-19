"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** Copies the rendered text of an element, for pasting into an email or chat. */
export function CopyPageButton({ targetId }: { targetId: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        const el = document.getElementById(targetId);
        if (!el) return;
        void navigator.clipboard.writeText(el.innerText);
        toast.success("Copied. Paste it wherever you need it.");
      }}
    >
      <Copy className="size-3.5" />
      Copy everything
    </Button>
  );
}
