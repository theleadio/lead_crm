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
  if (!objective || base.toLowerCase().includes(objective.toLowerCase()))
    return base;
  // One spelling on screen: the names are retyped per campaign ("Whatsapp",
  // "WhatsApp"), and two spellings side by side read as two things.
  const lower = objective.toLowerCase();
  const spelled =
    lower === "whatsapp"
      ? "WhatsApp"
      : lower === "lead" || lower === "leads"
        ? "Leads"
        : lower[0].toUpperCase() + lower.slice(1);
  return `${base} · ${spelled}`;
}

// The month segment Meta names carry ("Oct2026", "July2026"): what usually tells a rerun
// from the original when both end on the same class.
const MONTH = /^([a-z]{3,9})(\d{4})$/i;

// One label per campaign id across the whole screen, so a campaign reads the
// same in every panel and two campaigns never read as one (browser check,
// 11 Nov: two "Claude ..." bars at 6.9× and 0.6×). Labels clash ignoring
// case, since Meta names are retyped ("Ai" against "AI"). In a clash, a
// campaign whose month no other in the clash shares gets the month; the rest
// get the id's last four digits, the only part left that differs. A month
// every one of them shares would only make the label longer.
export function campaignLabels(
  nameById: Map<string, string>,
): Map<string, string> {
  const plain = new Map(
    [...nameById].map(([id, name]) => [id, campaignLabel(name)]),
  );
  const groups = new Map<string, string[]>();
  for (const [id, label] of plain) {
    const key = label.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const monthOf = (id: string) =>
    nameById
      .get(id)!
      .split(SEPARATOR)
      .map((p) => p.trim().match(MONTH))
      .find(Boolean);

  const out = new Map<string, string>();
  for (const ids of groups.values()) {
    if (ids.length === 1) {
      out.set(ids[0], plain.get(ids[0])!);
      continue;
    }
    const months = ids.map((id) => monthOf(id)?.[0].toLowerCase());
    ids.forEach((id, i) => {
      const m = monthOf(id);
      const unique = m && months.filter((x) => x === months[i]).length === 1;
      out.set(
        id,
        unique
          ? `${plain.get(id)} · ${m[1]} ${m[2]}`
          : `${plain.get(id)} · …${id.slice(-4)}`,
      );
    });
  }
  return out;
}
