import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteCourse, permissionFor } from "@/lib/auth/permissions";
import { listCourses } from "@/lib/courses/service";
import { courseListQuerySchema } from "@/lib/validation/course";
import { CoursesList } from "./courses-list";

// Spec §9.7. Hiding the write controls is UX only — the API re-checks (§6).
export default async function CoursesPage() {
  const user = await getCurrentUser();
  // First page on the server; the client only refetches when a filter, sort
  // or page changes.
  const initial =
    user && permissionFor(user, "class", "read").allowed
      ? await listCourses(courseListQuerySchema.parse({ sort: "name" }))
      : null;
  return (
    <CoursesList
      initial={initial}
      canWrite={user ? canWriteCourse(user) : false}
    />
  );
}
