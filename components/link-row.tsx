"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";

// A table row that opens its record, the one pattern every CRM list uses:
// click anywhere on the row to open it. The record's name inside stays a real
// link for keyboard and middle-click, and clicks on links or buttons in the
// row are left to them. Server-rendered tables use it too, since they cannot
// attach a click handler themselves.
export function LinkRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <TableRow
      className={`cursor-pointer ${className ?? ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button")) return;
        router.push(href);
      }}
    >
      {children}
    </TableRow>
  );
}
