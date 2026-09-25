import Link from "next/link";
import { Button } from "@/components/ui/button";

// Spec §9: detail screens share a back link, a header, a two-column body of
// panels, and equal-width rows. Shared by Person and Company detail.

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-blue-ink text-sm underline">
      ← {label}
    </Link>
  );
}

export function Panel({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line bg-surface-raised rounded-md border p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {empty ? <p className="text-ink-muted text-sm">None yet.</p> : children}
    </section>
  );
}

// Equal-width columns so values line up down the panel.
export function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line grid auto-cols-fr grid-flow-col gap-2 border-t py-2 text-sm first:border-t-0 [&>:last-child]:text-right">
      {children}
    </div>
  );
}

export function DetailError({
  backHref,
  backLabel,
  message,
  onRetry,
}: {
  backHref: string;
  backLabel: string;
  message: string;
  // Omit for 404 / 403, where retrying can't help.
  onRetry?: () => void;
}) {
  return (
    <div className="space-y-4">
      <BackLink href={backHref} label={backLabel} />
      <div
        role="alert"
        className="border-line bg-surface-raised rounded-md border p-6 text-sm"
      >
        <p className="text-ink font-medium">{message}</p>
        {onRetry && (
          <Button variant="outline" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="bg-surface-sunken h-4 w-20 animate-pulse rounded-sm" />
      <div className="bg-surface-sunken h-7 w-64 animate-pulse rounded-sm" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-surface-sunken h-96 animate-pulse rounded-md" />
        <div className="bg-surface-sunken h-96 animate-pulse rounded-md" />
      </div>
    </div>
  );
}

// Title, a muted meta line (badges, owner…), and actions on the right.
export function DetailHeader({
  title,
  meta,
  actions,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        {meta && (
          <div className="text-ink-muted flex flex-wrap items-center gap-3 text-sm">
            {meta}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
