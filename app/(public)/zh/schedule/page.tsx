import type { Metadata } from "next";
import { alternates } from "../../alternates";
import { dictionary } from "../../dictionaries";
import { SchedulePage } from "../../schedule/schedule-page";

// /zh/schedule — the same §10.1 page in Chinese. Same feed read, same
// classes, Chinese words and Chinese links.

const t = dictionary("zh");

export const metadata: Metadata = {
  title: t["schedule.title"],
  description: t["schedule.description"],
  // Each locale names itself canonical and points at the other, so a crawler
  // serves a Chinese searcher this page and does not read the pair as
  // duplicates (website-localisation).
  alternates: alternates("zh", "/schedule"),
};

// Reads the database per request (cached five minutes in feed.ts), never at
// build: a deploy with no database credentials, such as a Netlify preview,
// must still build.
export const dynamic = "force-dynamic";

export default function Page() {
  return <SchedulePage locale="zh" />;
}
