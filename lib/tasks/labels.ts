// One name per task type (§5 `task.type`), shared by Home (§9.0) and the
// Tasks screen (§9.14) so a type reads the same everywhere.
export const TASK_TYPE_LABELS: Record<string, string> = {
  call: "Call",
  follow_up: "Follow up",
  review_duplicate: "Review duplicate",
  match_payment: "Match payment",
  hrdc_deadline: "HRDC deadline",
  export_request: "Export request",
  other: "Task",
};

// The types a person may create (design 9). The rest are raised by code:
// the duplicate check, the Stripe worker, the HRDC rule, export requests.
export const CREATABLE_TYPES = ["call", "follow_up", "other"] as const;
export type CreatableType = (typeof CREATABLE_TYPES)[number];
