"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LostReasonDialog } from "../lost-reason-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CompanySelect } from "./company-select";
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
import { formatDate } from "@/lib/format/date";
import { formatMoneyMyr } from "@/lib/format/money";
import { agingTone, daysInStage } from "@/lib/deals/format";
import {
  FUNDING_TYPES,
  STAGES,
  STAGE_LABELS,
  type DealDetail,
  type FundingType,
  type Ref,
  type Stage,
} from "@/lib/deals/types";
import type { OwnerOption } from "@/lib/people/types";

// Spec §9.6 Deal detail. Stage is moved through POST /api/deals/:id/stage —
// the same route the board uses — and never through PATCH (§12.5).

type Form = {
  companyId: string;
  courseId: string;
  ownerId: string;
  headcount: string;
  amountMyr: string;
  fundingType: string;
  hrdcGrantRef: string;
  hrdcApprovalDate: string;
  hrdcDeadlineDate: string;
  lostReasonId: string;
};

function toForm(d: DealDetail): Form {
  return {
    companyId: d.company?.id ?? "",
    courseId: d.course?.id ?? "",
    ownerId: d.owner?.id ?? "",
    headcount: d.headcount == null ? "" : String(d.headcount),
    amountMyr: d.amountMyr ?? "",
    fundingType: d.fundingType ?? "",
    hrdcGrantRef: d.hrdcGrantRef ?? "",
    hrdcApprovalDate: d.hrdcApprovalDate ?? "",
    hrdcDeadlineDate: d.hrdcDeadlineDate ?? "",
    lostReasonId: d.lostReason?.id ?? "",
  };
}

const FUNDING_LABELS: Record<FundingType, string> = {
  self: "Self funded",
  company: "Company",
  hrdc: "HRDC",
  other: "Other",
};

const label = (s: string) => s.replace(/_/g, " ");

type LoadState =
  | { status: "loading" }
  | { status: "error"; code: number | null; message: string }
  | { status: "ready"; deal: DealDetail };

