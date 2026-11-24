// Why do signups have no source, and (with --apply) fix the one cause that is
// provably a dating problem. Dry run by default: read-only, prints counts and
// person ids only (no names, emails or phone numbers).
//
//   node --env-file=.env.local scripts/backfill-signup-source.ts --from 2026-11-09 --to 2026-11-15
//   node --env-file=.env.local scripts/backfill-signup-source.ts --from ... --to ... --apply
//
// A signup here is the first paid-for seat per person and class, dated by
// enrolment.created_at, as the Weekly tab does for CRM seats (orders and the
// sheet's own rows are not counted here).
//
// --apply copies a participant-sheet "self:<source>" touch that is dated after
// the signup to one second before it. The sheet's Source column says how the
// person came, whenever Ops typed it in; the Weekly tab only reads touches from
// before the signup, so a late-typed source never counted. The new row has
// external_ref "backfill:<original touchpoint id>", so a re-run adds nothing.
// Touchpoints are append-only: nothing existing is changed.
import postgres from "postgres";
import {
  noSourceReason,
  REASON_TEXT,
  type NoSourceReason,
} from "../lib/attribution/no-source.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const from = arg("from");
const to = arg("to");
const apply = process.argv.includes("--apply");
if (
  !from ||
  !to ||
  !/^\d{4}-\d\d-\d\d$/.test(from + "") ||
  !/^\d{4}-\d\d-\d\d$/.test(to + "")
) {
  console.error("usage: --from YYYY-MM-DD --to YYYY-MM-DD [--apply]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const INFORMATIVE = `(t.channel NOT IN ('import', 'payment_link')
  OR t.utm_source IS NOT NULL OR t.utm_campaign IS NOT NULL
  OR t.fbclid IS NOT NULL OR t.ctwa_clid IS NOT NULL OR t.gclid IS NOT NULL)`;

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const body = async (tx: postgres.TransactionSql) => {
    const rows = await tx<
      {
        person_id: string;
        at: Date;
        touches: number;
        before: number;
        after: number;
        sheet_after: string | null;
      }[]
    >`
      WITH s AS (
        SELECT DISTINCT ON (e.person_id, e.class_id)
               e.person_id, e.created_at AS at
        FROM enrolment e JOIN person p ON p.id = e.person_id
        WHERE e.status IN ('confirmed', 'onboarded', 'attended', 'completed')
          AND p.deleted_at IS NULL AND p.merged_into_id IS NULL
          AND e.created_at >= (${from!}::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
          AND e.created_at < ((${to!}::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
        ORDER BY e.person_id, e.class_id, e.created_at
      )
      SELECT s.person_id, s.at,
             (SELECT count(*)::int FROM touchpoint t
               WHERE t.person_id = s.person_id) AS touches,
             (SELECT count(*)::int FROM touchpoint t
               WHERE t.person_id = s.person_id AND t.occurred_at <= s.at
                 AND ${sql.unsafe(INFORMATIVE)}) AS before,
             (SELECT count(*)::int FROM touchpoint t
               WHERE t.person_id = s.person_id AND t.occurred_at > s.at
                 AND ${sql.unsafe(INFORMATIVE)}) AS after,
             (SELECT t.id::text FROM touchpoint t
               WHERE t.person_id = s.person_id AND t.occurred_at > s.at
                 AND t.form_name = 'participant-sheet'
                 AND t.utm_source LIKE 'self:%'
               ORDER BY t.occurred_at LIMIT 1) AS sheet_after
      FROM s`;

    const counts = new Map<NoSourceReason, number>();
    const toFix: { id: string; at: Date }[] = [];
    for (const r of rows) {
      const reason = noSourceReason({
        touches: r.touches,
        informativeBefore: r.before,
        informativeAfter: r.after,
        sheetSourceAfter: r.sheet_after !== null,
      });
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
      if (reason === "sheet_source_dated_late" && r.sheet_after)
        toFix.push({ id: r.sheet_after, at: r.at });
    }

    console.log(`signups ${from} to ${to}: ${rows.length}`);
    for (const [reason, n] of [...counts].sort((a, b) => b[1] - a[1]))
      console.log(`  ${n}\t${reason}\t${REASON_TEXT[reason]}`);

    // Earliest signup first: a person with two signups shares one sheet touch,
    // and its copy must be dated before both.
    toFix.sort((x, y) => x.at.getTime() - y.at.getTime());
    let added = 0;
    for (const f of toFix) {
      if (!apply) continue;
      const done = await tx`
        INSERT INTO touchpoint (person_id, channel, occurred_at, utm_source,
                                form_name, is_first_touch, external_ref)
        SELECT person_id, 'import', ${f.at}::timestamptz - interval '1 second',
               utm_source, form_name, false, ${`backfill:${f.id}`}
        FROM touchpoint WHERE id = ${f.id}
        ON CONFLICT DO NOTHING RETURNING id`;
      added += done.length;
    }
    console.log(
      apply
        ? `applied: ${added} touchpoints added`
        : `dry run: ${toFix.length} touchpoints would be added; nothing written (use --apply)`,
    );
  };
  await (apply ? sql.begin(body) : sql.begin("read only", body));
} finally {
  await sql.end();
}
