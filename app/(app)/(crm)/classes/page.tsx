import { listClasses } from "@/lib/classes/service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass, permissionFor } from "@/lib/auth/permissions";
import { listCourses } from "@/lib/courses/service";
import { classListQuerySchema } from "@/lib/validation/class-query";
import { courseListQuerySchema } from "@/lib/validation/course";
import { ClassesList } from "./classes-list";

// Spec §9.8 Classes list — Operations' home screen. Read-only: creating and
// editing a class is 9.9, the detail screen is 9.10.
export default async function ClassesPage(props: PageProps<"/classes">) {
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  // §9.0 Home links here with filter[pendingNotice]=true; the list has to open
  // on that filter, so the first page the server renders carries it too. Same
  // param name the API reads (§7).
  const pendingNotice = one(sp["filter[pendingNotice]"]) === "true";

  const user = await getCurrentUser();
  const mayRead = !!user && permissionFor(user, "class", "read").allowed;

  // First page and the course options on the server; the client only
  // refetches when a filter, the view, the sort or the page changes.
  const [initial, courses] = mayRead
    ? await Promise.all([
        listClasses(
          classListQuerySchema.parse(
            pendingNotice ? { pendingNotice: "true" } : {},
          ),
          user,
        ),
        // Every course, retired ones included: a class on a retired course
        // has to stay findable (§9.5 v1.6).
        listCourses(courseListQuerySchema.parse({ sort: "name" })),
      ])
    : [null, null];

  return (
    <ClassesList
      // A new URL is a different first page: without the key the client keeps
      // the filter state it mounted with and the server's rows disagree with
      // the controls above them.
      key={String(pendingNotice)}
      initial={initial}
      initialPendingNotice={pendingNotice}
      courses={
        courses?.data.map((c) => ({
          id: c.id,
          nameEn: c.nameEn,
          isActive: c.isActive,
        })) ?? []
      }
      canWrite={!!user && canWriteClass(user)}
    />
  );
}
