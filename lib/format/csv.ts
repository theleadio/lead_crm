// Cells starting with = + - @ can run as formulas when opened in Excel.
// Neutralise them, except plain phone numbers like "+60 12-345 6789".
function neutralise(value: string): string {
  const risky =
    /^[=@\t\r]/.test(value) ||
    (/^[+-]/.test(value) && !/^[+-][\d\s()-]+$/.test(value));
  return risky ? `'${value}` : value;
}

function cell(value: string | null | undefined): string {
  const v = neutralise(value ?? "");
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(header: string[], rows: (string | null)[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
