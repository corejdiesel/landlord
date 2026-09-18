import type { Itl1Region } from "@letsorted/rules";

/**
 * Adapter interfaces.
 *
 * Every adapter has a `live` and a `mock` implementation behind one interface,
 * chosen by env. Mocks are deterministic and fixture-backed so the whole product
 * demos with zero keys, and so tests never touch the network.
 */

export type AdapterResult<T> =
  | { ok: true; data: T; source: "live" | "mock" }
  | { ok: false; error: string; source: "live" | "mock" };

export type PostcodeLookup = {
  postcode: string;
  region: Itl1Region;
  /** True when we could not pin the region precisely. */
  approximate: boolean;
  country: string;
  admin_district?: string;
};

export interface PostcodesAdapter {
  lookup(postcode: string): Promise<AdapterResult<PostcodeLookup>>;
}

export type EpcRecord = {
  address: string;
  postcode: string;
  current_rating: string;
  lodgement_date: string;
  expires_on: string;
  certificate_number: string;
};

export interface EpcAdapter {
  findByPostcode(postcode: string): Promise<AdapterResult<EpcRecord[]>>;
}

export type CompanyRecord = {
  company_number: string;
  company_name: string;
  company_status: string;
  address: string;
  officers?: { name: string; role: string }[];
};

export interface CompaniesHouseAdapter {
  lookup(companyNumber: string): Promise<AdapterResult<CompanyRecord>>;
}

/** Per-field confidence, 0..1. The confirm UI highlights anything low. */
export type FieldConfidence = Record<string, number>;

export type DocumentExtraction = {
  kind: "gas_safety_record" | "eicr" | "eic" | "epc" | "licence" | "deposit_certificate" | "tenancy_agreement" | "other";
  property_address: string | null;
  issued_on: string | null;
  expires_on: string | null;
  engineer_id: string | null;
  outcome: "satisfactory" | "unsatisfactory" | "not_applicable" | "unknown";
  /** EICR observation codes found, e.g. C1, C2, FI. */
  observation_codes: string[];
  epc_rating: string | null;
  confidence: FieldConfidence;
};

export interface LlmAdapter {
  /** Classify and extract a compliance document. Returns nulls, never guesses. */
  extractDocument(input: {
    filename: string;
    mimeType: string;
    content: Buffer | string;
  }): Promise<AdapterResult<DocumentExtraction>>;

  /** Plain-English summary of a change to a watched legal source. */
  summariseLawChange(input: {
    sourceLabel: string;
    diff: string;
    knownRuleIds: string[];
  }): Promise<AdapterResult<{ summary: string; affected_rule_ids: string[] }>>;

  /** Grounded answer over the rule corpus and the user's own data. */
  answerQuestion(input: {
    question: string;
    context: string;
  }): Promise<AdapterResult<{ answer: string; cited_rule_ids: string[]; refused: boolean }>>;
}

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface EmailAdapter {
  send(message: OutboundEmail): Promise<AdapterResult<{ id: string }>>;
  /** Everything "sent" in this build, for the dev mail catcher UI. */
  sent(): Promise<OutboundEmail[]>;
}

export type StoredFile = {
  path: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
};

export interface StorageAdapter {
  put(key: string, data: Buffer, mimeType: string): Promise<AdapterResult<StoredFile>>;
  get(path: string): Promise<AdapterResult<Buffer>>;
  signedUrl(path: string, ttlSeconds: number): Promise<AdapterResult<string>>;
}

export interface LawWatchFetcher {
  fetch(url: string): Promise<AdapterResult<{ text: string; fetched_at: string }>>;
}

export type PlanId = "free" | "landlord" | "portfolio" | "agent";

export interface PaymentsAdapter {
  createCheckout(input: { accountId: string; plan: PlanId }): Promise<AdapterResult<{ url: string }>>;
  status(accountId: string): Promise<AdapterResult<{ plan: PlanId; status: string }>>;
}
