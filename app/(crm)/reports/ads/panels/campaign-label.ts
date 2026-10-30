// Meta campaign names in this account are a path, not a word:
//
//   LEAD | Oct2026 | WhatsApp | AI Vibe Coding 23 Oct KL
//
// Every one of them opens with the same two or three segments, so a label cut
// to fit reads "LEAD | Oct2026 | WhatsApp ..." on every bar and identifies
// nothing. What tells them apart is the last segment.
//
// So a chart label is the tail, and the full name stays in the mark's hover
// text and in the figures table — nothing is hidden, it is just not what the
// axis shouts. A name with no separator is left exactly as it is.

const SEPARATOR = "|";

export function campaignLabel(name: string): string {
  if (!name.includes(SEPARATOR)) return name;
  const parts = name
    .split(SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean);
  const tail = parts.at(-1);
  if (!tail) return name;
  // A tail that is itself a qualifier ("HRDC", "Self-Funded", "V2") says
  // nothing on its own, so it keeps the segment before it.
  const qualifier = /^(hrdc|self[- ]funded|v\d+|details targeting)$/i;
  const penultimate = parts.at(-2);
  const base =
    qualifier.test(tail) && penultimate ? `${penultimate} ${tail}` : tail;

  // One class is usually advertised by two campaigns at once — a sales one
  // and a click-to-WhatsApp one — and their names differ only in that
  // segment. Dropping it makes two different campaigns read as one point
  // labelled twice, so the objective is kept when the name carries one.
  // Middle segments only: every name in this account opens with the
  // brand ("LEAD"), which matches `leads?` and would be appended to all
  // of them, and the tail is the class itself.
  const objective = parts
    .slice(1, -1)
    .find((part) =>
      /^(sales|whatsapp|leads?|impression|traffic|conversion|engagement|awareness)$/i.test(
        part,
      ),
    );
  return objective && !base.toLowerCase().includes(objective.toLowerCase())
    ? `${base} · ${objective}`
    : base;
}
