import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackLink, DetailHeader } from "@/components/detail-kit";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canExportClassLists,
  canWriteClass,
  canWriteEnrolment,
  permissionFor,
  type Viewer,
} from "@/lib/auth/permissions";
import { listClassNotices } from "@/lib/classes/notices";
import { listRoster } from "@/lib/classes/roster";
import { getCourse, listCourses } from "@/lib/courses/service";
import { courseListQuerySchema } from "@/lib/validation/course";
import { getClass, type ClassRecord } from "@/lib/classes/service";
import { classStatusBadge, seatBarColor } from "@/lib/classes/types";
import { formatDateRange } from "@/lib/format/date";
import { ClassForm } from "../class-form";
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

  const course = await getCourse(cls.courseId);
  const tabs = tabsFor(user);
  const search = await props.searchParams;
  const tab: Tab =
    tabs.find((t) => t.id === search.tab)?.id ?? ("details" as const);
  const canWrite = canWriteClass(user);
  // §9.9 edit, in place of the read-only details (?edit=1). Saving or
  // cancelling drops the flag and shows the details again.
  const editing = canWrite && tab === "details" && search.edit === "1";
  const courses = editing
    ? // Every course, retired ones included: a class already on a retired
      // course must stay editable without silently moving it (§9.5 v1.6).
      await listCourses(
        courseListQuerySchema.parse({ sort: "name", limit: "100" }),
      )
    : null;

  return (
    <div className="space-y-6">
      <BackLink href="/classes" label="Classes" />
      <ClassHeader
        cls={cls}
        canWrite={canWrite && !editing}
        websiteGaps={websiteGaps(cls, course?.listPriceMyr ?? null)}
      />
      <TabStrip tabs={tabs} active={tab} />

      {editing && courses && (
        <section className="border-line bg-surface-raised rounded-md border p-5">
          <ClassForm
            existing={cls}
            courses={courses.data.map((c) => ({
              id: c.id,
              code: c.code,
              nameEn: c.isActive ? c.nameEn : `${c.nameEn} (inactive)`,
            }))}
          />
        </section>
      )}
      {tab === "details" && !editing && (
        <DetailsTab
          cls={cls}
          canWrite={canWrite}
          courseListPriceMyr={course?.listPriceMyr ?? null}
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
          // §6 enrolment row: super_admin and operations add; §9.11 owns the
          // status and transfer moves, so those are not on this tab.
          canWriteEnrolment={canWriteEnrolment(user)}
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
  websiteGaps,
}: {
  cls: ClassRecord;
  canWrite: boolean;
  websiteGaps: string[];
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
              <Link href={`/classes/${cls.id}?edit=1`}>Edit</Link>
            </Button>
            {/* §9.10 v1.9: the status and website controls live here, not on
                the 9.8 row — the rules that refuse them need the seat count
                and the stored status, which this screen already shows. */}
            <ClassControls
              id={cls.id}
              status={cls.status}
              isPublic={cls.isPublic}
              version={cls.version}
              websiteGaps={websiteGaps}
            />
          </span>
        ) : undefined
      }
    />
  );
}

// What a visitor would see missing if this class went on the website (§10:
// show the real class). "TBC" counts as missing: it is a placeholder, not a
// venue. Shown as a warning before Show on website, never a block.
function websiteGaps(cls: ClassRecord, courseListPriceMyr: string | null) {
  const tbc = (v: string | null) => !v?.trim() || /^tbc$/i.test(v.trim());
  const gaps: string[] = [];
  if (!cls.priceMyr && !courseListPriceMyr) gaps.push("No price is set.");
  if (cls.mode !== "online") {
    if (tbc(cls.venueName)) gaps.push("The venue is not set.");
    if (tbc(cls.venueAddress) || tbc(cls.city))
      gaps.push("The venue address or city still says TBC.");
  }
  if (cls.mode !== "in_person" && !cls.onlineUrl?.trim())
    gaps.push("There is no joining link.");
  if (!cls.startTime) gaps.push("No start time is set.");
  return gaps;
}
