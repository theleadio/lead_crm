"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BackLink,
  DetailError,
  DetailHeader,
  DetailSkeleton,
  Panel,
  Row,
} from "@/components/detail-kit";
import { Toast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CompanyDetail } from "@/lib/companies/types";
import { formatDate } from "@/lib/format/date";
import { formatMoneyMyr } from "@/lib/format/money";
import type { ListResponse, PersonListItem } from "@/lib/people/types";
import {
  CompanyFormDialog,
  type CompanyFormValues,
} from "../company-form-dialog";

type State =
  | { status: "loading" }
  | { status: "error"; code: number | null; message: string }
  | { status: "ready"; detail: CompanyDetail };

const label = (s: string) => s.replace(/_/g, " ");
const todayKl = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

// Spec §9.4 detail: fields, employees with job title and HR/billing flags,
// deals, enrolments, total revenue. Write controls (v1.5) for super_admin,
// sales and support: Edit, Add person, edit and end memberships.
export function CompanyDetailView({
  id,
  canWrite,
}: {
  id: string;
  canWrite: boolean;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/companies/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok)
          setState({
            status: "error",
            code: res.status,
            message: body.error?.message ?? "Couldn't load this company.",
          });
        else setState({ status: "ready", detail: body });
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError")
          setState({
            status: "error",
            code: null,
            message: "Couldn't load this company — check your connection.",
          });
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  // Reload in place: the page keeps showing the old data until the new
  // data arrives, so nothing flickers after a save.
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const c = state.status === "ready" ? state.detail.company : null;
  const formValues = useMemo<CompanyFormValues>(
    () => ({
      legalName: c?.legalName ?? "",
      registrationNo: c?.registrationNo ?? "",
      industry: c?.industry ?? "",
      sizeBand: c?.sizeBand ?? "",
      hrdcRegistered: c?.hrdcRegistered ?? false,
      billingAddress: c?.billingAddress ?? "",
      billingEmail: c?.billingEmail ?? "",
      ownerId: c?.owner?.id ?? "",
    }),
    [c],
  );

  if (state.status === "loading") return <DetailSkeleton />;

  if (state.status === "error")
    return (
      <DetailError
        backHref="/companies"
        backLabel="Companies"
        message={state.message}
        onRetry={
          state.code !== 404 && state.code !== 403
            ? () => {
                setState({ status: "loading" });
                reload();
              }
            : undefined
        }
      />
    );

  const { company, members, pastMembers, deals, enrolments, totalRevenueMyr } =
    state.detail;

  return (
    <div className="space-y-6">
      <BackLink href="/companies" label="Companies" />
      <DetailHeader
        title={company.legalName}
        meta={
          <>
            <Badge variant={company.hrdcRegistered ? "default" : "outline"}>
              {company.hrdcRegistered
                ? "HRDC registered"
                : "Not HRDC registered"}
            </Badge>
            <span>Owner: {company.owner?.fullName ?? "Unassigned"}</span>
          </>
        }
        actions={
          canWrite && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit company
            </Button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Details">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
            {[
              ["Registration no.", company.registrationNo],
              ["Industry", company.industry],
              ["Size", company.sizeBand],
              ["Billing email", company.billingEmail],
              ["Billing address", company.billingAddress],
              ["Owner", company.owner?.fullName],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="whitespace-pre-wrap">{v || "—"}</dd>
              </div>
            ))}
            {totalRevenueMyr !== null && (
              <div className="contents">
                <dt className="text-ink-muted">Total revenue</dt>
                <dd className="font-medium">
                  {formatMoneyMyr(totalRevenueMyr)}
                </dd>
              </div>
            )}
          </dl>
        </Panel>

        <div className="space-y-4">
          <Panel title="People" empty={!members.length && !canWrite}>
            {members.map((m) => (
              <MemberRow
                key={m.membershipId}
                companyId={id}
                member={m}
                canWrite={canWrite}
                onChanged={(message) => {
                  setToast(message);
                  reload();
                }}
              />
            ))}
            {!members.length && (
              <p className="text-ink-muted text-sm">No current employees.</p>
            )}
            {canWrite && (
              <AddPerson
                companyId={id}
                currentIds={members.map((m) => m.personId)}
                onAdded={(name) => {
                  setToast(`Added ${name} to ${company.legalName}.`);
                  reload();
                }}
              />
            )}
            {pastMembers.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="text-ink-muted cursor-pointer">
                  Past employees ({pastMembers.length})
                </summary>
                <div className="mt-1">
                  {pastMembers.map((m) => (
                    <Row key={m.membershipId}>
                      <Link
                        href={`/people/${m.personId}`}
                        className="text-blue-ink underline"
                      >
                        {m.fullName}
                      </Link>
                      <span>{m.jobTitle ?? "—"}</span>
                      <span>
                        {m.startDate ? formatDate(m.startDate) : "?"} –{" "}
                        {formatDate(m.endDate)}
                      </span>
                    </Row>
                  ))}
                </div>
              </details>
            )}
          </Panel>

          {deals && (
            <Panel title="Deals" empty={!deals.length}>
              {deals.map((d) => (
                <Row key={d.id}>
                  <span>{d.courseName ?? "—"}</span>
                  <span className="capitalize">{label(d.stage)}</span>
                  <span>{formatMoneyMyr(d.amountMyr)}</span>
                  <span>{d.owner ?? "Unassigned"}</span>
                </Row>
              ))}
            </Panel>
          )}

          {enrolments && (
            <Panel title="Enrolments" empty={!enrolments.length}>
              {enrolments.map((e) => (
                <Row key={e.id}>
                  <span>{e.personName}</span>
                  <span>{e.classCode}</span>
                  <span className="capitalize">{label(e.status)}</span>
                  <span>
                    {e.pricePaidMyr
                      ? formatMoneyMyr(e.pricePaidMyr)
                      : "Not paid"}
                  </span>
                </Row>
              ))}
            </Panel>
          )}
        </div>
      </div>

      {canWrite && (
        <CompanyFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          companyId={id}
          initial={formValues}
          onSaved={(saved) => {
            setToast(`Saved changes to ${saved.legalName}.`);
            reload();
          }}
        />
      )}
      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

type Member = CompanyDetail["members"][number];

// One current employee. Edit changes job title and flags; End membership
// asks for an end date (default today). Rows are never deleted (§7.1).
function MemberRow({
  companyId,
  member: m,
  canWrite,
  onChanged,
}: {
  companyId: string;
  member: Member;
  canWrite: boolean;
  onChanged: (message: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "end">("view");
  const [jobTitle, setJobTitle] = useState(m.jobTitle ?? "");
  const [isHr, setIsHr] = useState(m.isHrContact);
  const [isBilling, setIsBilling] = useState(m.isBillingContact);
  const [endDate, setEndDate] = useState(todayKl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function patch(body: object, done: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/companies/${companyId}/members/${m.membershipId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const b = await res.json();
        setError(
          b.error?.fields?.endDate ?? b.error?.message ?? "Couldn't save.",
        );
        return;
      }
      setMode("view");
      onChanged(done);
    } catch {
      setError("Couldn't save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-line border-t py-2 text-sm first:border-t-0">
      <div className="grid auto-cols-fr grid-flow-col gap-2">
        <Link
          href={`/people/${m.personId}`}
          className="text-blue-ink underline"
        >
          {m.fullName}
        </Link>
        <span>{m.jobTitle ?? "—"}</span>
        <span className="flex flex-wrap gap-1">
          {m.isHrContact && <Badge variant="secondary">HR</Badge>}
          {m.isBillingContact && <Badge variant="secondary">Billing</Badge>}
        </span>
        {canWrite && (
          <span className="flex justify-end gap-1">
            <Button variant="ghost" onClick={() => setMode("edit")}>
              Edit
            </Button>
            <Button variant="ghost" onClick={() => setMode("end")}>
              End
            </Button>
          </span>
        )}
      </div>

      {mode === "edit" && (
        <div className="bg-surface-sunken mt-2 space-y-2 rounded-md p-3">
          <Input
            aria-label={`Job title for ${m.fullName}`}
            placeholder="Job title"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isHr}
              onChange={(e) => setIsHr(e.target.checked)}
            />
            HR contact
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isBilling}
              onChange={(e) => setIsBilling(e.target.checked)}
            />
            Billing contact
          </label>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                patch(
                  { jobTitle, isHrContact: isHr, isBillingContact: isBilling },
                  `Saved ${m.fullName}'s details.`,
                )
              }
            >
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "end" && (
        <div className="bg-surface-sunken mt-2 space-y-2 rounded-md p-3">
          <p>
            End <strong>{m.fullName}</strong>&apos;s membership? They move to
            Past employees. To rejoin, add them again.
          </p>
          <label className="flex items-center gap-2">
            End date
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border-input bg-surface-raised text-ink h-9 rounded-md border px-2"
            />
          </label>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={busy || !endDate}
              onClick={() =>
                patch({ endDate }, `Ended ${m.fullName}'s membership.`)
              }
            >
              {busy ? "Saving…" : "End membership"}
            </Button>
            <Button variant="outline" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// "Add person": search existing people and attach one. Creating a new
// person happens on 9.1, not here (§9.4).
function AddPerson({
  companyId,
  currentIds,
  onAdded,
}: {
  companyId: string;
  currentIds: string[];
  onAdded: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !q.trim()) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q: q.trim(), limit: "8" });
      fetch(`/api/people?${params}`, { signal: controller.signal })
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body.error?.message);
          setResults((body as ListResponse<PersonListItem>).data);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError")
            setError(err.message || "Couldn't search people.");
        });
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [open, q]);

  async function attach(p: PersonListItem) {
    setError(null);
    const res = await fetch(`/api/companies/${companyId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: p.id }),
    });
    if (!res.ok) {
      setError(
        (await res.json()).error?.message ?? "Couldn't add this person.",
      );
      return;
    }
    setOpen(false);
    setQ("");
    setResults(null);
    onAdded(p.fullName || p.phone || "this person");
  }

  if (!open)
    return (
      <Button variant="outline" className="mt-3" onClick={() => setOpen(true)}>
        Add person
      </Button>
    );

  const shown = q.trim() ? results : null;
  return (
    <div className="border-line mt-3 space-y-2 rounded-md border p-3 text-sm">
      <Input
        type="search"
        autoFocus
        aria-label="Search people"
        placeholder="Search name, email or phone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {shown && shown.length === 0 && (
        <p className="text-ink-muted">
          No people match. New people are added from the People list.
        </p>
      )}
      <ul>
        {shown?.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={currentIds.includes(p.id)}
              onClick={() => attach(p)}
              className="hover:bg-surface-sunken focus-visible:outline-focus-ring w-full rounded-sm px-2 py-1.5 text-left focus-visible:outline-2 disabled:opacity-50"
            >
              {p.fullName || p.phone || "Unnamed"}
              {p.email && <span className="text-ink-muted"> · {p.email}</span>}
              {currentIds.includes(p.id) && (
                <span className="text-ink-muted"> (already here)</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
