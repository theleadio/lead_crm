// Spec §12.5 deal stages and the §12.6 won guard (pure rules, no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkMove,
  moveErrorMessage,
  type DealForMove,
} from "../lib/deals/stage-rules.ts";

const individual: DealForMove = {
  pipeline: "individual",
  stage: "qualified",
  companyId: null,
  headcount: null,
  fundingType: null,
  hrdcGrantRef: null,
  hrdcApprovalDate: null,
  hrdcDeadlineDate: null,
};
const corporate: DealForMove = {
  ...individual,
  pipeline: "corporate",
  stage: "discovery",
  companyId: "c1",
  headcount: 10,
  fundingType: "company",
};
const hrdc: DealForMove = {
  ...corporate,
  stage: "funding",
  fundingType: "hrdc",
  hrdcGrantRef: "G-1",
  hrdcApprovalDate: "2026-10-01",
  hrdcDeadlineDate: "2026-11-01",
};
const active = { isActive: true };

test("stage from the other pipeline, or unknown, is invalid_stage", () => {
  assert.deepEqual(checkMove(individual, "discovery", null), {
    ok: false,
    code: "invalid_stage",
  });
  assert.deepEqual(checkMove(corporate, "checkout_sent", null), {
    ok: false,
    code: "invalid_stage",
  });
  assert.deepEqual(checkMove(individual, "archived", null), {
    ok: false,
    code: "invalid_stage",
  });
});

test("lost needs an active reason", () => {
  const code = "lost_reason_required";
  assert.deepEqual(checkMove(individual, "lost", null), { ok: false, code });
  assert.deepEqual(checkMove(individual, "lost", { isActive: false }), {
    ok: false,
    code,
  });
  assert.deepEqual(checkMove(individual, "lost", active), {
    ok: true,
    noop: false,
  });
});

test("corporate: each missing field blocks proposal_sent, funding, won", () => {
  const cases: [Partial<DealForMove>, string][] = [
    [{ companyId: null }, "companyId"],
    [{ headcount: null }, "headcount"],
    [{ fundingType: null }, "fundingType"],
  ];
  for (const [patch, field] of cases)
    for (const to of ["proposal_sent", "funding", "won"])
      assert.deepEqual(
        checkMove({ ...corporate, stage: "new", ...patch }, to, null),
        { ok: false, code: "corporate_fields_missing", missing: [field] },
        `${field} → ${to}`,
      );
  assert.deepEqual(
    checkMove(
      { ...corporate, companyId: null, headcount: null, fundingType: null },
      "proposal_sent",
      null,
    ),
    {
      ok: false,
      code: "corporate_fields_missing",
      missing: ["companyId", "headcount", "fundingType"],
    },
  );
});

test("corporate: new, discovery and lost are not blocked by missing fields", () => {
  const bare = { ...corporate, companyId: null, headcount: null };
  assert.equal(checkMove(bare, "lost", active).ok, true);
  assert.equal(
    checkMove({ ...bare, stage: "new" }, "discovery", null).ok,
    true,
  );
  assert.equal(checkMove(bare, "new", null).ok, true);
});

test("HRDC: won needs grant ref, approval date and deadline date", () => {
  const cases: [Partial<DealForMove>, string][] = [
    [{ hrdcGrantRef: null }, "hrdcGrantRef"],
    [{ hrdcGrantRef: "  " }, "hrdcGrantRef"],
    [{ hrdcApprovalDate: null }, "hrdcApprovalDate"],
    [{ hrdcDeadlineDate: null }, "hrdcDeadlineDate"],
  ];
  for (const [patch, field] of cases)
    assert.deepEqual(checkMove({ ...hrdc, ...patch }, "won", null), {
      ok: false,
      code: "hrdc_fields_missing",
      missing: [field],
    });
  assert.deepEqual(checkMove(hrdc, "won", null), { ok: true, noop: false });
  // Only won is guarded; funding with no HRDC details is fine.
  assert.equal(
    checkMove(
      { ...hrdc, stage: "proposal_sent", hrdcGrantRef: null },
      "funding",
      null,
    ).ok,
    true,
  );
});

test("same stage is a no-op, even for lost with no reason", () => {
  assert.deepEqual(checkMove(individual, "qualified", null), {
    ok: true,
    noop: true,
  });
  assert.deepEqual(checkMove({ ...individual, stage: "lost" }, "lost", null), {
    ok: true,
    noop: true,
  });
});

test("reopening won or lost is allowed", () => {
  assert.equal(
    checkMove({ ...individual, stage: "lost" }, "qualified", null).ok,
    true,
  );
  assert.equal(
    checkMove({ ...individual, stage: "won" }, "new", null).ok,
    true,
  );
});

test("messages name the missing fields and the target stage", () => {
  assert.equal(
    moveErrorMessage("corporate_fields_missing", "proposal_sent", [
      "headcount",
    ]),
    "Add headcount on the deal before moving it to Proposal sent.",
  );
});
