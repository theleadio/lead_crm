import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackLink, DetailHeader } from "@/components/detail-kit";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canExportClassLists,
  canWriteClass,
  permissionFor,
  type Viewer,
} from "@/lib/auth/permissions";
import { listClassNotices } from "@/lib/classes/notices";
import { listRoster } from "@/lib/classes/roster";
import { getClass, type ClassRecord } from "@/lib/classes/service";
import { classStatusBadge, seatBarColor } from "@/lib/classes/types";
import { formatDateRange } from "@/lib/format/date";
import { ClassControls } from "./class-controls";
import { DetailsTab } from "./details-tab";
import { NoticesTab } from "./notices-tab";
import { RosterTab } from "./roster-tab";
import { TabStrip } from "./tab-strip";

// Spec §9.10 Class detail. Server-rendered, like the 9.9 edit form: the tab in
// the URL decides which panel is built, so a part-timer's page never carries
// roster rows it isn't allowed to read (§6 enrolment row, design 10).

type Tab = "details" | "roster" | "notices";

function tabsFor(viewer: Viewer): { id: Tab; label: string }[] {
  const tabs: { id: Tab; label: string }[] = [
    { id: "details", label: "Details" },
  ];
  // §6: marketing and part_time have no enrolment access at all.
  if (permissionFor(viewer, "enrolment", "read").allowed)
    tabs.push({ id: "roster", label: "Roster" });
  tabs.push({ id: "notices", label: "Notices" });
  return tabs;
}

export default async function ClassDetailPage(
  props: PageProps<"/classes/[id]">,
) {
  const user = await getCurrentUser();
  // Every signed-in role reads a class (§6 course/class row); no session or no
  // class read is a 404 rather than a screen that says what exists.
  if (!user || !permissionFor(user, "class", "read").allowed) notFound();

  const { id } = await props.params;
  const cls = await getClass(id, user);
  if (!cls) notFound();

  const tabs = tabsFor(user);
  const asked = (await props.searchParams).tab;
  const tab: Tab = tabs.find((t) => t.id === asked)?.id ?? ("details" as const);
  const canWrite = canWriteClass(user);

  return (
    <div className="space-y-6">
      <BackLink href="/classes" label="Classes" />
      <ClassHeader cls={cls} canWrite={canWrite} />
      <TabStrip tabs={tabs} active={tab} />

      {tab === "details" && (
        <DetailsTab
          cls={cls}
          canWrite={canWrite}
          // §12.1: seats taken is the two counts the database gave us, so the
          // dialog's number needs no query of its own.
          seatHolders={cls.confirmedCount + cls.reservedCount}
        />
      )}
      {tab === "roster" && (
        <RosterTab
          classId={id}
          rows={await listRoster(id, user)}
          canExport={canExportClassLists(user)}
        />
      )}
      {tab === "notices" && (
        <NoticesTab
          notices={await listClassNotices(id, user)}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}

// §9.10 header: the seat summary and the stored status. Nothing here is
// derived from the seat numbers — §12.1 keeps status in the database.
function ClassHeader({
  cls,
  canWrite,
}: {
  cls: ClassRecord;
  canWrite: boolean;
}) {
  const badge = classStatusBadge(cls.status);
  const sold = cls.confirmedCount + cls.reservedCount;
  const pct = Math.min(100, Math.round((sold / cls.capacity) * 100));

  return (
    <DetailHeader
      title={
        <span className="flex flex-wrap items-center gap-3">
          {cls.code}
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <Badge variant={cls.isPublic ? "default" : "secondary"}>
            {cls.isPublic ? "Public" : "Hidden"}
          </Badge>
        </span>
      }
      meta={
        <>
          <span>{cls.courseName}</span>
          <span>{formatDateRange(cls.startDate, cls.endDate)}</span>
          {/* The numbers are written out beside the bar, so the colour is
              never the only signal (§13). */}
          <span className="flex items-center gap-2">
            <span className="bg-surface-sunken h-1.5 w-24 overflow-hidden rounded-full">
              <span
                className={`block h-full rounded-full ${seatBarColor(cls.status)}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="text-ink text-xs font-semibold">
              {cls.confirmedCount} confirmed, {cls.reservedCount} reserved,{" "}
              {cls.seatsAvailable} of {cls.capacity} seats available
            </span>
          </span>
        </>
      }
      actions={
        canWrite ? (
          <span className="flex flex-wrap items-start justify-end gap-2">
            <Button asChild variant="outline">
              <Link href={`/classes/${cls.id}/edit`}>Edit</Link>
            </Button>
            {/* §9.10 v1.9: the status and website controls live here, not on
                the 9.8 row — the rules that refuse them need the seat count
                and the stored status, which this screen already shows. */}
            <ClassControls
              id={cls.id}
              status={cls.status}
              isPublic={cls.isPublic}
              version={cls.version}
            />
          </span>
        ) : undefined
      }
    />
  );
}
