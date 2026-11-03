// Spec §13: a skeleton of the two tables, never a spinner over a blank page.
// Matches the shapes in tables.tsx so nothing jumps when the counts land.
export default function AdsReportLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="bg-surface-sunken h-6 w-24 animate-pulse rounded-sm" />
        <div className="bg-surface-sunken h-4 w-120 max-w-full animate-pulse rounded-sm" />
      </div>
      <div className="bg-surface-sunken h-16 w-80 animate-pulse rounded-md" />
      <div className="bg-surface-sunken h-80 animate-pulse rounded-md" />
      <div className="bg-surface-sunken h-64 animate-pulse rounded-md" />
    </div>
  );
}
