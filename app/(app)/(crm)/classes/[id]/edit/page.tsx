import { notFound } from "next/navigation";
import { getClass } from "@/lib/classes/service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass } from "@/lib/auth/permissions";
import { listCourses } from "@/lib/courses/service";
import { courseListQuerySchema } from "@/lib/validation/course";
import { ClassForm } from "../../class-form";

// Spec §9.9 edit. A date, time or venue change on a class with students goes
// through the notice dialog on the way (§7.1) — the server asks, not the form.
export default async function EditClassPage({
  params,
}: PageProps<"/classes/[id]/edit">) {
  const user = await getCurrentUser();
  if (!user || !canWriteClass(user)) notFound();

  const { id } = await params;
  const [existing, courses] = await Promise.all([
    getClass(id, user),
    // Every course here, retired ones included: a class already on a retired
    // course must stay editable without silently moving it (§9.5 v1.6).
    listCourses(courseListQuerySchema.parse({ sort: "name", limit: "100" })),
  ]);
  if (!existing) notFound();

  return (
    <ClassForm
      existing={existing}
      courses={courses.data.map((c) => ({
        id: c.id,
        code: c.code,
        nameEn: c.isActive ? c.nameEn : `${c.nameEn} (inactive)`,
      }))}
    />
  );
}
