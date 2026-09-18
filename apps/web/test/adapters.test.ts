import { beforeEach, describe, expect, it } from "vitest";
import { MockPostcodesAdapter, regionFromName } from "../src/adapters/postcodes/index";
import { MockLlmAdapter } from "../src/adapters/llm/index";
import { MockEpcAdapter } from "../src/adapters/epc/index";
import { MockCompaniesHouseAdapter } from "../src/adapters/companies-house/index";
import { MockLawWatchFetcher, contentHash, normaliseHtml } from "../src/adapters/law-watch/index";
import { LocalStorageAdapter, signPath, verifySignedPath } from "../src/adapters/storage/index";
import { adapterModes, mockedAdapters, resetEnvCache, today, type Env } from "../src/lib/env";
import { MAX_POSTCODES, isItl1Region, splitPostcodes } from "../src/app/radar-helpers";
import { formatPennies } from "../src/components/ui";

function baseEnv(): Env {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://x", APP_URL: "http://localhost:3000",
    ANTHROPIC_MODEL_FAST: "claude-haiku-4-5-20251001",
    ANTHROPIC_MODEL_REASONING: "claude-sonnet-5",
    POSTCODES_IO_URL: "https://api.postcodes.io",
    EPC_API_URL: "https://epc.test", INBOUND_EMAIL_DOMAIN: "certs.test",
    STORAGE_DIR: ".storage", MAIL_DIR: ".mail", FORCE_MOCKS: "0",
    ALLOW_TIME_TRAVEL: "0",
  };
}

describe("environment and adapter selection", () => {
  beforeEach(() => resetEnvCache());

  it("falls back to mocks when no keys are set", () => {
    const modes = adapterModes(baseEnv());
    expect(modes.llm).toBe("mock");
    expect(modes.epc).toBe("mock");
    expect(modes.companiesHouse).toBe("mock");
    expect(modes.payments).toBe("mock");
    expect(modes.email).toBe("mock");
  });

  it("goes live for a service once its key is present", () => {
    expect(adapterModes({ ...baseEnv(), ANTHROPIC_API_KEY: "sk-test" }).llm).toBe("live");
  });

  it("keeps postcodes live without a key, because postcodes.io needs none", () => {
    expect(adapterModes(baseEnv()).postcodes).toBe("live");
  });

  it("forces everything to mock when asked, even with keys present", () => {
    const modes = adapterModes({ ...baseEnv(), ANTHROPIC_API_KEY: "sk-test", FORCE_MOCKS: "1" });
    expect(modes.llm).toBe("mock");
    expect(modes.postcodes).toBe("mock");
  });

  it("lists what is mocked, so the banner and the build log can be honest", () => {
    expect(mockedAdapters({ ...baseEnv(), FORCE_MOCKS: "1" }).length).toBeGreaterThan(5);
  });

  it("honours time travel outside production", () => {
    expect(today({ ...baseEnv(), TIME_TRAVEL_DATE: "2027-03-14" })).toBe("2027-03-14");
  });

  it("ignores time travel in production unless explicitly allowed", () => {
    const value = today({ ...baseEnv(), NODE_ENV: "production", TIME_TRAVEL_DATE: "2027-03-14" });
    expect(value).not.toBe("2027-03-14");
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("allows time travel in a production build when opted in, which is how demos run", () => {
    // A demo build runs NODE_ENV=production. Without this opt-in the date
    // silently reverts to real today and every countdown in the demo is wrong.
    const value = today({
      ...baseEnv(), NODE_ENV: "production",
      TIME_TRAVEL_DATE: "2027-03-14", ALLOW_TIME_TRAVEL: "1",
    });
    expect(value).toBe("2027-03-14");
  });
});

describe("postcode region names", () => {
  it.each([
    ["London", "london"],
    ["West Midlands", "west_midlands"],
    ["Yorkshire and The Humber", "yorkshire_and_the_humber"],
    ["North East (England)", "north_east"],
    ["Eastern", "east_of_england"],
  ])("maps %s", (name, expected) => {
    expect(regionFromName(name)).toBe(expected);
  });

  it("returns null for a non-English region rather than guessing", () => {
    expect(regionFromName("Wales")).toBeNull();
    expect(regionFromName(null)).toBeNull();
  });
});

describe("mock postcodes adapter", () => {
  const adapter = new MockPostcodesAdapter();

  it("resolves an English postcode and flags it as approximate", async () => {
    const res = await adapter.lookup("b1 1aa");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.region).toBe("west_midlands");
      expect(res.data.postcode).toBe("B1 1AA");
      expect(res.data.approximate).toBe(true);
    }
  });

  it("refuses a Welsh postcode with a clear reason", async () => {
    const res = await adapter.lookup("CF10 1AA");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Wales/);
  });

  it("refuses nonsense without throwing", async () => {
    expect((await adapter.lookup("nonsense")).ok).toBe(false);
  });
});

