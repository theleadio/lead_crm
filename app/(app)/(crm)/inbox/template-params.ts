// The template box's parameters: one `name=value` per line, as WATI's custom
// params. Blank lines are skipped; a line with no `=` is a name with an empty
// value. A plain module, so a test can drive it.
export function parseParams(text: string): { name: string; value: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return i < 0
        ? { name: l, value: "" }
        : { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
    });
}
