import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  children,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {eyebrow}
          </p>
        )}
        {/* serif for page titles — the one editorial moment, spec 8.2 */}
        <h1 className="font-display text-3xl leading-tight md:text-4xl">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
