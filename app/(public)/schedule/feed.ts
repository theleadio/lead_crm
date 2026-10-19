import { unstable_cache } from "next/cache";
import { readSchedule } from "@/lib/public/schedule";

// §8.1's five minutes, moved to our side of the HTTP boundary: the page reads
// the feed in process, so there is no `fetch` for Next to cache. The tag is
// what O38's revalidateTag("public-schedule") purges when a class is edited.
// 100 is §14's cap, and the page wants every class the feed will give.
//
// A failed read throws rather than returning an empty schedule: Next then keeps
// serving the last good page, and error.tsx covers the cold case (§13).
export const getSchedule = unstable_cache(
  () => readSchedule(process.env, { limit: 100 }),
  ["public-schedule"],
  { revalidate: 300, tags: ["public-schedule"] },
);
