"use client";

import { en } from "../../dictionaries/en";
import { ScheduleErrorBody } from "../../schedule/error-body";

// §13's error state for /schedule. The English strings are imported straight
// from their own file rather than through dictionary(), which would pull the
// Chinese overlay in with them: English is the fallback, so it needs no
// overlay of its own, and this page then ships no Chinese.
export default function ScheduleError({ retry }: { retry: () => void }) {
  return <ScheduleErrorBody t={en} retry={retry} />;
}
