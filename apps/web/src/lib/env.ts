import { z } from "zod";

/**
 * Environment handling.
 *
 * The rule the whole app depends on: a missing key is never an error. It selects
 * the mock adapter instead, and the UI says so in a dev banner. That is what
 * makes `pnpm demo` work with nothing configured, and it means a feature can
 * never quietly depend on a key being present.
 */

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted"),
  APP_URL: z.string().default("http://localhost:3000"),

  // Every one of these is optional. Absent => mock adapter.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_FAST: z.string().default("claude-haiku-4-5-20251001"),
  ANTHROPIC_MODEL_REASONING: z.string().default("claude-sonnet-5"),
  POSTCODES_IO_URL: z.string().default("https://api.postcodes.io"),
  EPC_API_KEY: z.string().optional(),
  EPC_API_URL: z.string().default("https://epc.opendatacommunities.org/api/v1"),
  COMPANIES_HOUSE_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  INBOUND_EMAIL_DOMAIN: z.string().default("certs.letsorted.test"),
  STORAGE_DIR: z.string().default(".storage"),
  MAIL_DIR: z.string().default(".mail"),

  /** Dev-only: pins "today" so deadline behaviour can be demonstrated. */
  TIME_TRAVEL_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Allows the network-using adapters to be forced off even with keys present. */
  FORCE_MOCKS: z.enum(["0", "1"]).default("0"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      // Only genuinely malformed values reach here, since everything optional
      // has a default. Fail loudly rather than booting half-configured.
      throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Reset the cache. Tests only. */
export function resetEnvCache(): void {
  cached = null;
}

export type AdapterName =
  | "postcodes" | "epc" | "companiesHouse" | "llm"
  | "email" | "inboundEmail" | "payments" | "lawWatchFetcher" | "storage";

/**
 * Which adapters are running against a mock, and why.
 *
 * Surfaced in the dev banner and written to BUILD_LOG.md, so it is always
 * visible what is real and what is simulated.
 */
export function adapterModes(e: Env = env()): Record<AdapterName, "live" | "mock"> {
  const forced = e.FORCE_MOCKS === "1";
  const pick = (hasKey: boolean) => (forced || !hasKey ? "mock" : "live") as "live" | "mock";
  return {
    // postcodes.io needs no key, so it is live unless mocks are forced.
    postcodes: pick(true),
    epc: pick(Boolean(e.EPC_API_KEY)),
    companiesHouse: pick(Boolean(e.COMPANIES_HOUSE_API_KEY)),
    llm: pick(Boolean(e.ANTHROPIC_API_KEY)),
    email: pick(Boolean(e.SMTP_URL)),
    // Inbound email always runs locally in this build: there is no real MX.
    inboundEmail: "mock",
    payments: pick(Boolean(e.STRIPE_SECRET_KEY)),
    lawWatchFetcher: pick(true),
    storage: "mock",
  };
}

export function mockedAdapters(e: Env = env()): AdapterName[] {
  return (Object.entries(adapterModes(e)) as [AdapterName, "live" | "mock"][])
    .filter(([, mode]) => mode === "mock")
    .map(([name]) => name);
}

/**
 * Today's date, as the app should see it.
 *
 * Honours TIME_TRAVEL_DATE outside production, because a product about deadlines
 * is impossible to demo or test without being able to move the date.
 */
export function today(e: Env = env()): string {
  if (e.TIME_TRAVEL_DATE && e.NODE_ENV !== "production") return e.TIME_TRAVEL_DATE;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date());
}
