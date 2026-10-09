// Spec §9.12 proof storage, §14: the object store is reached through one file,
// and a missing environment fails loudly instead of reaching the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  proofKeyBelongsTo,
  proofKeyFor,
  signUpload,
  UploadConfigError,
} from "../lib/uploads/signer.ts";

// The signer only builds a client and asks for the bucket name, so a dummy
// project URL is enough — nothing here makes a request.
function withEnv(bucket: string | undefined, fn: () => Promise<void>) {
  const before = {
    bucket: process.env.PAYMENT_PROOF_BUCKET,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-test-key";
  if (bucket === undefined) delete process.env.PAYMENT_PROOF_BUCKET;
  else process.env.PAYMENT_PROOF_BUCKET = bucket;
  return fn().finally(() => {
    for (const [name, value] of [
      ["PAYMENT_PROOF_BUCKET", before.bucket],
      ["NEXT_PUBLIC_SUPABASE_URL", before.url],
      ["SUPABASE_SERVICE_ROLE_KEY", before.key],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test("no bucket name throws instead of returning a URL", () =>
  withEnv(undefined, async () => {
    await assert.rejects(
      () => signUpload("some-enrolment/some-key"),
      (err: unknown) => {
        assert.ok(
          err instanceof UploadConfigError,
          `expected UploadConfigError, got ${String(err)}`,
        );
        assert.match((err as Error).message, /PAYMENT_PROOF_BUCKET/);
        return true;
      },
    );
  }));

// design 2: the key is minted on the server and prefixed with the enrolment,
// so a key issued for one enrolment cannot be attached to another.
test("a proof key is prefixed with its enrolment", () => {
  const enrolmentId = "00000000-0000-4000-8000-000000000001";
  const other = "00000000-0000-4000-8000-000000000002";
  const key = proofKeyFor(enrolmentId);

  assert.ok(key.startsWith(`${enrolmentId}/`));
  assert.notEqual(key, proofKeyFor(enrolmentId), "each key is fresh");
  assert.equal(proofKeyBelongsTo(key, enrolmentId), true);
  assert.equal(proofKeyBelongsTo(key, other), false);
  // A prefix that only looks like the id must not pass.
  assert.equal(proofKeyBelongsTo(`${enrolmentId}x/file`, enrolmentId), false);
});

// §9.12: the provider sits behind one file. This is the test that keeps it
// there — a second caller of the storage API would make the swap to another
// provider a hunt rather than one file.
test("only lib/uploads/signer.ts touches the storage API", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry.name)) {
        const source = readFileSync(path, "utf8");
        if (/\.storage\b/.test(source)) offenders.push(path);
      }
    }
  };
  for (const dir of ["app", "lib", "components", "scripts"]) walk(dir);

  assert.deepEqual(offenders, [join("lib", "uploads", "signer.ts")]);
});
