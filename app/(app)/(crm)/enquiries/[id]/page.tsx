import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink, DetailHeader, Panel, Row } from "@/components/detail-kit";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { mayUseEnquiries, teamsOf } from "@/lib/enquiries/access";
import { enquiryDetail, type EnquiryDetail } from "@/lib/enquiries/detail";
import { listCategories } from "@/lib/enquiries/routing";
import { ENQUIRY_STATUS_BADGE } from "@/lib/enquiries/types";
import { formatDateTime } from "@/lib/format/date";
import { listOwnerOptions } from "@/lib/people/service";
import {
  DASH,
  QUEUE_COLUMNS,
  enquiryLabel,
  queueCells,
  rowActions,
} from "../queue-view";
import { EnquiryActions } from "./enquiry-actions";

// One enquiry (migration 019): what the queue shows, plus its history, notes
// and the conversation it came from. The writes are the queue's
// (PATCH /api/enquiries/:id) and a note (POST …/notes); both re-check access.
export default async function EnquiryPage(props: PageProps<"/enquiries/[id]">) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user || !(await mayUseEnquiries(user, "read"))) notFound();
  const detail = await enquiryDetail(user, id);
  if (!detail) notFound();

  const write = permissionFor(user, "enquiry", "write");
  const [teamIds, categories] = await Promise.all([
    teamsOf(user.id),
    listCategories(),
  ]);
  const access = {
    viewerId: user.id,
    canWrite: write.allowed,
    assignedOnly: write.assignedOnly,
    teamIds,
  };
  const row = detail.row;
  const can = rowActions(row, access);
  const users = can.assign ? await listOwnerOptions() : [];
  const cells = queueCells(row);

  return (
    <div className="space-y-6">
      <BackLink href="/enquiries" label="Enquiries" />
      <DetailHeader
        title={
          <>
            {row.number}
            {row.subject ? ` · ${row.subject}` : ""}
          </>
        }
        meta={
          <>
            <Badge variant={ENQUIRY_STATUS_BADGE[row.status]}>
              {enquiryLabel(row.status)}
            </Badge>
            {row.pastSla && <Badge variant="destructive">Past SLA</Badge>}
            <span>
              <Link
                href={`/people/${detail.person.id}`}
                className="text-blue-ink hover:underline"
              >
                {detail.person.name}
              </Link>
            </span>
            <span>{row.teamName}</span>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Messages" empty={detail.messages.length === 0}>
            <ol className="space-y-3">
              {detail.messages.map((m) => (
                <li
                  key={m.id}
                  className={`max-w-[85%] rounded-md border p-3 text-sm ${
                    m.direction === "in"
                      ? "border-line bg-surface"
                      : "border-line bg-blue-soft ml-auto"
                  }`}
                >
                  <p className="text-ink-muted mb-1 text-xs">
                    {m.direction === "in"
                      ? detail.person.name
                      : (m.senderName ?? "LEAD")}{" "}
                    · {formatDateTime(m.sentAt)}
                    {m.attachments > 0 &&
                      ` · ${m.attachments} attachment${m.attachments === 1 ? "" : "s"}`}
                  </p>
                  {/* An erased person's messages keep their place, not
                      their words. */}
                  <p className="whitespace-pre-wrap">
                    {m.body ?? <em className="text-ink-muted">Removed</em>}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="History and notes" empty={detail.events.length === 0}>
            <ol className="space-y-2 text-sm">
              {detail.events.map((ev) => (
                <li
                  key={ev.id}
                  className="border-line border-t pt-2 first:border-t-0 first:pt-0"
                >
                  <p className="text-ink-muted text-xs">
                    {formatDateTime(ev.at)} · {ev.userName ?? "System"}
                  </p>
                  <p>{eventText(ev, categories)}</p>
                  {ev.note && (
                    <p className="mt-1 whitespace-pre-wrap">{ev.note}</p>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel title="Enquiry">
            {[1, 2, 3, 5, 6, 7, 8].map((i) => (
              <Row key={i}>
                <span className="text-ink-muted">{QUEUE_COLUMNS[i]}</span>
                <span>{cells[i]}</span>
              </Row>
            ))}
            <Row>
              <span className="text-ink-muted">Reply due</span>
              <span>{row.slaDueAt ? formatDateTime(row.slaDueAt) : DASH}</span>
            </Row>
            <Row>
              <span className="text-ink-muted">Priority</span>
              <span>{enquiryLabel(row.priority)}</span>
            </Row>
            {detail.previous && (
              <Row>
                <span className="text-ink-muted">Follows</span>
                <Link
                  href={`/enquiries/${detail.previous.id}`}
                  className="text-blue-ink hover:underline"
                >
                  {detail.previous.number}
                </Link>
              </Row>
            )}
            {detail.followUps.map((f) => (
              <Row key={f.id}>
                <span className="text-ink-muted">Followed by</span>
                <Link
                  href={`/enquiries/${f.id}`}
                  className="text-blue-ink hover:underline"
                >
                  {f.number}
                </Link>
              </Row>
            ))}
            {detail.resolution && (
              <Row>
                <span className="text-ink-muted">Outcome</span>
                <span className="whitespace-pre-wrap">{detail.resolution}</span>
              </Row>
            )}
          </Panel>

          <Panel title="Contact">
            <Row>
              <span className="text-ink-muted">Phone</span>
              <span>{detail.person.phone ?? DASH}</span>
            </Row>
            <Row>
              <span className="text-ink-muted">Email</span>
              <span className="break-all">{detail.person.email ?? DASH}</span>
            </Row>
          </Panel>

          <EnquiryActions
            row={row}
            can={can}
            users={users}
            categories={categories.filter((c) => c.active)}
            viewerId={user.id}
          />
        </aside>
      </div>
    </div>
  );
}

type Ev = EnquiryDetail["events"][number];

// One line per history row, in words. before/after hold ids and codes only.
function eventText(
  ev: Ev,
  categories: { code: string; label: string }[],
): string {
  const cat = (code: unknown) =>
    categories.find((c) => c.code === code)?.label ??
    (code ? enquiryLabel(String(code)) : "none");
  switch (ev.kind) {
    case "created":
      return `Created (${enquiryLabel(String(ev.after?.channel ?? ""))}, ${cat(ev.after?.category)}).`;
    case "status":
      return `Status: ${enquiryLabel(String(ev.before?.status ?? ""))} → ${enquiryLabel(String(ev.after?.status ?? ""))}.`;
    case "assigned":
      return ev.after?.assignedUserId ? "Reassigned." : "Unassigned.";
    case "category":
      return `Category: ${cat(ev.before?.category)} → ${cat(ev.after?.category)}.`;
    case "first_response":
      return "First reply sent.";
    case "note":
      return "Note:";
    default:
      return ev.kind;
  }
}
