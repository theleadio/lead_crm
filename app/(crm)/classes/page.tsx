import { listClasses } from "@/lib/classes/service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass, permissionFor } from "@/lib/auth/permissions";
import { listCourses } from "@/lib/courses/service";
import { classListQuerySchema } from "@/lib/validation/class-query";
import { courseListQuerySchema } from "@/lib/validation/course";
import { ClassesList } from "./classes-list";

// Spec §9.8 Classes list — Operations' home screen. Read-only: creating and
// editing a class is 9.9, the detail screen is 9.10.
export default async function ClassesPage() {
  const user = await getCurrentUser();
  const mayRead = !!user && permissionFor(user, "class", "read").allowed;

  // First page and the course options on the server; the client only
  // refetches when a filter, the view, the sort or the page changes.
  const [initial, courses] = mayRead
    ? await Promise.all([
        listClasses(classListQuerySchema.parse({}), user),
        // Every course, retired ones included: a class on a retired course
        // has to stay findable (§9.5 v1.6).
        listCourses(courseListQuerySchema.parse({ sort: "name" })),
      ])
    : [null, null];

  return (
    <ClassesList
      initial={initial}
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
