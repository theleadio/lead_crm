import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { listClasses } from "@/lib/classes/service";
import { listEnrolments } from "@/lib/enrolments/list";
import { classListQuerySchema } from "@/lib/validation/class-query";
import { courseListQuerySchema } from "@/lib/validation/course";
import { listCourses } from "@/lib/courses/service";
import {
  enrolmentListQuerySchema,
  readEnrolmentParams,
} from "@/lib/validation/enrolment-query";
import { EnrolmentsList } from "./enrolments-list";

// Spec §9.11 list — every enrolment across every class. Read-only: adding one
// is the §9.10 Roster's, changing one is the enrolment screen's.
export default async function EnrolmentsPage(props: PageProps<"/enrolments">) {
  const user = await getCurrentUser();
  // §6 enrolment row: marketing and part_time have no access at all, and the
  // sidebar already hides the link for them.
  if (!user || !permissionFor(user, "enrolment", "read").allowed) notFound();

  // The URL is the query: a filtered view can be linked, and a reload restores
  // it because the server reads it too (§7).
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(await props.searchParams))
    if (typeof value === "string") searchParams.set(key, value);
  const parsed = enrolmentListQuerySchema.safeParse(
    readEnrolmentParams(searchParams),
  );
  const query = parsed.success
    ? parsed.data
    : enrolmentListQuerySchema.parse({});

  const [initial, courses, classes] = await Promise.all([
    listEnrolments(query, user),
    // Every course, retired ones included: an enrolment on a retired course
    // has to stay findable (§9.5 v1.6).
    listCourses(courseListQuerySchema.parse({ sort: "name" })),
    // The class filter's options. 100 is the §7 maximum for one read; past
    // that this filter needs a search box rather than a longer list.
    listClasses(
      classListQuerySchema.parse({ when: query.when, limit: "100" }),
      user,
    ),
  ]);

  return (
    <EnrolmentsList
      initial={initial}
      initialQuery={query}
      courses={courses.data.map((c) => ({ id: c.id, nameEn: c.nameEn }))}
      classes={classes.data.map((c) => ({ id: c.id, code: c.code }))}
    />
  );
}
