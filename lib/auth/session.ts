// The CRM's own session. AI365 only says who someone is; after that the CRM
// keeps them signed in with this cookie: "<payload>.<signature>", where the
// payload is base64url JSON { uid, iat, exp } (seconds) and the signature is
// HMAC-SHA256 of the payload with SESSION_SECRET. Web Crypto and web Response
// only, so the proxy can use it and plain Node tests can import it.

export const SESSION_COOKIE = "crm_session";
// Fixed 12 hours, never extended: signing out of AI365 elsewhere does not end
// a CRM session, so this expiry is what does.
export const SESSION_TTL = 12 * 60 * 60;

export type Session = { uid: string; iat: number; exp: number };

const enc = new TextEncoder();

// Fails closed: no secret, or one shorter than 32 characters, means no session
// can be signed or accepted.
function hmacKey(): Promise<CryptoKey> | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const toB64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );

export async function signSession(
  uid: string,
  now = Date.now(),
): Promise<string> {
  const key = await hmacKey();
  if (!key)
    throw new Error("SESSION_SECRET is missing or shorter than 32 characters");
  const iat = Math.floor(now / 1000);
  const payload = toB64url(
    enc.encode(JSON.stringify({ uid, iat, exp: iat + SESSION_TTL })),
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${toB64url(new Uint8Array(sig))}`;
}

export async function verifySession(
  token: string | null | undefined,
  now = Date.now(),
): Promise<Session | null> {
  const key = await hmacKey();
  const [payload, sig, extra] = token?.split(".") ?? [];
  if (!key || !payload || !sig || extra !== undefined) return null;
  try {
    // subtle.verify recomputes the HMAC and compares it in constant time.
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      fromB64url(sig),
      enc.encode(payload),
    );
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return typeof s?.uid === "string" &&
      Number.isInteger(s.iat) &&
      Number.isInteger(s.exp) &&
      s.exp > now / 1000
      ? { uid: s.uid, iat: s.iat, exp: s.exp }
      : null;
  } catch {
    return null; // bad base64 or JSON
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name)
      return part.slice(i + 1).trim();
  }
}

// One Set-Cookie value. Always HttpOnly and SameSite=Lax (Strict would drop
// the cookie when AI365 redirects back); Secure except on http://localhost in
// development. maxAge 0 clears the cookie.
export function cookieHeader(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
  path = "/",
): string {
  const url = new URL(request.url);
  const localHttp =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    url.hostname === "localhost";
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${localHttp ? "" : "; Secure"}`;
}

// A redirect that also sets cookies (Response.redirect's headers are frozen).
export function redirectWith(
  location: string | URL,
  setCookies: string[],
  status = 302,
): Response {
  const headers = new Headers({
    location: String(location),
    "cache-control": "no-store",
  });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(null, { status, headers });
}
