// Spec §14: images and PDF only, 10MB maximum, judged by content and never by
// the name or the content type a browser declared (§9.12 proof upload).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatMegabytes,
  MAX_PROOF_BYTES,
  verifyProof,
} from "../lib/uploads/verify.ts";

const bytes = (...head: number[]) => Uint8Array.from(head);

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const WEBP = bytes(
  0x52,
  0x49,
  0x46,
  0x46,
  0x24,
  0x00,
  0x00,
  0x00,
  0x57,
  0x45,
  0x42,
  0x50,
);

test("the four accepted types pass, named by their real content type", () => {
  for (const [file, expected] of [
    [PDF, "application/pdf"],
    [JPEG, "image/jpeg"],
    [PNG, "image/png"],
    [WEBP, "image/webp"],
  ] as const) {
    assert.deepEqual(verifyProof(file), { ok: true, contentType: expected });
  }
});

test("an executable named slip.pdf is refused on its bytes", () => {
  // MZ, a Windows executable. The name and the declared type are not read at
  // all — only these bytes are (§14).
  assert.deepEqual(verifyProof(bytes(0x4d, 0x5a, 0x90, 0x00)), {
    ok: false,
    reason: "unsupported_type",
  });
});

test("RIFF that is not WebP is refused", () => {
  // RIFF....WAVE — the first four bytes match WebP's container, the type does
  // not.
  const wav = bytes(
    0x52,
    0x49,
    0x46,
    0x46,
    0x24,
    0x00,
    0x00,
    0x00,
    0x57,
    0x41,
    0x56,
    0x45,
  );
  assert.deepEqual(verifyProof(wav), {
    ok: false,
    reason: "unsupported_type",
  });
});

test("an empty file is refused", () => {
  assert.deepEqual(verifyProof(new Uint8Array(0)), {
    ok: false,
    reason: "empty",
  });
});

test("a file over 10MB is refused and reports both numbers", () => {
  const big = new Uint8Array(11 * 1024 * 1024);
  big.set(PDF); // a real PDF, so size is the only thing refusing it
  assert.deepEqual(verifyProof(big), {
    ok: false,
    reason: "too_large",
    bytes: 11 * 1024 * 1024,
    limit: MAX_PROOF_BYTES,
  });
});

test("exactly 10MB is accepted — the limit is inclusive", () => {
  const atLimit = new Uint8Array(MAX_PROOF_BYTES);
  atLimit.set(PDF);
  assert.deepEqual(verifyProof(atLimit), {
    ok: true,
    contentType: "application/pdf",
  });
});

test("a truncated signature is refused rather than read past its end", () => {
  assert.deepEqual(verifyProof(bytes(0x25, 0x50)), {
    ok: false,
    reason: "unsupported_type",
  });
});

// §13: "That file is 14MB. The limit is 10MB — try a photo instead of a scan."
test("sizes read as whole megabytes for the §13 message", () => {
  assert.equal(formatMegabytes(14 * 1024 * 1024), "14MB");
  assert.equal(formatMegabytes(MAX_PROOF_BYTES), "10MB");
});
