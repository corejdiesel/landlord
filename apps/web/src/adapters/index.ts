import { adapterModes, env, type Env } from "../lib/env";
import { companiesHouseAdapter } from "./companies-house/index";
import { emailAdapter } from "./email/index";
import { epcAdapter } from "./epc/index";
import { lawWatchFetcher } from "./law-watch/index";
import { llmAdapter } from "./llm/index";
import { paymentsAdapter } from "./payments/index";
import { postcodesAdapter } from "./postcodes/index";
import { storageAdapter } from "./storage/index";

/**
 * Adapter registry.
 *
 * One place that decides live vs mock, so no feature ever branches on whether a
 * key is set. Call `adapters()` and use what comes back.
 */
export function adapters(e: Env = env()) {
  const modes = adapterModes(e);
  return {
    modes,
    postcodes: postcodesAdapter(modes.postcodes),
    epc: epcAdapter(modes.epc),
    companiesHouse: companiesHouseAdapter(modes.companiesHouse),
    llm: llmAdapter(modes.llm),
    email: emailAdapter(modes.email),
    payments: paymentsAdapter(modes.payments),
    lawWatch: lawWatchFetcher(modes.lawWatchFetcher),
    storage: storageAdapter(modes.storage),
  };
}

export type Adapters = ReturnType<typeof adapters>;
export * from "./types";
