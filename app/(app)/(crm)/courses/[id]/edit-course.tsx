"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { CourseListItem } from "@/lib/courses/service";
import { CourseFormDialog, valuesFrom } from "../course-form-dialog";

// The course page's Edit (top right, as on every record page). A course is a
// short form, so it keeps the dialog the list used; saving refreshes the page
// in place.
export function EditCourse({ course }: { course: CourseListItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && (
        <CourseFormDialog
          open
          onOpenChange={setOpen}
          courseId={course.id}
          version={course.version}
          initial={valuesFrom(course)}
          onSaved={(c) => {
            setOpen(false);
            setToast(`Saved ${c.nameEn}.`);
            router.refresh();
          }}
          onStale={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
