import type { AdapterResult, PaymentsAdapter, PlanId } from "../types";

/**
 * Stripe, test mode only. With no key configured this returns a local URL that
 * simulates a successful checkout, so plan gating is demonstrable without keys.
 */
export class MockPaymentsAdapter implements PaymentsAdapter {
  async createCheckout(input: { accountId: string; plan: PlanId }): Promise<AdapterResult<{ url: string }>> {
    return {
      ok: true,
      source: "mock",
      data: { url: `/billing/simulate?plan=${input.plan}&account=${input.accountId}` },
    };
  }

  async status(_accountId: string): Promise<AdapterResult<{ plan: PlanId; status: string }>> {
    return { ok: true, source: "mock", data: { plan: "free", status: "active" } };
  }
}

export function paymentsAdapter(_mode: "live" | "mock"): PaymentsAdapter {
  // A live Stripe implementation would go here; this build is test-mode only
  // and does no network billing calls at all.
  return new MockPaymentsAdapter();
}
