import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkRow } from "@/components/link-row";
import { BackLink, DetailHeader } from "@/components/detail-kit";
import { EmptyRow, TableCard } from "@/components/list-kit";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from "@/components/ui/table";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCourse, permissionFor } from "@/lib/auth/permissions";
import { listClasses } from "@/lib/classes/service";
import {
  classStatusBadge,
  seatBarColor,
  type ClassListItem,
} from "@/lib/classes/types";
import { getCourse } from "@/lib/courses/service";
import { formatDateRange } from "@/lib/format/date";
import { formatMoneyMyr } from "@/lib/format/money";
import { classListQuerySchema } from "@/lib/validation/class-query";
import { EditCourse } from "./edit-course";

// A course's own page, like every other record: what the course is, then its
// classes with seats sold, so staff see how each run of it is selling. Edit
// sits top right. Read-only otherwise; nothing here writes.
export default async function CoursePage(props: PageProps<"/courses/[id]">) {
  const user = await getCurrentUser();
  // Every signed-in role reads courses and classes (§6 course/class row).
  if (!user || !permissionFor(user, "class", "read").allowed) notFound();

  const { id } = await props.params;
  const course = await getCourse(id);
  if (!course) notFound();

  const [upcoming, past] = await Promise.all([
    listClasses(
      classListQuerySchema.parse({
        when: "upcoming",
        courseId: id,
        sort: "start",
        limit: 100,
      }),
      user,
    ),
    listClasses(
      classListQuerySchema.parse({
        when: "past",
        courseId: id,
        sort: "-start",
        limit: 100,
      }),
      user,
    ),
  ]);

  const facts: [string, React.ReactNode][] = [
    // Code and names are already in the header; these are the selling facts.
    [
      "Chinese name",
      course.nameZh ? (
        <span key="zh" lang="zh-Hans">
          {course.nameZh}
        </span>
      ) : (
        "—"
      ),
    ],
    [
      "Track",
      <span key="track" className="capitalize">
        {course.track}
      </span>,
    ],
    [
      "Duration",
      `${course.durationDays} ${course.durationDays === 1 ? "day" : "days"}`,
    ],
    [
      "List price",
      course.listPriceMyr ? formatMoneyMyr(course.listPriceMyr) : "Not set",
    ],
    ["HRDC claimable", course.hrdcClaimable ? "Yes" : "No"],
  ];

  return (
    <div className="space-y-6">
      <BackLink href="/courses" label="Courses" />
      <DetailHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {course.nameEn}
            {course.isActive ? (
              <Badge variant="outline">Active</Badge>
            ) : (
              <Badge variant="secondary">Retired</Badge>
            )}
          </span>
        }
        meta={
          <>
            <span>{course.code}</span>
            {course.nameZh && <span lang="zh-Hans">{course.nameZh}</span>}
          </>
        }
        actions={canWriteCourse(user) ? <EditCourse course={course} /> : null}
      />

      {/* One strip, label over value, so long values never wrap into a
          narrow column. */}
      <dl className="border-line bg-surface-raised grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border p-5 text-sm sm:grid-cols-3 lg:grid-cols-5">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-ink-muted text-xs">{k}</dt>
            <dd className="mt-1 font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <ClassTable
        title="Upcoming classes"
        rows={upcoming.data}
        total={upcoming.page.total}
        empty="No upcoming class of this course."
      />
      <ClassTable
        title="Past classes"
        rows={past.data}
        total={past.page.total}
        empty="No class of this course has run yet."
      />
    </div>
  );
}

function ClassTable({
  title,
  rows,
  total,
  empty,
}: {
  title: string;
  rows: ClassListItem[];
  // The full count; the page lists at most 100 (§14).
  total: number;
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2.5 font-semibold">
        {title}
        <span className="bg-surface-sunken text-ink-muted rounded-full px-2 py-0.5 text-xs font-semibold">
          {total}
        </span>
        {total > rows.length && (
          <span className="text-ink-muted text-xs font-normal">
            Showing the first {rows.length}.{" "}
            <Link href="/classes" className="text-blue-ink hover:underline">
              See all on Classes
            </Link>
          </span>
        )}
      </h2>
      <TableCard>
        <Table className="min-w-[640px] table-fixed">
          <TableHeader>
            <tr>
              <TableHead>Class</TableHead>
              <TableHead className="w-36">Dates</TableHead>
              <TableHead className="w-24">Language</TableHead>
              <TableHead className="w-36">Seats sold</TableHead>
              <TableHead className="w-36">Status</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow columns={5}>{empty}</EmptyRow>
            ) : (
              rows.map((c) => {
                const sold = c.confirmedCount + c.reservedCount;
                const pct = Math.min(
                  100,
                  Math.round((sold / c.capacity) * 100),
                );
                const badge = classStatusBadge(c.status);
                return (
                  <LinkRow key={c.id} href={`/classes/${c.id}`}>
                    <TableCell className="truncate font-semibold">
                      <Link
                        href={`/classes/${c.id}`}
                        className="hover:text-blue-ink"
                      >
                        {c.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {formatDateRange(c.startDate, c.endDate)}
                    </TableCell>
                    <TableCell className="text-ink-muted">
                      {c.language === "zh" ? "中文" : "English"}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2.5">
                        <span className="bg-surface-sunken h-1.5 flex-1 overflow-hidden rounded-full">
                          <span
                            className={`block h-full rounded-full ${seatBarColor(c.status)}`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="w-12 text-xs font-semibold tabular-nums">
                          {sold}/{c.capacity}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                  </LinkRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableCard>
    </section>
  );
}
