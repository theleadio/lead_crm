// Spec §6 footnote ¹: marketing sees 012-•••• 6789 and s••••@gmail.com.
// Applied server-side — real values never reach that browser.

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("60") ? `0${digits.slice(2)}` : digits;
  if (national.length < 7) return "••••";
  return `${national.slice(0, 3)}-•••• ${national.slice(-4)}`;
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 1) return "••••";
  return `${email[0]}••••${email.slice(at)}`;
}
