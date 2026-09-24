"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Toast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatLastActivity, formatTime } from "@/lib/format/date";
import { formatMoneyMyr } from "@/lib/format/money";
import type {
  ConsentState,
  ListResponse,
  OwnerOption,
  PersonDetail,
  TimelineItem,
} from "@/lib/people/types";

type Person = PersonDetail["person"];
type Form = {
  fullName: string;
  preferredName: string;
  email: string;
  phone: string;
  whatsapp: string;
  preferredLanguage: "en" | "zh";
  jobTitle: string;
  ownerId: string;
  notes: string;
};

const LANGUAGE = { en: "English", zh: "Chinese" } as const;
const label = (s: string) => s.replace(/_/g, " ");

function toForm(p: Person): Form {
  return {
    fullName: p.fullName,
    preferredName: p.preferredName ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    whatsapp: p.whatsapp ?? "",
    preferredLanguage: p.preferredLanguage,
    jobTitle: p.jobTitle ?? "",
    ownerId: p.owner?.id ?? "",
    notes: p.notes ?? "",
  };
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; code: number | null; message: string }
  | { status: "ready"; detail: PersonDetail };

export function PersonDetailView({
  id,
  canWrite,
  canExportData,
}: {
  id: string;
  canWrite: boolean;
  canExportData: boolean;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/people/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok)
          setState({
            status: "error",
            code: res.status,
            message: body.error?.message ?? "Couldn't load this person.",
          });
        else setState({ status: "ready", detail: body });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setState({
          status: "error",
          code: null,
          message: "Couldn't load this person — check your connection.",
        });
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  const reload = () => {
    setState({ status: "loading" });
    setReloadKey((k) => k + 1);
  };

  if (state.status === "loading") return <DetailSkeleton />;

  if (state.status === "error")
    return (
      <div className="space-y-4">
        <BackLink />
        <div
          role="alert"
          className="border-line bg-surface-raised rounded-md border p-6 text-sm"
        >
          <p className="text-ink font-medium">{state.message}</p>
          {state.code !== 404 && state.code !== 403 && (
            <Button variant="outline" className="mt-3" onClick={reload}>
              Retry
            </Button>
          )}
        </div>
      </div>
    );

  const { detail } = state;
  const p = detail.person;
  const displayName = p.fullName || p.phone || "Unnamed";

  return (
    <div className="space-y-6">
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">
            {displayName}
            {p.preferredName && (
              <span className="text-ink-muted font-normal">
                {" "}
                ({p.preferredName})
              </span>
            )}
          </h1>
          <div className="text-ink-muted flex flex-wrap items-center gap-3 text-sm">
            <Badge
              variant={
                p.stage === "customer"
                  ? "default"
                  : p.stage === "student"
                    ? "secondary"
                    : "outline"
              }
              className="capitalize"
            >
              {p.stage}
            </Badge>
            <span>Owner: {p.owner?.fullName ?? "Unassigned"}</span>
            <span>{LANGUAGE[p.preferredLanguage]}</span>
            <span>Last activity: {formatLastActivity(p.lastActivityAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.email && !p.email.includes("•") && (
            <Button variant="outline" asChild>
              <a href={`mailto:${p.email}`}>Email</a>
            </Button>
          )}
          {/* §14 PDPA portability, on the person's request (§7.1). */}
          {canExportData && (
            <>
              <Button variant="outline" asChild>
                <a
                  href={`/api/people/${encodeURIComponent(p.id)}/data-export?format=json`}
                >
                  Export data (JSON)
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a
                  href={`/api/people/${encodeURIComponent(p.id)}/data-export?format=csv`}
                >
                  Export data (CSV)
                </a>
              </Button>
              <DeletePerson id={p.id} name={displayName} />
              <ErasePerson id={p.id} name={displayName} />
            </>
          )}
        </div>
      </header>

      {p.needsReview && (
        <p className="border-warning bg-warning-soft text-warning rounded-md border px-4 py-2 text-sm">
          Needs review: {p.needsReviewReason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border-line bg-surface-raised rounded-md border p-5">
          <h2 className="mb-4 font-semibold">Details</h2>
          {canWrite ? (
            <EditForm
              canMerge={canExportData}
              key={p.updatedAt}
              person={p}
              onSaved={(person) => {
                setState({
                  status: "ready",
                  detail: { ...detail, person },
                });
                setToast(
                  `Saved changes to ${person.fullName || "this person"}.`,
                );
              }}
              onReload={reload}
            />
          ) : (
            <ReadOnlyDetails person={p} />
          )}
        </section>

        <div className="space-y-4">
          <Panel title="Attribution">
            <TouchLine label="First touch" t={detail.attribution.firstTouch} />
            <TouchLine
              label="Latest touch"
              t={detail.attribution.latestTouch}
            />
          </Panel>

          {detail.deals && (
            <Panel title="Deals" empty={!detail.deals.length}>
              {detail.deals.map((d) => (
                <Row key={d.id}>
                  <span>{d.courseName}</span>
                  <span className="capitalize">{label(d.stage)}</span>
                  <span>{formatMoneyMyr(d.amountMyr)}</span>
                  <span>{d.owner ?? "Unassigned"}</span>
                </Row>
              ))}
            </Panel>
          )}

          {detail.enrolments && (
            <Panel title="Enrolments" empty={!detail.enrolments.length}>
              {detail.enrolments.map((e) => (
                <Row key={e.id}>
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

          {detail.payments && (
            <Panel title="Payments" empty={!detail.payments.length}>
              {detail.payments.map((pay) => (
                <Row key={pay.id}>
                  <span className="capitalize">{label(pay.method)}</span>
                  <span>{formatMoneyMyr(pay.amountMyr)}</span>
                  <span>{pay.paidAt ? formatDate(pay.paidAt) : "—"}</span>
                  <span className="capitalize">{label(pay.status)}</span>
                </Row>
              ))}
            </Panel>
          )}

          {detail.enquiries && (
            <Panel title="Enquiries" empty={!detail.enquiries.length}>
              {detail.enquiries.map((q) => (
                <Row key={q.id}>
                  <span className="capitalize">{label(q.channel)}</span>
                  <span className="capitalize">{label(q.category)}</span>
                  <span className="capitalize">{label(q.status)}</span>
                  <span>{q.handledBy === "ai" ? "AI" : "Staff"}</span>
                </Row>
              ))}
            </Panel>
          )}

          <ConsentPanel personId={p.id} />
          <TimelinePanel personId={p.id} />
        </div>
      </div>

      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

function EditForm({
  canMerge,
  person,
  onSaved,
  onReload,
}: {
  canMerge: boolean;
  person: Person;
  onSaved: (person: Person) => void;
  onReload: () => void;
}) {
  const initial = toForm(person);
  const [form, setForm] = useState<Form>(initial);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{
    message: string;
    existing?: { id: string; fullName: string };
    stale?: boolean;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/users/options")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setOwners(b.data))
      .catch(() => setOwners([]));
  }, []);

  const changed = (Object.keys(form) as (keyof Form)[]).filter(
    (k) => form[k] !== initial[k],
  );
  const set = (key: keyof Form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!changed.length) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});

    // Only changed fields — PATCH is partial (spec §7).
    const patch: Record<string, string | null> = {};
    for (const k of changed)
      patch[k] = k === "ownerId" ? form.ownerId || null : form[k];

    try {
      const res = await fetch(`/api/people/${encodeURIComponent(person.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": person.updatedAt,
        },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) {
        // Spec §9 cross-screen: never lose typed input on a failed save.
        setError({
          message: body.error?.message ?? "Couldn't save.",
          existing: body.error?.existing,
          stale: body.error?.code === "stale_edit",
        });
        setFieldErrors(body.error?.fields ?? {});
        return;
      }
      onSaved(body);
    } catch {
      setError({
        message:
          "Couldn't save — check your connection. Your changes are still here.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3" noValidate>
      {error && (
        <div
          role="alert"
          className="bg-danger-soft text-danger rounded-md p-3 text-sm"
        >
          <p>{error.message}</p>
          {error.existing && (
            <div className="mt-1 flex gap-4">
              <Link href={`/people/${error.existing.id}`} className="underline">
                Open {error.existing.fullName || "their record"}
              </Link>
              {canMerge && (
                <Link
                  href={`/people/${person.id}/merge?with=${error.existing.id}`}
                  className="underline"
                >
                  Merge
                </Link>
              )}
            </div>
          )}
          {error.stale && (
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={onReload}
            >
              Reload
            </Button>
          )}
        </div>
      )}

      <Field
        id="fullName"
        label="Full name"
        required
        error={fieldErrors.fullName}
      >
        <Input
          id="fullName"
          value={form.fullName}
          onChange={(e) => set("fullName")(e.target.value)}
        />
      </Field>
      <Field
        id="preferredName"
        label="Preferred name"
        error={fieldErrors.preferredName}
      >
        <Input
          id="preferredName"
          value={form.preferredName}
          onChange={(e) => set("preferredName")(e.target.value)}
        />
      </Field>
      <Field id="email" label="Email" error={fieldErrors.email}>
        <Input
          id="email"
          type="email"
          value={form.email}
          onChange={(e) => set("email")(e.target.value)}
        />
      </Field>
      <Field id="phone" label="Phone" error={fieldErrors.phone}>
        <Input
          id="phone"
          type="tel"
          placeholder="+60 12-345 6789"
          value={form.phone}
          onChange={(e) => set("phone")(e.target.value)}
        />
      </Field>
      <Field id="whatsapp" label="WhatsApp" error={fieldErrors.whatsapp}>
        <Input
          id="whatsapp"
          type="tel"
          placeholder="+60 12-345 6789"
          value={form.whatsapp}
          onChange={(e) => set("whatsapp")(e.target.value)}
        />
      </Field>
      <Field
        id="preferredLanguage"
        label="Language"
        error={fieldErrors.preferredLanguage}
      >
        <select
          id="preferredLanguage"
          value={form.preferredLanguage}
          onChange={(e) => set("preferredLanguage")(e.target.value)}
          className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <option value="en">English</option>
          <option value="zh">Chinese</option>
        </select>
      </Field>
      <Field id="jobTitle" label="Job title" error={fieldErrors.jobTitle}>
        <Input
          id="jobTitle"
          value={form.jobTitle}
          onChange={(e) => set("jobTitle")(e.target.value)}
        />
      </Field>
      <Field id="company" label="Company">
        <p id="company" className="text-ink-muted text-sm">
          {person.companyName ?? "None"} — editable once Companies (9.4) is
          built
        </p>
      </Field>
      <Field id="ownerId" label="Owner" error={fieldErrors.ownerId}>
        <select
          id="ownerId"
          value={form.ownerId}
          onChange={(e) => set("ownerId")(e.target.value)}
          className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <option value="">Unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.fullName}
            </option>
          ))}
        </select>
      </Field>
      <Field id="notes" label="Notes" error={fieldErrors.notes}>
        <textarea
          id="notes"
          rows={4}
          value={form.notes}
          onChange={(e) => set("notes")(e.target.value)}
          className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </Field>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !changed.length}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {changed.length > 0 && !saving && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setForm(initial)}
          >
            Discard
          </Button>
        )}
      </div>
    </form>
  );
}

function ReadOnlyDetails({ person: p }: { person: Person }) {
  const rows: [string, string | null][] = [
    ["Full name", p.fullName || null],
    ["Preferred name", p.preferredName],
    ["Email", p.email],
    ["Phone", p.phone],
    ["WhatsApp", p.whatsapp],
    ["Language", LANGUAGE[p.preferredLanguage]],
    ["Job title", p.jobTitle],
    ["Company", p.companyName],
    ["Owner", p.owner?.fullName ?? null],
    ["Notes", p.notes],
  ];
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="whitespace-pre-wrap">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-ink text-sm font-medium">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}

function Panel({
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

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line grid auto-cols-fr grid-flow-col gap-2 border-t py-2 text-sm first:border-t-0 [&>:last-child]:text-right">
      {children}
    </div>
  );
}

function TouchLine({
  label: title,
  t,
}: {
  label: string;
  t: PersonDetail["attribution"]["firstTouch"];
}) {
  return (
    <p className="grid grid-cols-[6.5rem_1fr] gap-2 py-1 text-sm">
      <span className="text-ink-muted">{title}</span>
      <span>
        {t
          ? `${t.utmSource ?? label(t.channel)}${t.utmCampaign ? ` · ${t.utmCampaign}` : ""} · ${formatDate(t.occurredAt)}`
          : "—"}
      </span>
    </p>
  );
}

function BackLink() {
  return (
    <Link href="/people" className="text-blue-ink text-sm underline">
      ← People
    </Link>
  );
}

function DetailSkeleton() {
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

// GET /api/consent/:personId (spec §7). Hidden for roles without consent read.
function ConsentPanel({ personId }: { personId: string }) {
  const [consent, setConsent] = useState<ConsentState[] | null | "error">(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    fetch(`/api/consent/${encodeURIComponent(personId)}`)
      .then(async (res) => {
        if (res.status === 403) return setHidden(true);
        if (!res.ok) return setConsent("error");
        setConsent((await res.json()).data);
      })
      .catch(() => setConsent("error"));
  }, [personId]);

  if (hidden) return null;
  return (
    <Panel title="Consent" empty={Array.isArray(consent) && !consent.length}>
      {consent === null ? (
        <div className="bg-surface-sunken h-10 animate-pulse rounded-sm" />
      ) : consent === "error" ? (
        <p className="text-danger text-sm">Couldn&apos;t load consent.</p>
      ) : (
        consent.map((c) => (
          <Row key={c.purpose}>
            <span>
              {c.purpose === "marketing_email"
                ? "Marketing email"
                : "Marketing WhatsApp"}
            </span>
            <span className={c.isGranted ? "text-success" : "text-danger"}>
              {c.isGranted ? "Granted" : "Withdrawn"}
            </span>
            <span>{formatDate(c.recordedAt)}</span>
          </Row>
        ))
      )}
    </Panel>
  );
}

// GET /api/people/:id/timeline (spec §7.1): 50 per page, "Load more" appends.
function TimelinePanel({ personId }: { personId: string }) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/people/${encodeURIComponent(personId)}/timeline?page=${page}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body: ListResponse<TimelineItem> = await res.json();
        setItems((prev) => (page === 1 ? body.data : [...prev, ...body.data]));
        setTotal(body.page.total);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [personId, page]);

  const loadPage = (next: number) => {
    setLoading(true);
    setPage(next);
  };

  return (
    <Panel title="Timeline" empty={!loading && !error && total === 0}>
      {error ? (
        <div className="text-danger text-sm">
          Couldn&apos;t load the timeline.{" "}
          <Button variant="link" onClick={() => loadPage(page)}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <ol className="space-y-2">
            {items.map((t, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="text-ink-muted w-36 shrink-0">
                  {formatDate(t.at)}, {formatTime(t.at)}
                </span>
                <span>{t.text}</span>
              </li>
            ))}
          </ol>
          {loading && (
            <div className="bg-surface-sunken mt-2 h-10 animate-pulse rounded-sm" />
          )}
          {!loading && total !== null && items.length < total && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => loadPage(page + 1)}
            >
              Load more
            </Button>
          )}
        </>
      )}
    </Panel>
  );
}

// Soft delete, super_admin only (button is UX; DELETE re-checks). Reason is
// required and goes to the audit log.
function DeletePerson({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete
      </Button>
    );

  async function remove() {
    const res = await fetch(`/api/people/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) return router.push("/people");
    setError((await res.json()).error?.message ?? "Couldn't delete.");
  }

  return (
    <div className="w-full space-y-2 rounded-md border p-3 text-sm">
      <p>
        Delete <strong>{name}</strong>? They disappear from all lists. Use this
        for test data or mistakes only.
      </p>
      <Input
        aria-label="Reason for deleting"
        placeholder="Reason (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={!reason.trim()}
          onClick={remove}
        >
          Confirm delete
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// PDPA erasure = anonymise (spec 12.10), on the person's request.
// Irreversible, so the admin types the name first; the reason is audited.
function ErasePerson({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Erase personal data
      </Button>
    );

  async function erase() {
    const res = await fetch(`/api/people/${encodeURIComponent(id)}/erase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) return router.push("/people");
    setError((await res.json()).error?.message ?? "Couldn't erase.");
  }

  return (
    <div className="w-full space-y-2 rounded-md border p-3 text-sm">
      <p>
        Erase personal data for <strong>{name}</strong> (PDPA request)? Name,
        email, phone, notes and messages are cleared. Deals, payments and
        enrolments stay. <strong>This can&apos;t be undone.</strong>
      </p>
      <Input
        aria-label="Reason for erasing"
        placeholder="Reason (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Input
        aria-label="Type the name to confirm"
        placeholder={`Type "${name}" to confirm`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={!reason.trim() || typed.trim() !== name}
          onClick={erase}
        >
          Confirm erase
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
