import { createHash } from "node:crypto";
import type { AdapterResult, LawWatchFetcher } from "../types";

/**
 * Law Watch source fetcher.
 *
 * Behind an adapter so tests run against recorded fixtures rather than hitting
 * GOV.UK. The normalisation step matters as much as the fetch: without stripping
 * scripts, nav chrome and whitespace, every unrelated site tweak would look like
 * a legal change and bury the admin queue in noise.
 */
export class LiveLawWatchFetcher implements LawWatchFetcher {
  async fetch(url: string): Promise<AdapterResult<{ text: string; fetched_at: string }>> {
    try {
      const res = await fetch(url, {
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": "LetSorted-LawWatch/0.1" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return { ok: false, error: `${url} returned ${res.status}`, source: "live" };
      const html = await res.text();
      return { ok: true, data: { text: normaliseHtml(html), fetched_at: new Date().toISOString() }, source: "live" };
    } catch (err) {
      return { ok: false, error: (err as Error).message, source: "live" };
    }
  }
}

/** Strip markup and chrome so a diff reflects content, not presentation. */
export function normaliseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Fixture-backed fetcher.
 *
 * Returns stable content per URL, unless a `?v=` marker is appended, which
 * yields changed content — that is how the Law Watch tests simulate a source
 * being amended without any network access.
 */
export class MockLawWatchFetcher implements LawWatchFetcher {
  constructor(private readonly fixtures: Record<string, string> = {}) {}

  async fetch(url: string): Promise<AdapterResult<{ text: string; fetched_at: string }>> {
    const override = this.fixtures[url];
    if (override !== undefined) {
      return { ok: true, data: { text: override, fetched_at: new Date().toISOString() }, source: "mock" };
    }
    const [base, version] = url.split("?v=");
    const text = [
      `Guidance page: ${base}`,
      "",
      "Landlords in England must register each let property on the database.",
      "The fee is £65 per property per year.",
      "You must keep your entry up to date within 28 days of anything changing.",
      version ? `Revision ${version}: the response period for pet requests is now confirmed.` : "",
    ].filter(Boolean).join("\n");
    return { ok: true, data: { text, fetched_at: new Date().toISOString() }, source: "mock" };
  }
}

export function lawWatchFetcher(mode: "live" | "mock"): LawWatchFetcher {
  return mode === "live" ? new LiveLawWatchFetcher() : new MockLawWatchFetcher();
}