describe("mock document extraction", () => {
  const llm = new MockLlmAdapter();

  it("classifies a gas safety record and dates it a year out", async () => {
    const res = await llm.extractDocument({
      filename: "gas-safety-record.pdf", mimeType: "application/pdf",
      content: "Landlord Gas Safety Record\nInspection date 01/06/2026\n12 Acacia Road",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.kind).toBe("gas_safety_record");
      expect(res.data.issued_on).toBe("2026-06-01");
      expect(res.data.expires_on).toBe("2027-06-01");
    }
  });

  it("marks an EICR with a C2 code as unsatisfactory", async () => {
    const res = await llm.extractDocument({
      filename: "eicr.pdf", mimeType: "application/pdf",
      content: "Electrical Installation Condition Report\n01/09/2026\nObservation C2 noted",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.kind).toBe("eicr");
      expect(res.data.outcome).toBe("unsatisfactory");
      expect(res.data.observation_codes).toContain("C2");
    }
  });

  it("always reports per-field confidence, including a low one to exercise the confirm screen", async () => {
    const res = await llm.extractDocument({
      filename: "gas.pdf", mimeType: "application/pdf", content: "gas 01/06/2026",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Object.keys(res.data.confidence).length).toBeGreaterThan(3);
      expect(Math.min(...Object.values(res.data.confidence))).toBeLessThan(0.6);
    }
  });

  it("is deterministic, so the demo does not change between runs", async () => {
    const a = await llm.extractDocument({ filename: "x.pdf", mimeType: "application/pdf", content: "gas" });
    const b = await llm.extractDocument({ filename: "x.pdf", mimeType: "application/pdf", content: "gas" });
    expect(a).toEqual(b);
  });

  it("refuses questions that need a solicitor", async () => {
    const res = await llm.answerQuestion({ question: "Can I evict my tenant?", context: "" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.refused).toBe(true);
  });

  it("answers an ordinary question from context without refusing", async () => {
    const res = await llm.answerQuestion({ question: "When is my gas check due?", context: "GAS-ANNUAL applies." });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.refused).toBe(false);
      expect(res.data.cited_rule_ids).toContain("GAS-ANNUAL");
    }
  });
});

describe("mock EPC and Companies House", () => {
  it("returns stable EPC rows for a postcode", async () => {
    const a = await new MockEpcAdapter().findByPostcode("B1 1AA");
    const b = await new MockEpcAdapter().findByPostcode("B1 1AA");
    expect(a).toEqual(b);
    if (a.ok) expect(a.data.length).toBeGreaterThan(0);
  });

  it("looks up a company and rejects a malformed number", async () => {
    const ch = new MockCompaniesHouseAdapter();
    expect((await ch.lookup("12345678")).ok).toBe(true);
    expect((await ch.lookup("nope")).ok).toBe(false);
    expect((await ch.lookup("00000001")).ok).toBe(false);
  });
});

