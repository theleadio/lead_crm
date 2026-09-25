import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";

// Spec §9: every list screen has the same skeleton — title row, filter row,
// table, pagination, empty state, row click opens detail. Shared here so
// People, Companies and the screens after them look and behave the same.

export function ListHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function FilterRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring h-9 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <option value="">{label}: all</option>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

export function ListError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-danger bg-danger-soft text-danger rounded-md border p-4 text-sm"
    >
      <p>{message}</p>
      <Button variant="outline" className="mt-3" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// Wraps the <Table>. Rows go inside; loading and empty states are rows too,
// so the header never jumps.
export function TableCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line bg-surface-raised rounded-md border">
      {children}
    </div>
  );
}

export function SkeletonRows({ columns }: { columns: number }) {
  return Array.from({ length: 8 }, (_, i) => (
    <TableRow key={i}>
      {Array.from({ length: columns }, (_, j) => (
        <TableCell key={j}>
          <div className="bg-surface-sunken h-4 w-full animate-pulse rounded-sm" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

export function EmptyRow({
  columns,
  children,
}: {
  columns: number;
  children: React.ReactNode;
}) {
  return (
    <TableRow>
      <TableCell colSpan={columns} className="text-ink-muted py-10 text-center">
        {children}
      </TableCell>
    </TableRow>
  );
}

export function Pagination({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / limit));
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="text-ink-muted flex items-center justify-between text-sm">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={page >= lastPage}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
