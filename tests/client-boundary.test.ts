// Every export of a `"use client"` module crosses React's serialization
// boundary when a Server Component imports it. A component survives that —
// it becomes a client reference React knows how to render. A plain value does
// not: the server gets a reference, so spreading it yields nothing and
// reading a field gives undefined.
//
// That is how `/people?filter[needsReview]=true` crashed with "f.tags is not
// iterable": `page.tsx` spread `NO_FILTERS` imported from the client module
// `people-list.tsx`, and the spread contributed no keys. The fix was to move
// the constant to a plain module; this test is what stops it coming back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const isClientModule = (source: string) =>
  /^\s*["']use client["']/.test(source);

// A component is PascalCase; anything else is a value. Types are erased
// before they reach the boundary, so `import type` is always safe.
const isComponentName = (name: string) => /^[A-Z][A-Za-z0-9]*$/.test(name);

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // keep trying the other extensions
    }
  }
  return null;
}

test("a server module imports no plain value from a client module", () => {
  const offenders: string[] = [];

  for (const file of filesIn("app")) {
    const source = readFileSync(file, "utf8");
    if (isClientModule(source)) continue; // client to client is fine

    // `import { a, b as c } from "./x"` — named imports only; a default or
    // namespace import of a client module is a component by convention.
    const imports = source.matchAll(
      /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["'](\.[^"']*)["']/g,
    );
    for (const [, typeOnly, names, spec] of imports) {
      if (typeOnly) continue;
      const target = resolveImport(file, spec);
      if (!target || !isClientModule(readFileSync(target, "utf8"))) continue;

      for (const raw of names.split(",")) {
        const name = raw
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0];
        if (!name || raw.trim().startsWith("type ")) continue;
        if (!isComponentName(name))
          offenders.push(`${file} imports "${name}" from ${spec}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a Server Component may import components from a "use client" module, but a plain value arrives as a client reference — move it to a module without the directive:\n  ${offenders.join("\n  ")}`,
  );
});

// The dictionaries and the locale helpers are read on the server and handed
// to client components as props. They must stay plain in both directions: no
// "use client" (a page spreading a client reference gets nothing, as above),
// and nothing server-only, or the whole database and the public API key would
// follow the strings into the browser bundle (§10.5).
test("the locale helpers and dictionaries are neither client nor server-only", () => {
  const shared = [
    join("app", "(public)", "locale.ts"),
    join("app", "(public)", "dictionaries.ts"),
    join("app", "(public)", "dictionaries", "en.ts"),
    join("app", "(public)", "dictionaries", "zh.ts"),
  ];

  for (const file of shared) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !isClientModule(source),
      `${file} must not be a "use client" module: a server page imports its values`,
    );
    assert.ok(
      !/^\s*["']use server["']/.test(source),
      `${file} must not be a "use server" module: a client component receives its values`,
    );
    // Comments talk about what these modules must not reach for, so the
    // checks below run on the code alone.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "");
    for (const forbidden of [
      /from\s+["'][^"']*lib\/(public|db|sql|auth)/,
      /process\.env/,
    ]) {
      assert.ok(
        !forbidden.test(code),
        `${file} matches ${forbidden} — a client component takes these strings as props, so this would pull server-only code into its bundle`,
      );
    }
  }
});

// Only the active locale's strings should reach the browser (§10.5). A client
// component that imports the dictionary drags both locales in, because the
// Chinese overlay falls back to the English file. So a client component gets
// its strings as a prop from its server parent — with one exception the
// platform forces: an error boundary is rendered on the client and is passed
// nothing, so it must read its own copy (website-localisation).
test("only an error boundary imports the dictionary into the browser", () => {
  // Only the Chinese error boundary: the platform renders an error boundary
  // on the client and passes it nothing, and the Chinese one needs the
  // English strings its fallback resolves against. The English boundary
  // imports its own locale's file directly, so it ships no Chinese.
  const ALLOWED = new Set([
    join("app", "(public)", "zh", "schedule", "error.tsx"),
  ]);
  const offenders: string[] = [];

  for (const file of filesIn(join("app", "(public)"))) {
    if (ALLOWED.has(file)) continue;
    const source = readFileSync(file, "utf8");
    if (!isClientModule(source)) continue; // a server module may read it
    // A value import only. `import type { Dict }` is erased before the
    // bundler sees it, so taking the dictionary's *type* is free — that is
    // exactly how a client component types the prop it is handed.
    if (
      /import\s+(?!type\s)[^;]*from\s+["'][^"']*dictionaries(\.ts)?["']/.test(
        source,
      )
    )
      offenders.push(file);
  }

  assert.deepEqual(
    offenders,
    [],
    `these take their strings as a prop instead — importing the dictionary ships both locales:\n  ${offenders.join("\n  ")}`,
  );
});