export function DealDetailView({
  id,
  canWrite,
}: {
  id: string;
  canWrite: boolean;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<React.ReactNode | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/deals/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok)
          setState({
            status: "error",
            code: res.status,
            message: body.error?.message ?? "Couldn't load this deal.",
          });
        else setState({ status: "ready", deal: body });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setState({
          status: "error",
          code: null,
          message: "Couldn't load this deal — check your connection.",
        });
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  const reload = () => {
    setState({ status: "loading" });
    setReloadKey((k) => k + 1);
  };

  // Re-read without blanking the screen. A stage move changes the stage, the
  // days-in-stage reset and the history row, but the rest of the deal is
  // still on screen and correct — a skeleton flash would throw it away.
  const refresh = () => setReloadKey((k) => k + 1);

  if (state.status === "loading") return <DetailSkeleton />;

  if (state.status === "error")
    return (
      <DetailError
        backHref="/deals"
        backLabel="Deals"
        message={state.message}
        onRetry={state.code !== 404 && state.code !== 403 ? reload : undefined}
      />
    );

  const d = state.deal;
  const days = daysInStage(d.stageChangedAt);
  const tone = agingTone(d.stage, days);

  return (
    <div className="space-y-6">
      <BackLink href="/deals" label="Deals" />

      <DetailHeader
        title={
          <>
            <Link
              href={`/people/${d.person.id}`}
              className="text-blue-ink underline"
            >
              {d.person.name || "Unnamed"}
            </Link>
            {d.course && (
              <span className="text-ink-muted font-normal">
                {" "}
                — {d.course.name}
              </span>
            )}
          </>
        }
        meta={
          <>
            <Badge variant="outline" className="capitalize">
              {d.pipeline}
            </Badge>
            <Badge
              variant={
                d.stage === "won"
                  ? "default"
                  : d.stage === "lost"
                    ? "destructive"
                    : "secondary"
              }
            >
              {STAGE_LABELS[d.stage]}
            </Badge>
            <span>
              {d.amountMyr ? formatMoneyMyr(d.amountMyr) : "No value"}
            </span>
            <span>Owner: {d.owner?.name ?? "Unassigned"}</span>
            <span
              className={
                tone === "red"
                  ? "text-danger"
                  : tone === "amber"
                    ? "text-warning"
                    : undefined
              }
            >
              {days} {days === 1 ? "day" : "days"} in stage
            </span>
          </>
        }
        actions={
          <DealActions deal={d} canWrite={canWrite} onNotice={setToast} />
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border-line bg-surface-raised rounded-md border p-4">
          <h2 className="mb-4 font-semibold">Details</h2>
          {canWrite ? (
            <EditForm
              key={d.id}
              deal={d}
              onSaved={(deal) => {
                setState({ status: "ready", deal });
                setToast("Saved changes to this deal.");
              }}
              onReload={reload}
            />
          ) : (
            <ReadOnlyDetails deal={d} />
          )}
        </section>

        <div className="space-y-4">
          <StageControl
            // Remount on every save, so a refused move's message doesn't
            // outlive the edit that fixed it.
            key={d.version}
            deal={d}
            canWrite={canWrite}
            onMoved={refresh}
            onNotice={setToast}
          />

          <Panel title="Stage history" empty={!d.stageHistory.length}>
            {d.stageHistory.length > 1 && (
              <p className="text-ink-muted mb-1 text-xs">Newest first</p>
            )}
            {d.stageHistory.map((h) => (
              <Row key={h.id}>
                <span className="capitalize">
                  {h.fromStage ? label(h.fromStage) : "Created"} →{" "}
                  {label(h.toStage)}
                </span>
                <span>{formatDate(h.changedAt)}</span>
                <span>{h.changedBy ?? "—"}</span>
              </Row>
            ))}
          </Panel>

          <Panel title="Tasks" empty={!d.tasks.length}>
            {d.tasks.map((t) => (
              <Row key={t.id}>
                <span className={t.doneAt ? "text-ink-muted line-through" : ""}>
                  {t.title}
                </span>
                <span className="capitalize">{label(t.type)}</span>
                <span>{t.dueAt ? formatDate(t.dueAt) : "No due date"}</span>
                <span>{t.assignedTo ?? "Unassigned"}</span>
              </Row>
            ))}
          </Panel>

          <Panel title="Enrolments" empty={!d.enrolments.length}>
            {d.enrolments.map((e) => (
              <Row key={e.id}>
                <span>{e.classCode ?? "—"}</span>
                <span className="capitalize">{label(e.status)}</span>
                <span>
                  {e.pricePaidMyr ? formatMoneyMyr(e.pricePaidMyr) : "Not paid"}
                </span>
              </Row>
            ))}
          </Panel>
          {/* §9.6: a won deal with no enrolment should get one. */}
          {d.stage === "won" && !d.enrolments.length && (
            <p className="text-ink-muted text-sm">
              This deal is won with no enrolment yet. Create one so the student
              has a seat — available with the Enrolments screen (9.11).
            </p>
          )}

          <Panel title="Linked enquiry" empty={!d.enquiry}>
            {d.enquiry && (
              <Row>
                <span className="capitalize">{label(d.enquiry.channel)}</span>
                <span className="capitalize">
                  {d.enquiry.category ? label(d.enquiry.category) : "—"}
                </span>
                <span className="capitalize">{label(d.enquiry.status)}</span>
                <span>
                  {d.enquiry.firstMessageAt
                    ? formatDate(d.enquiry.firstMessageAt)
                    : "—"}
                </span>
              </Row>
            )}
          </Panel>
        </div>
      </div>

      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

// Send checkout link, Create enrolment and Add task wait on routes that
// aren't built (proposal: Shawn's, 9.11, 9.14). Disabled and labelled, so
// the screen says "coming" rather than "not in the product".
function DealActions({
  deal,
  canWrite,
  onNotice,
}: {
  deal: DealDetail;
  canWrite: boolean;
  onNotice: (message: React.ReactNode) => void;
}) {
  if (!canWrite) return null;
  return (
    <>
      <Button
        variant="outline"
        disabled
        title="Waiting on the Stripe checkout route (Shawn)"
      >
        Send checkout link
      </Button>
      <Button
        variant="outline"
        disabled
        title="Waiting on the Enrolments screen (9.11)"
      >
        Create enrolment
      </Button>
      <Button variant="outline" disabled title="Waiting on Tasks (9.14)">
        Add task
      </Button>
      {deal.checkoutUrl && (
        <Button
          variant="outline"
          onClick={() => onNotice("Checkout link is in the Details panel.")}
        >
          Checkout link sent
        </Button>
      )}
    </>
  );
}

// Spec §12.5: stage moves go to the stage route, with the same required
// reason dialog the board uses. A refused move leaves the stage as it was.
function StageControl({
  deal,
  canWrite,
  onMoved,
  onNotice,
}: {
  deal: DealDetail;
  canWrite: boolean;
  onMoved: () => void;
  onNotice: (message: React.ReactNode) => void;
}) {
  const [moving, setMoving] = useState(false);
  const [askLost, setAskLost] = useState(false);
  const [error, setError] = useState<{
    message: string;
    missing: string[];
  } | null>(null);

  if (!canWrite) return null;

  async function move(toStage: Stage, lostReasonId?: string) {
    setMoving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/deals/${encodeURIComponent(deal.id)}/stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toStage, lostReasonId }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        setError({
          message: body.error?.message ?? "Couldn't move this deal.",
          missing: body.error?.missing ?? [],
        });
        return;
      }
      onNotice(`Moved to ${STAGE_LABELS[toStage]}.`);
      onMoved();
    } catch {
      setError({
        message: "Couldn't move this deal — check your connection.",
        missing: [],
      });
    } finally {
      setMoving(false);
    }
  }

  return (
    <Panel title="Stage">
      <div className="flex items-center gap-2">
        <label htmlFor="stage" className="sr-only">
          Stage
        </label>
        <select
          id="stage"
          value={deal.stage}
          disabled={moving}
          onChange={(e) => {
            const to = e.target.value as Stage;
            if (to === deal.stage) return;
            if (to === "lost") setAskLost(true);
            else void move(to);
          }}
          className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {STAGES[deal.pipeline].map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        {moving && <span className="text-ink-muted text-sm">Moving…</span>}
      </div>

      {error && (
        <div role="alert" className="text-danger mt-2 text-sm">
          <p>{error.message}</p>
          {error.missing.length > 0 && (
            <p className="text-ink-muted">
              Fill in {error.missing.map(fieldLabel).join(", ")} on the left,
              save, then try again.
            </p>
          )}
        </div>
      )}

      {askLost && (
        <LostReasonDialog
          personName={deal.person.name}
          onCancel={() => setAskLost(false)}
          onConfirm={(lostReasonId) => {
            setAskLost(false);
            void move("lost", lostReasonId);
          }}
        />
      )}
    </Panel>
  );
}

const FIELD_LABELS: Record<string, string> = {
  companyId: "company",
  headcount: "headcount",
  fundingType: "funding type",
  hrdcGrantRef: "HRDC grant reference",
  hrdcApprovalDate: "HRDC approval date",
  hrdcDeadlineDate: "HRDC deadline date",
};
const fieldLabel = (f: string) => FIELD_LABELS[f] ?? f;

function EditForm({
  deal,
  onSaved,
  onReload,
}: {
  deal: DealDetail;
  onSaved: (deal: DealDetail) => void;
  onReload: () => void;
}) {
  const [form, setForm] = useState<Form>(() => toForm(deal));
  // The form as the server last gave it to us. "Changed" is measured against
  // this, not against the current props, so a refresh underneath us doesn't
  // make untouched fields look edited.
  const [initial, setInitial] = useState<Form>(() => toForm(deal));
  const [syncedVersion, setSyncedVersion] = useState(deal.version);

  // The deal changed under us — our own save, or a stage move in the panel
  // beside us. Take the server's value for every field the user hasn't
  // touched, and keep what they typed in the ones they have (§9 cross-screen:
  // never lose typed input). Adjusted during render, not in an effect: React
  // re-runs this component before painting, so nothing flashes.
  if (deal.version !== syncedVersion) {
    const next = toForm(deal);
    setSyncedVersion(deal.version);
    setInitial(next);
    setForm((f) => {
      const merged = { ...next };
      for (const k of Object.keys(next) as (keyof Form)[])
        if (f[k] !== initial[k]) merged[k] = f[k];
      return merged;
    });
  }
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [courses, setCourses] = useState<Ref[]>([]);
  const [reasons, setReasons] = useState<{ id: string; labelEn: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{
    message: string;
    stale?: boolean;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    fetch("/api/users/options")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setOwners(b.data))
      .catch(() => setOwners([]));
    // Active courses only on a picker (§9.5 v1.6); the board filter is the
    // one that lists retired ones.
    fetch("/api/courses?active=true")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) =>
        setCourses(
          (b.data as { id: string; nameEn: string }[]).map((c) => ({
            id: c.id,
            name: c.nameEn,
          })),
        ),
      )
      .catch(() => setCourses([]));
  }, []);

  // Only needed while the deal is lost (§12.5 correction).
  useEffect(() => {
    if (deal.stage !== "lost") return;
    fetch("/api/lost-reasons")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setReasons(b.data))
      .catch(() => setReasons([]));
  }, [deal.stage]);

  const changed = (Object.keys(form) as (keyof Form)[]).filter(
    (k) => form[k] !== initial[k],
  );
  const set = (key: keyof Form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // §9 cross-screen: warn before losing typed input.
  useEffect(() => {
    if (!changed.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed.length]);

  const isHrdc = form.fundingType === "hrdc";

  // §12.6: the reminder exists because the deadline does, so withdrawing the
  // deadline closes it. That is a destructive side effect of an ordinary
  // field edit, so it is confirmed rather than silent (§9 cross-screen).
  const openReminder = deal.tasks.find(
    (t) => t.type === "hrdc_deadline" && !t.doneAt,
  );
  const closesReminder = Boolean(
    openReminder &&
    changed.some(
      (k) =>
        (k === "hrdcDeadlineDate" && form.hrdcDeadlineDate === "") ||
        (k === "fundingType" && form.fundingType !== "hrdc"),
    ),
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!changed.length) return;
    if (closesReminder) setConfirmClose(true);
    else void save();
  }

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});

    // Partial: only what changed (§7). "" means clear.
    const patch: Record<string, string | number | null> = {};
    for (const k of changed) {
      const v = form[k];
      if (k === "headcount") patch.headcount = v === "" ? null : Number(v);
      else patch[k] = v === "" ? null : v;
    }

    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(deal.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(deal.version),
        },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) {
        // Never lose typed input on a failed save (§9 cross-screen).
        const missing: string[] = body.error?.missing ?? [];
        setError({
          message: body.error?.message ?? "Couldn't save.",
          stale: body.error?.code === "stale_edit",
        });
        setFieldErrors({
          ...(body.error?.fields ?? {}),
          ...Object.fromEntries(
            missing.map((f) => [f, `${fieldLabel(f)} is needed at this stage`]),
          ),
        });
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
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      {error && (
        <div
          role="alert"
          className="bg-danger-soft text-danger rounded-md p-3 text-sm"
        >
          <p>{error.message}</p>
          {error.stale && (
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={onReload}
            >
              Reload the deal
            </Button>
          )}
        </div>
      )}

      {/* Read-only: changing either would make this a different deal. */}
      <ReadOnlyRow label="Pipeline" value={deal.pipeline} />
      <ReadOnlyRow label="Person" value={deal.person.name} />

      <Field id="courseId" label="Course" error={fieldErrors.courseId}>
        <Select
          id="courseId"
          value={form.courseId}
          onChange={set("courseId")}
          placeholder="No course"
          options={courses.map((c) => ({ value: c.id, label: c.name }))}
          // A course that is now inactive still shows while it is the
          // deal's own (the picker lists active ones only).
          extra={
            deal.course && !courses.some((c) => c.id === deal.course!.id)
              ? {
                  value: deal.course.id,
                  label: `${deal.course.name} (inactive)`,
                }
              : undefined
          }
        />
      </Field>

      <Field id="companyId" label="Company" error={fieldErrors.companyId}>
        {/* A corporate deal needs one before it can leave discovery (§12.5),
            so it must be possible to attach one here, not only clear it. */}
        <CompanySelect
          value={form.companyId}
          currentName={deal.company?.name ?? null}
          onChange={(companyId) => set("companyId")(companyId)}
        />
      </Field>

      <ReadOnlyRow
        label="Class"
        value={deal.class?.name ?? null}
        hint="Set with the Classes screen (9.8)"
      />

      <Field id="headcount" label="Headcount" error={fieldErrors.headcount}>
        <Input
          id="headcount"
          type="number"
          min={1}
          step={1}
          value={form.headcount}
          onChange={(e) => set("headcount")(e.target.value)}
        />
      </Field>

      <Field id="amountMyr" label="Value (MYR)" error={fieldErrors.amountMyr}>
        <Input
          id="amountMyr"
          inputMode="decimal"
          placeholder="4500.00"
          value={form.amountMyr}
          onChange={(e) => set("amountMyr")(e.target.value)}
        />
      </Field>

      <Field
        id="fundingType"
        label="Funding type"
        error={fieldErrors.fundingType}
      >
        <Select
          id="fundingType"
          value={form.fundingType}
          onChange={set("fundingType")}
          placeholder="Not set"
          options={FUNDING_TYPES.map((f) => ({
            value: f,
            label: FUNDING_LABELS[f],
          }))}
        />
      </Field>

      {/* §12.6: HRDC fields belong to HRDC funding, and are needed before
          the deal can be Won. They appear as soon as the select changes. */}
      {isHrdc && (
        <fieldset className="border-line space-y-3 rounded-md border p-3">
          <legend className="text-ink-muted px-1 text-xs">
            HRDC — needed before this deal can be Won
          </legend>
          <Field
            id="hrdcGrantRef"
            label="Grant reference"
            required
            error={fieldErrors.hrdcGrantRef}
          >
            <Input
              id="hrdcGrantRef"
              value={form.hrdcGrantRef}
              onChange={(e) => set("hrdcGrantRef")(e.target.value)}
            />
          </Field>
          <Field
            id="hrdcApprovalDate"
            label="Approval date"
            required
            error={fieldErrors.hrdcApprovalDate}
          >
            <Input
              id="hrdcApprovalDate"
              type="date"
              value={form.hrdcApprovalDate}
              onChange={(e) => set("hrdcApprovalDate")(e.target.value)}
            />
          </Field>
          <Field
            id="hrdcDeadlineDate"
            label="Deadline date"
            required
            error={fieldErrors.hrdcDeadlineDate}
          >
            <Input
              id="hrdcDeadlineDate"
              type="date"
              value={form.hrdcDeadlineDate}
              onChange={(e) => set("hrdcDeadlineDate")(e.target.value)}
            />
          </Field>
          <p className="text-ink-muted text-xs">
            A deadline on a deal in Funding creates the reminder task for the
            owner. Clearing it closes that reminder.
          </p>
        </fieldset>
      )}

      <Field id="ownerId" label="Owner" error={fieldErrors.ownerId}>
        <Select
          id="ownerId"
          value={form.ownerId}
          onChange={set("ownerId")}
          placeholder="Unassigned"
          options={owners.map((o) => ({ value: o.id, label: o.fullName }))}
        />
      </Field>

      {/* §12.5: a correction on an already-lost deal; it cannot be cleared. */}
      {deal.stage === "lost" && (
        <Field
          id="lostReasonId"
          label="Lost reason"
          required
          error={fieldErrors.lostReasonId}
        >
          <Select
            id="lostReasonId"
            value={form.lostReasonId}
            onChange={set("lostReasonId")}
            options={reasons.map((r) => ({ value: r.id, label: r.labelEn }))}
            extra={
              deal.lostReason &&
              !reasons.some((r) => r.id === deal.lostReason!.id)
                ? {
                    value: deal.lostReason.id,
                    label: `${deal.lostReason.labelEn} (retired)`,
                  }
                : undefined
            }
          />
        </Field>
      )}

      {deal.checkoutUrl && (
        <p className="text-ink-muted text-sm">
          Checkout link:{" "}
          <a
            href={deal.checkoutUrl}
            className="text-blue-ink underline"
            rel="noreferrer"
            target="_blank"
          >
            open
          </a>
          {deal.checkoutSentAt && ` — sent ${formatDate(deal.checkoutSentAt)}`}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={saving || !changed.length}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {changed.length > 0 && !saving && (
          <button
            type="button"
            onClick={() => setForm(initial)}
            className="text-ink-muted text-sm underline"
          >
            Discard changes
          </button>
        )}
      </div>

      {/* Cancelling sends nothing and leaves the typed values alone. */}
      {confirmClose && openReminder && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirmClose(false)}
          title="This closes the HRDC reminder"
          body={
            <>
              <p>
                {form.fundingType !== "hrdc"
                  ? "This deal is no longer HRDC funded, so its deadline reminder no longer applies."
                  : "Removing the deadline leaves nothing for the reminder to fall due on."}
              </p>
              <p>
                <strong>{openReminder.title}</strong>, due{" "}
                {openReminder.dueAt ? formatDate(openReminder.dueAt) : "—"},
                assigned to {openReminder.assignedTo ?? "nobody"}, will be
                closed.
              </p>
            </>
          }
          confirmLabel="Save and close reminder"
          onConfirm={async () => {
            setConfirmClose(false);
            await save();
          }}
        />
      )}
    </form>
  );
}

