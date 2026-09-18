import { env } from "../../lib/env";
import type { AdapterResult, CompaniesHouseAdapter, CompanyRecord } from "../types";

/** Companies House public API (free, key required). Mocked when no key is set. */
export class LiveCompaniesHouseAdapter implements CompaniesHouseAdapter {
  async lookup(companyNumber: string): Promise<AdapterResult<CompanyRecord>> {
    const number = companyNumber.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,8}$/.test(number)) {
      return { ok: false, error: "That does not look like a company number.", source: "live" };
    }
    try {
      const res = await fetch(`https://api.company-information.service.gov.uk/company/${number}`, {
        headers: {
          authorization: `Basic ${Buffer.from(`${env().COMPANIES_HOUSE_API_KEY}:`).toString("base64")}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404) return { ok: false, error: "No company with that number.", source: "live" };
      if (!res.ok) return { ok: false, error: `Companies House returned ${res.status}`, source: "live" };
      const body = (await res.json()) as {
        company_name?: string; company_status?: string;
        registered_office_address?: Record<string, string>;
      };
      const addr = body.registered_office_address ?? {};
      return {
        ok: true,
        source: "live",
        data: {
          company_number: number,
          company_name: body.company_name ?? "",
          company_status: body.company_status ?? "unknown",
          address: [addr["address_line_1"], addr["locality"], addr["postal_code"]].filter(Boolean).join(", "),
        },
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message, source: "live" };
    }
  }
}

export class MockCompaniesHouseAdapter implements CompaniesHouseAdapter {
  async lookup(companyNumber: string): Promise<AdapterResult<CompanyRecord>> {
    const number = companyNumber.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,8}$/.test(number)) {
      return { ok: false, error: "That does not look like a company number.", source: "mock" };
    }
    if (number.startsWith("00000")) {
      return { ok: false, error: "No company with that number.", source: "mock" };
    }
    return {
      ok: true,
      source: "mock",
      data: {
        company_number: number,
        company_name: `Example Lettings ${number.slice(-3)} Ltd`,
        company_status: "active",
        address: "1 Example Street, Birmingham, B1 1AA",
        officers: [
          { name: "A Example", role: "director" },
          { name: "B Example", role: "director" },
        ],
      },
    };
  }
}

export function companiesHouseAdapter(mode: "live" | "mock"): CompaniesHouseAdapter {
  return mode === "live" ? new LiveCompaniesHouseAdapter() : new MockCompaniesHouseAdapter();
}
