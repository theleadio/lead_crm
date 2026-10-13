// Spec §9.12 Part payments: confirming only once succeeded payments reach
// `price_paid_myr` is O16, pending Finance, and the check belongs in the
// database because the Stripe webhook must obey it too (§3). This test is the
// boundary: if that rule ever grows into `/lib`, it fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Line and block comments go first — the service explains the rule in prose,
// and prose is not code.
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("the payment service totals nothing against the price", () => {
  for (const file of filesIn(join("lib", "payments"))) {
    const source = code(readFileSync(file, "utf8"));
    for (const forbidden of [
      /price_paid_myr/,
      /pricePaidMyr/,
      /\bsum\s*\(/i,
      /outstanding/i,
      /\bbalance\b/i,
    ]) {
      assert.equal(
        forbidden.test(source),
        false,
        `${file} must not reach for ${forbidden} — that rule is O16 and lives in the database (§9.12)`,
      );
    }
  }
});
