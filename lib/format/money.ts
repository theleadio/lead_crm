// Spec §4: RM3,200.00 — never round for display before totals are computed.
export function formatMoneyMyr(amountMyr: number | string): string {
  const amount = typeof amountMyr === "string" ? Number(amountMyr) : amountMyr;
  return `RM${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