describe("law watch normalisation", () => {
  it("strips scripts, styles and navigation so a diff shows content, not chrome", () => {
    const html = `
      <html><head><style>a{color:red}</style></head>
      <body><nav>Home About</nav><script>track()</script>
      <h1>Register your property</h1><p>The fee is &pound;65.</p>
      <footer>Crown copyright</footer></body></html>`;
    const text = normaliseHtml(html);
    expect(text).toContain("Register your property");
    expect(text).not.toContain("track()");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("Home About");
    expect(text).not.toContain("Crown copyright");
  });

  it("hashes identical content identically and different content differently", () => {
    expect(contentHash("a")).toBe(contentHash("a"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });

  it("returns stable fixture content, and changed content for a versioned URL", async () => {
    const f = new MockLawWatchFetcher();
    const a = await f.fetch("https://example.test/guidance");
    const b = await f.fetch("https://example.test/guidance");
    const c = await f.fetch("https://example.test/guidance?v=2");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.data.text).toBe(b.data.text);
      expect(c.data.text).not.toBe(a.data.text);
    }
  });
});

describe("storage", () => {
  it("round-trips a file and reports its hash and size", async () => {
    const s = new LocalStorageAdapter();
    const data = Buffer.from("a gas safety record");
    const put = await s.put("test/doc.txt", data, "text/plain");
    expect(put.ok).toBe(true);
    if (put.ok) {
      expect(put.data.byteSize).toBe(data.byteLength);
      expect(put.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const got = await s.get("test/doc.txt");
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.data.toString()).toBe("a gas safety record");
  });

  it("refuses a key that escapes the storage root", async () => {
    const res = await new LocalStorageAdapter().put("../../etc/evil.txt", Buffer.from("x"), "text/plain");
    expect(res.ok).toBe(false);
  });

  it("refuses an absolute path outside the root", async () => {
    expect((await new LocalStorageAdapter().get("/etc/passwd")).ok).toBe(false);
  });

  it("signs a path and accepts its own signature", () => {
    const expires = Math.floor(Date.now() / 1000) + 60;
    expect(verifySignedPath("a/b.pdf", expires, signPath("a/b.pdf", expires))).toBe(true);
  });

  it("rejects a signature for a different path", () => {
    const expires = Math.floor(Date.now() / 1000) + 60;
    expect(verifySignedPath("other.pdf", expires, signPath("a/b.pdf", expires))).toBe(false);
  });

  it("rejects an extended expiry, because the expiry is part of the signed material", () => {
    const expires = Math.floor(Date.now() / 1000) + 60;
    expect(verifySignedPath("a/b.pdf", expires + 3600, signPath("a/b.pdf", expires))).toBe(false);
  });

  it("rejects an expired signature", () => {
    const expires = Math.floor(Date.now() / 1000) - 1;
    expect(verifySignedPath("a/b.pdf", expires, signPath("a/b.pdf", expires))).toBe(false);
  });
});

describe("radar helpers", () => {
  it("splits a pasted list however it arrives", () => {
    expect(splitPostcodes("B1 1AA, SW1A 1AA\nM1 1AE;LS1 1UR")).toEqual([
      "B1 1AA", "SW1A 1AA", "M1 1AE", "LS1 1UR",
    ]);
  });

  it("ignores blank entries and stray whitespace", () => {
    expect(splitPostcodes("  B1 1AA ,, \n\n  SW1A 1AA  ")).toEqual(["B1 1AA", "SW1A 1AA"]);
  });

  it("returns nothing for empty input", () => {
    expect(splitPostcodes("   \n  ")).toEqual([]);
  });

  it("caps how many a visitor can submit at once", () => {
    expect(MAX_POSTCODES).toBeLessThanOrEqual(50);
  });

  it("validates region names against the real enum", () => {
    expect(isItl1Region("london")).toBe(true);
    expect(isItl1Region("atlantis")).toBe(false);
  });
});

describe("money formatting", () => {
  it.each([
    [0n, "£0"], [6500n, "£65"], [650n, "£6.50"], [99n, "£0.99"],
    [97500n, "£975"], [4000000n, "£40,000"], [700000n, "£7,000"],
    [123456789n, "£1,234,567.89"], [-6500n, "-£65"],
  ])("formats %s as %s", (pennies, expected) => {
    expect(formatPennies(pennies)).toBe(expected);
  });
});
