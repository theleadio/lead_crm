"use client";

import { dictionary } from "../../dictionaries";
import { ScheduleErrorBody } from "../../schedule/error-body";

// §13's error state for /zh/schedule. This one does go through dictionary(),
// so an untranslated key still renders English rather than a blank — which
// means this page's bundle holds the English strings its fallback resolves
// against. That is the one exception website-localisation allows, and it is
// why the English route file above does not use dictionary().
const t = dictionary("zh");

export default function ScheduleError({ retry }: { retry: () => void }) {
  return <ScheduleErrorBody t={t} retry={retry} />;
}
