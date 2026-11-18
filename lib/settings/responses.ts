import { apiError } from "../api/errors.ts";
import type { LostReasonWriteResult } from "./lost-reasons.ts";
import type { TagMergeResult, TagWriteResult } from "./tags.ts";

// One §13 answer per Settings service result. Kept out of the route files so
// they can be tested without a session (as lib/tasks/responses.ts).

export function lostReasonWriteResponse(
  result: LostReasonWriteResult,
  okStatus: 200 | 201 = 200,
): Response {
  switch (result.kind) {
    case "ok":
      return Response.json(result.reason, { status: okStatus });
    case "not_found":
      return apiError(404, "not_found", "This lost reason doesn't exist.");
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this reason while you were looking. Reload to see their version.",
      );
    case "duplicate_code":
      return apiError(409, "duplicate_code", "That code is already in use.", {
        fields: { code: "That code is already in use. Pick another." },
      });
  }
}

export function lostReasonReorderResponse(
  result: { kind: "ok" } | { kind: "incomplete" },
): Response {
  return result.kind === "ok"
    ? new Response(null, { status: 204 })
    : apiError(
        422,
        "incomplete",
        "The list of reasons has changed since you opened it. Reload and try again.",
      );
}

const SYSTEM_TAG = () =>
  apiError(
    422,
    "system_tag",
    "This tag comes from an import and can't be changed.",
  );

export function tagWriteResponse(result: TagWriteResult): Response {
  switch (result.kind) {
    case "ok":
      return Response.json(result.tag);
    case "not_found":
      return apiError(404, "not_found", "This tag doesn't exist.");
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this tag while you were looking. Reload to see their version.",
      );
    case "system_tag":
      return SYSTEM_TAG();
    case "duplicate_name":
      return Response.json(
        {
          error: {
            code: "duplicate_name",
            message: `A tag called "${result.existing.name}" already exists.`,
            fields: { name: "Another tag already has this name." },
            existingTag: result.existing,
          },
        },
        { status: 409 },
      );
  }
}

export function tagMergeResponse(result: TagMergeResult): Response {
  switch (result.kind) {
    case "ok":
      return Response.json({ moved: result.moved });
    case "not_found":
      return apiError(404, "not_found", "This tag doesn't exist.");
    case "system_tag":
      return SYSTEM_TAG();
    case "bad_target":
      return apiError(
        422,
        "bad_target",
        "Pick another active tag to merge into.",
        { fields: { intoTagId: "Pick another active tag" } },
      );
  }
}
