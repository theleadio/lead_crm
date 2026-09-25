"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  EmptyRow,
  FilterRow,
  FilterSelect,
  ListError,
  ListHeader,
  Pagination,
  SkeletonRows,
  SortableHead,
  TableCard,
} from "@/components/list-kit";
import { Toast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CompanyFormDialog, EMPTY_COMPANY } from "./company-form-dialog";
import type { CompanyListItem } from "@/lib/companies/types";
import type { ListResponse } from "@/lib/people/types";

const LIMIT = 25;
const COLUMNS = 6;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ListResponse<CompanyListItem> };

// Spec §9.4 list: name, industry, size, HRDC registered, people count, open deals.
export function CompaniesList({ canWrite }: { canWrite: boolean }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [hrdc, setHrdc] = useState("");
  const [openDeal, setOpenDeal] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("name");
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      limit: String(LIMIT),
    });
    params.set("sort", sort);
    if (search) params.set("q", search);
    if (hrdc) params.set("filter[hrdcRegistered]", hrdc);
    if (openDeal) params.set("filter[hasOpenDeal]", openDeal);
    fetch(`/api/companies?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok)
          setState({
            status: "error",
            message: body.error?.message ?? "Couldn't load companies.",
          });
        else setState({ status: "ready", result: body });
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError")
          setState({
            status: "error",
            message: "Couldn't load companies — check your connection.",
          });
      });
    return () => controller.abort();
  }, [search, hrdc, openDeal, sort, page, reloadKey]);

  const hasFilters = Boolean(search || hrdc || openDeal);
  const clearFilters = () => {
    setQ("");
    setSearch("");
    setHrdc("");
    setOpenDeal("");
    setPage(1);
  };
  const setFilter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };
  const rows = state.status === "ready" ? state.result.data : [];

  return (
    <div className="space-y-4">
      <ListHeader title="Companies">
        {canWrite && (
          <Button onClick={() => setAddOpen(true)}>Add company</Button>
        )}
      </ListHeader>

      <FilterRow>
        <Input
          type="search"
          aria-label="Search companies"
          placeholder="Search by company name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-72"
        />
        <FilterSelect
          label="HRDC registered"
          value={hrdc}
          onChange={setFilter(setHrdc)}
          options={[
            ["true", "Registered"],
            ["false", "Not registered"],
          ]}
        />
        <FilterSelect
          label="Open deal"
          value={openDeal}
          onChange={setFilter(setOpenDeal)}
          options={[
            ["true", "Has open deal"],
            ["false", "No open deal"],
          ]}
        />
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </FilterRow>

      {state.status === "error" ? (
        <ListError
          message={state.message}
          onRetry={() => {
            setState({ status: "loading" });
            setReloadKey((k) => k + 1);
          }}
        />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead
                  label="Company"
                  column="name"
                  sort={sort}
                  onSort={(s) => {
                    setSort(s);
                    setPage(1);
                  }}
                />
                <TableHead>Industry</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>HRDC registered</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Open deals</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.status === "loading" ? (
                <SkeletonRows columns={COLUMNS} />
              ) : rows.length === 0 ? (
                <EmptyRow columns={COLUMNS}>
                  {hasFilters ? (
                    <>
                      No companies match these filters.{" "}
                      <Button variant="link" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </>
                  ) : (
                    <>
                      No companies yet. Companies you add here can be linked to
                      people.{" "}
                      {canWrite && (
                        <Button variant="link" onClick={() => setAddOpen(true)}>
                          Add a company
                        </Button>
                      )}
                    </>
                  )}
                </EmptyRow>
              ) : (
                rows.map((c) => <CompanyRow key={c.id} company={c} />)
              )}
            </TableBody>
          </Table>
        </TableCard>
      )}

      {state.status === "ready" && state.result.page.total > 0 && (
        <Pagination
          page={state.result.page.page}
          limit={state.result.page.limit}
          total={state.result.page.total}
          onPage={setPage}
        />
      )}

      {canWrite && (
        <CompanyFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          initial={EMPTY_COMPANY}
          onSaved={(c) => {
            setToast(`Added ${c.legalName}.`);
            setState({ status: "loading" });
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

// Spec §9: row click opens detail. The name is a real link for keyboard and
// middle-click; clicks on it aren't hijacked.
function CompanyRow({ company: c }: { company: CompanyListItem }) {
  const router = useRouter();
  const href = `/companies/${c.id}`;
  return (
    <TableRow
      className="cursor-pointer"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button")) return;
        router.push(href);
      }}
    >
      <TableCell className="font-medium">
        <Link href={href} className="text-blue-ink underline">
          {c.legalName}
        </Link>
      </TableCell>
      <TableCell>{c.industry ?? "—"}</TableCell>
      <TableCell>{c.sizeBand ?? "—"}</TableCell>
      <TableCell>
        <Badge variant={c.hrdcRegistered ? "default" : "outline"}>
          {c.hrdcRegistered ? "Yes" : "No"}
        </Badge>
      </TableCell>
      <TableCell>{c.peopleCount}</TableCell>
      <TableCell>{c.openDeals}</TableCell>
    </TableRow>
  );
}
