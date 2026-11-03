// The §9.1 People list's filter shape, in a module of its own.
//
// It lives here rather than in `people-list.tsx` because `page.tsx` is a
// Server Component and `people-list.tsx` is `"use client"`. Every export of a
// client module crosses the serialization boundary when a server module
// imports it, so `{ ...NO_FILTERS }` on the server spread nothing and the
// list was handed filters with no `tags` — a crash as soon as it built the
// query (`f.tags is not iterable`). A plain module has no boundary to cross
// and both sides get the real object.

export type Filters = {
  stage: string;
  language: string;
  needsReview: string;
  owner: string;
  tags: string[];
  hasOpenDeal: string;
  createdFrom: string;
  createdTo: string;
};

export const NO_FILTERS: Filters = {
  stage: "",
  language: "",
  needsReview: "",
  owner: "",
  tags: [],
  hasOpenDeal: "",
  createdFrom: "",
  createdTo: "",
};
