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

// Tasks a tick can't close (decided 12 Nov): each closes where its work is
// done, so the task and the record it is about stay in step. Their writers
// close them: lib/people/duplicate-review.ts on "Not a duplicate" or a merge,
// the §11.3 match screen for a payment.
export const CLOSES_ELSEWHERE: Record<string, string> = {
  review_duplicate:
    'This task closes when the duplicate is settled: open the person and choose "Not a duplicate" or merge them.',
  match_payment:
    "This task closes when the payment is matched to an enrolment on the payment match screen.",
};
