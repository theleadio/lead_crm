// The frame every §9.18 panel sits in: an eyebrow saying what kind of thing
// it is, a title, and a body that folds away when the reader taps the header.
//
// A native <details>, not a click handler. Three reasons: the report is a
// server component and this keeps it one, the fold works with JavaScript off,
// and the browser gives keyboard support and the right ARIA for free. The
// marker is drawn by us because the default triangle is inconsistent across
// browsers — [+] closed, [−] open, in the brand hue so it reads as the
// control rather than as data.
//
// One accent for every panel. The reference dashboard colours each section
// differently, but the status hues here mean good / watch / poor on a figure
// (see the ROAS bands), and spending them on decoration would make a red
// border look like an alarm about the panel's contents.

export function PanelCard({
  eyebrow,
  title,
  description,
  defaultOpen = true,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group border-line bg-surface-raised/40 rounded-lg border open:pb-4"
    >
      <summary
        className="focus-visible:outline-focus-ring flex cursor-pointer list-none items-start gap-3 rounded-lg p-4 focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden"
        // The whole header is the control, so it carries the pointer and the
        // focus ring rather than a small icon nobody can hit.
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-ink-subtle text-xs font-medium tracking-widest uppercase">
            {eyebrow}
          </span>
          <span className="text-base font-semibold">{title}</span>
          {description && (
            <span className="text-ink-muted hidden text-sm group-open:inline">
              {description}
            </span>
          )}
        </span>

        <span
          aria-hidden="true"
          className="text-lg leading-none font-semibold select-none"
          style={{ color: "var(--lead-blue)" }}
        >
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">−</span>
        </span>
      </summary>

      <div className="flex flex-col gap-3 px-4">{children}</div>
    </details>
  );
}
