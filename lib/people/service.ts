import { MOCK_PEOPLE } from "./mock-data.ts";
import { matchesPersonQuery } from "./search.ts";
import type { ListResponse, PeopleListQuery, PersonListItem } from "./types.ts";

// Service layer (spec §3 layering rule): the only place that touches data.
// Currently reads mock data; swap to Shawn's generated client when it lands —
// API routes and screens don't change.
export async function listPeople(
  query: PeopleListQuery,
): Promise<ListResponse<PersonListItem>> {
  const filtered = MOCK_PEOPLE.filter(
    (p) =>
      (!query.q || matchesPersonQuery(p, query.q)) &&
      (!query.stage || p.stage === query.stage) &&
      (!query.language || p.preferredLanguage === query.language) &&
      (query.needsReview === undefined || p.needsReview === query.needsReview),
  );

  const start = (query.page - 1) * query.limit;
  return {
    data: filtered.slice(start, start + query.limit),
    page: { total: filtered.length, page: query.page, limit: query.limit },
  };
}
