import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { withoutAccount, type AccountContext } from "./db";

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

/**
 * Session auth.
 *
 * Hand-rolled because Supabase Auth is not available here (see DECISIONS D1).
 * Kept deliberately small and boring:
 *  - the session token exists in the cookie and nowhere else; only its SHA-256
 *    reaches the database, so a database leak does not hand over live sessions
 *  - passwords use scrypt with a per-user salt
 *  - session lookup runs through a SECURITY DEFINER function, because resolving
 *    a session is what establishes the RLS context and therefore precedes it
 */

const COOKIE = "ls_session";
const SESSION_DAYS = 30;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export type Session = AccountContext & { role: "owner" | "member" | "readonly" };

/** Resolve the current request's session, or null. */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;

  return withoutAccount(async (client) => {
    const { rows } = await client.query<{
      user_id: string; account_id: string; is_admin: boolean; role: Session["role"];
    }>("select user_id, account_id, is_admin, role from app_session_context($1)", [hashToken(raw)]);
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      accountId: row.account_id,
      isAdmin: row.is_admin,
      role: row.role,
    };
  });
}

/** Resolve the session or throw. For routes that must be signed in. */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("You need to be signed in.");
    this.name = "UnauthenticatedError";
  }
}

export async function startSession(userId: string): Promise<void> {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await withoutAccount(async (client) => {
    await client.query("select app_create_session($1, $2, $3)", [userId, hashToken(token), expires]);
  });

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    await withoutAccount(async (client) => {
      await client.query("select app_destroy_session($1)", [hashToken(raw)]);
    });
  }
  jar.delete(COOKIE);
}

export type SignUpInput = {
  email: string;
  password: string;
  name: string;
  accountName: string;
  accountType: "landlord" | "agent";
};

export async function signUp(input: SignUpInput): Promise<{ accountId: string; userId: string }> {
  const passwordHash = await hashPassword(input.password);
  return withoutAccount(async (client) => {
    const { rows } = await client.query<{ account_id: string; user_id: string }>(
      "select account_id, user_id from app_signup($1, $2, $3, $4::account_type)",
      [input.email, input.name, input.accountName, input.accountType],
    );
    const row = rows[0];
    if (!row) throw new Error("Signup returned no account");
    await client.query("select app_set_password($1, $2)", [row.user_id, passwordHash]);
    return { accountId: row.account_id, userId: row.user_id };
  });
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const user = await withoutAccount(async (client) => {
    const { rows } = await client.query<{ id: string; password_hash: string | null }>(
      "select id, password_hash from app_user_for_login($1)",
      [email],
    );
    return rows[0] ?? null;
  });

  // Run the hash comparison even when no user matched, so a missing account and
  // a wrong password take about the same time.
  const ok = await verifyPassword(password, user?.password_hash ?? null);
  return ok && user ? user.id : null;
}
