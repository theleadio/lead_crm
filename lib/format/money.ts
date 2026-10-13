// Adds numeric(12,2) strings the database already summed per group, in
// integer cents. Floats would turn 0.1 + 0.2 into 0.30000000000000004 on a
// screen that reports money (§12.7), so nothing here goes through Number().
export function sumMyr(amounts: string[]): string {
  let cents = 0;
  for (const amount of amounts) {
    const [whole, fraction = ""] = amount.trim().split(".");
    const sign = whole.startsWith("-") ? -1 : 1;
    const digits = whole.replace("-", "") + fraction.padEnd(2, "0").slice(0, 2);
    // Whole cents stay exact in a double far past any MYR total we can hold
    // in numeric(12,2); the decimals are what would have drifted.
    cents += sign * Number(digits || "0");
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents).toString().padStart(3, "0");
  return `${sign}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

// Whether two numeric(12,2) strings are the same amount, so "3200", "3200.00"
// and " 3200.0 " all read as equal. Compared in whole cents rather than
// through Number(), for the §12.7 reason above. Either side missing is not a
// comparison, so it is never "different" — the §9.12 mismatch note stays
// silent when an enrolment has no stored price.
export function sameMoney(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a?.trim() || !b?.trim()) return true;
  return sumMyr([a]) === sumMyr([b]);
}

// Spec §4: RM3,200.00 — never round for display before totals are computed.
export function formatMoneyMyr(amountMyr: number | string): string {
  const amount = typeof amountMyr === "string" ? Number(amountMyr) : amountMyr;
  return `RM${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
