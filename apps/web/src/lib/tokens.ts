import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Tokenised links.
 *
 * Every public link in this product — pulse check-in, tenant passport,
 * attestation, co-owner invite — follows the same rules:
 *
 *  - long enough not to be enumerable (32 bytes of randomness)
 *  - stored as a SHA-256 hash, never in plaintext, so a database leak does not
 *    hand over live links
 *  - single purpose: a token for one thing is useless for another
 *  - expiring, and revocable
 *
 * The raw token exists in the URL and nowhere else.
 */

export type TokenPurpose = "pulse" | "passport" | "attestation" | "co_owner_invite";

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash a token for storage, bound to its purpose.
 *
 * The purpose is part of the hashed material, so a pulse token cannot be
 * replayed as an attestation token even if both hashes were somehow obtained.
 */
export function hashToken(token: string, purpose: TokenPurpose): string {
  return createHash("sha256").update(`${purpose}:${token}`).digest("hex");
}

export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * A passport slug.
 *
 * Shorter than a token because it appears in a QR code a tenant might type, but
 * still 22 characters of base64url — about 132 bits. Enumeration is not
 * feasible, and the page is rate-limited on top of that.
 */
export function newPassportSlug(): string {
  return randomBytes(16).toString("base64url");
}
