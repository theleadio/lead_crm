import { fill } from "./dictionaries";
import { courseName, splitTemplate } from "./schedule/schedule-view";
import type { Locale } from "./locale";
import type { ScheduleClass } from "@/lib/public/schedule";

// A heading that names a class: "Register for {course}", 报名 {course}. The
// name comes from the page's own language (§10.5) and is wrapped in its own
// element only when it needs a `lang` — a Chinese page falling back to a
// course's English name. Otherwise the heading stays one string, which is
// what the dictionary and the tests describe.
//
// Returns the heading's contents, not the heading: each page keeps its own
// <h1> and its own classes.
export function CourseHeading({
  template,
  cls,
  locale,
}: {
  template: string;
  cls: Pick<ScheduleClass, "courseNameEn" | "courseNameZh">;
  locale: Locale;
}) {
  const name = courseName(cls, locale);
  if (!name.lang) return fill(template, { course: name.text });
  const [before, after] = splitTemplate(template);
  return (
    <>
      {before}
      <span lang={name.lang}>{name.text}</span>
      {after}
    </>
  );
}