function ReadOnlyDetails({ deal }: { deal: DealDetail }) {
  const rows: [string, string | null][] = [
    ["Pipeline", deal.pipeline],
    ["Person", deal.person.name],
    ["Company", deal.company?.name ?? null],
    ["Course", deal.course?.name ?? null],
    ["Class", deal.class?.name ?? null],
    ["Headcount", deal.headcount == null ? null : String(deal.headcount)],
    ["Value", deal.amountMyr ? formatMoneyMyr(deal.amountMyr) : null],
    [
      "Funding type",
      deal.fundingType ? FUNDING_LABELS[deal.fundingType] : null,
    ],
    ["HRDC grant ref", deal.hrdcGrantRef],
    ["HRDC approval", deal.hrdcApprovalDate],
    ["HRDC deadline", deal.hrdcDeadlineDate],
    ["Owner", deal.owner?.name ?? null],
    ["Lost reason", deal.lostReason?.labelEn ?? null],
  ];
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="whitespace-pre-wrap capitalize">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReadOnlyRow({
  label: text,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <span className="text-ink text-sm font-medium">{text}</span>
      <p className="text-ink-muted text-sm capitalize">
        {value ?? "—"}
        {hint && <span className="normal-case"> — {hint}</span>}
      </p>
    </div>
  );
}

function Field({
  id,
  label: text,
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
        {text}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}

function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
  extra,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  // A value the deal already holds that the picker wouldn't list.
  extra?: { value: string; label: string };
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {extra && <option value={extra.value}>{extra.label}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
