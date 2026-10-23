import type { Metadata } from "next";
import { dictionary } from "../../dictionaries";
import { SchedulePage } from "../../schedule/schedule-page";

// /schedule — the English §10.1 page, at the path it has always had. The body
// is shared with /zh/schedule; only the locale differs.

const t = dictionary("en");

export const metadata: Metadata = {
  title: t["schedule.title"],
  description: t["schedule.description"],
  alternates: {
    canonical: "/schedule",
    languages: { en: "/schedule", zh: "/zh/schedule" },
  },
};

export default function Page() {
  return <SchedulePage locale="en" />;
}
