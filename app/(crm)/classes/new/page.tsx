import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass } from "@/lib/auth/permissions";
import { listCourses } from "@/lib/courses/service";
import { courseListQuerySchema } from "@/lib/validation/course";
import { ClassForm } from "../class-form";

// Spec §9.9 create. Hiding the screen is UX only — POST /api/classes
// re-checks the §6 course/class row.
export default async function NewClassPage() {
  const user = await getCurrentUser();
  if (!user || !canWriteClass(user)) notFound();

  // A new class may only point at a course still on offer (§9.5 v1.6).
  const courses = await listCourses(
    courseListQuerySchema.parse({ active: "true", sort: "name", limit: "100" }),
  );

  return (
    <ClassForm
      courses={courses.data.map((c) => ({
        id: c.id,
        code: c.code,
        nameEn: c.nameEn,
      }))}
    />
  );
}
