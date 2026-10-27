// Spec §13: skeletons in place of each panel, never a spinner over a blank
// page. Matches the panel shapes below so nothing jumps when data lands.
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="bg-surface-sunken h-8 w-64 animate-pulse rounded-sm" />
        <div className="bg-surface-sunken h-4 w-80 animate-pulse rounded-sm" />
      </div>
      <div className="bg-surface-sunken h-36 animate-pulse rounded-md" />
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="bg-surface-sunken h-120 flex-1 animate-pulse rounded-md" />
        <div className="bg-surface-sunken h-120 w-full animate-pulse rounded-md lg:w-100" />
      </div>
      <div className="bg-surface-sunken h-96 animate-pulse rounded-md" />
    </div>
  );
}
