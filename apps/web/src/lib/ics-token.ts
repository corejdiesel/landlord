import { createHash } from "node:crypto";

/**
 * Derive a calendar-feed token from an account's inbound-mail token.
 *
 * Kept distinct so the two cannot be used for each other: knowing someone's
 * Cert Inbox address must not also hand over their deadline calendar, and vice
 * versa. Both are unguessable on their own; deriving one from the other with a
 * purpose-specific prefix keeps them independent.
 */
export function icsToken(inboundToken: string): string {
  return createHash("sha256")
    .update(`ics:${sessionSecret()}:${inboundToken}`)
    .digest("hex")
    .slice(0, 32);
}

function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? "dev-only-insecure-secret-do-not-ship";
}
