import { env } from "../../lib/env";
import { parsePostcode } from "@letsorted/rules";
import type { AdapterResult, EpcAdapter, EpcRecord } from "../types";

/**
 * EPC register lookup.
 *
 * NOTE FOR JOE: the EPC open data service has been migrating platforms, and the
 * live endpoint and auth scheme need confirming before this is switched on.
 * Recorded in QUESTIONS_FOR_JOE.md. Until then this runs mocked.
 */
export class LiveEpcAdapter implements EpcAdapter {
  async findByPostcode(postcode: string): Promise<AdapterResult<EpcRecord[]>> {
    const e = env();
    const parsed = parsePostcode(postcode);
    if (!parsed) return { ok: false, error: "That does not look like a UK postcode.", source: "live" };
    try {
      const res = await fetch(
        `${e.EPC_API_URL}/domestic/search?postcode=${encodeURIComponent(parsed.normalised)}&size=25`,
        {
          headers: {
            // The service uses HTTP basic with the key as the password.
            authorization: `Basic ${Buffer.from(`${e.EPC_API_KEY}`).toString("base64")}`,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!res.ok) return { ok: false, error: `EPC service returned ${res.status}`, source: "live" };
      const body = (await res.json()) as { rows?: Record<string, string>[] };
      const rows = (body.rows ?? []).map((r) => ({
        address: r["address"] ?? "",
        postcode: r["postcode"] ?? parsed.normalised,
        current_rating: r["current-energy-rating"] ?? "",
        lodgement_date: r["lodgement-date"] ?? "",
        expires_on: r["lodgement-date"] ? addYears(r["lodgement-date"], 10) : "",
        certificate_number: r["lmk-key"] ?? "",
      }));
      return { ok: true, data: rows, source: "live" };
    } catch (err) {
      return { ok: false, error: (err as Error).message, source: "live" };
    }
  }
}

function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String((y ?? 2020) + years).padStart(4, "0")}-${String(m ?? 1).padStart(2, "0")}-${String(d ?? 1).padStart(2, "0")}`;
}

/** Deterministic fixtures keyed on postcode, so the demo is stable. */
export class MockEpcAdapter implements EpcAdapter {
  async findByPostcode(postcode: string): Promise<AdapterResult<EpcRecord[]>> {
    const parsed = parsePostcode(postcode);
    if (!parsed) return { ok: false, error: "That does not look like a UK postcode.", source: "mock" };

    let h = 0;
    for (const ch of parsed.normalised) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const ratings = ["B", "C", "C", "D", "D", "E"];
    const rows: EpcRecord[] = [1, 2].map((n) => {
      const rating = ratings[(h + n) % ratings.length]!;
      const year = 2017 + ((h + n) % 8);
      return {
        address: `${n === 1 ? "12" : "14"} Example Road`,
        postcode: parsed.normalised,
        current_rating: rating,
        lodgement_date: `${year}-0${((h + n) % 9) + 1}-15`,
        expires_on: `${year + 10}-0${((h + n) % 9) + 1}-15`,
        certificate_number: `MOCK-${h % 100000}-${n}`,
      };
    });
    return { ok: true, data: rows, source: "mock" };
  }
}

export function epcAdapter(mode: "live" | "mock"): EpcAdapter {
  return mode === "live" ? new LiveEpcAdapter() : new MockEpcAdapter();
}
