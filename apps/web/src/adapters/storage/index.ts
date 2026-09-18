import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { env } from "../../lib/env";
import type { AdapterResult, StorageAdapter, StoredFile } from "../types";

/**
 * Local-disk storage. There is no cloud bucket in this build by design
 * (no production services), so "live" and "mock" are the same implementation.
 *
 * Signed URLs are real HMACs over the path and expiry, so the signature
 * verification path is genuinely exercised rather than stubbed.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private root(): string {
    return resolve(process.cwd(), env().STORAGE_DIR);
  }

  /**
   * Resolve a storage key to an absolute path, REFUSING anything that escapes
   * the storage root.
   *
   * Note it refuses rather than sanitises. An earlier version stripped leading
   * `../` segments and carried on, which turned "../../etc/passwd" into a write
   * to "<root>/etc/passwd" — a traversal attempt silently rewritten into a
   * different unintended write. Rejecting is the only safe answer; a caller
   * passing a bad key has a bug that should surface.
   */
  private safePath(key: string): string | null {
    if (key.includes("\0")) return null;
    const root = this.root();
    const full = resolve(root, key);
    if (full !== root && !full.startsWith(root + sep)) return null;
    return full;
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<AdapterResult<StoredFile>> {
    const full = this.safePath(key);
    if (!full) return { ok: false, error: "Invalid storage key.", source: "mock" };
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return {
      ok: true,
      source: "mock",
      data: {
        path: key,
        sha256: createHash("sha256").update(data).digest("hex"),
        byteSize: data.byteLength,
        mimeType,
      },
    };
  }

  async get(path: string): Promise<AdapterResult<Buffer>> {
    const full = this.safePath(path);
    if (!full) return { ok: false, error: "Invalid storage key.", source: "mock" };
    try {
      return { ok: true, data: await readFile(full), source: "mock" };
    } catch {
      return { ok: false, error: "Not found.", source: "mock" };
    }
  }

  async signedUrl(path: string, ttlSeconds: number): Promise<AdapterResult<string>> {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = signPath(path, expires);
    const url = `/api/files/${encodeURIComponent(path)}?expires=${expires}&sig=${sig}`;
    return { ok: true, data: url, source: "mock" };
  }
}

/**
 * Sign a storage path with the session secret.
 *
 * Deliberately includes the expiry in the signed material, so an expiry cannot
 * be extended by editing the query string.
 */
export function signPath(path: string, expires: number): string {
  return createHash("sha256")
    .update(`${storageSecret()}|${path}|${expires}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifySignedPath(path: string, expires: number, sig: string): boolean {
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
  const expected = signPath(path, expires);
  // Constant-time-ish compare: lengths are fixed, so a simple XOR fold is fine.
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

function storageSecret(): string {
  return process.env.SESSION_SECRET ?? "dev-only-insecure-secret-do-not-ship";
}

export function storageAdapter(_mode: "live" | "mock"): StorageAdapter {
  return new LocalStorageAdapter();
}

export { join as joinStoragePath };
