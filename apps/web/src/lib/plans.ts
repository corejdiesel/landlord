/**
 * Plans and capabilities.
 *
 * Gating is ONE capability map, not scattered checks. Adding a feature to a
 * plan is a line here; asking "can this account do X?" is always `can()`.
 * Scattered `if (plan === "portfolio")` checks are how gating drifts out of
 * step with what was sold.
 *
 * Prices are in pennies, from the spec, and are hypotheses rather than
 * researched positions — recorded as such in DECISIONS.md and
 * QUESTIONS_FOR_JOE.md.
 */

export type PlanId = "free" | "landlord" | "portfolio" | "agent";

export type Capability =
  | "radar"
  | "rehearsal"
  | "reminders"
  | "cert_inbox"
  | "drift_clock"
  | "defence_file"
  | "passport"
  | "pulse"
  | "csv_import"
  | "hmo_mode"
  | "priority_law_watch"
  | "agent_workspace"
  | "attestations"
  | "client_branding";

export type Plan = {
  id: PlanId;
  name: string;
  monthly_pennies: bigint;
  yearly_pennies: bigint | null;
  /** Null means no limit. */
  property_limit: number | null;
  /** Charged per property beyond the limit, where the plan allows overage. */
  overage_pennies_per_property: bigint | null;
  trial_days: number;
  capabilities: Capability[];
};

const LANDLORD_CAPS: Capability[] = [
  "radar", "rehearsal", "reminders", "cert_inbox", "drift_clock",
  "defence_file", "passport", "pulse",
];

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    monthly_pennies: 0n,
    yearly_pennies: 0n,
    property_limit: 1,
    overage_pennies_per_property: null,
    trial_days: 0,
    capabilities: ["radar", "rehearsal", "reminders"],
  },
  landlord: {
    id: "landlord",
    name: "Landlord",
    monthly_pennies: 600n,
    yearly_pennies: 6000n,
    property_limit: 3,
    overage_pennies_per_property: null,
    trial_days: 14,
    capabilities: LANDLORD_CAPS,
  },
  portfolio: {
    id: "portfolio",
    name: "Portfolio",
    monthly_pennies: 1500n,
    yearly_pennies: 15000n,
    property_limit: 15,
    overage_pennies_per_property: null,
    trial_days: 14,
    capabilities: [...LANDLORD_CAPS, "csv_import", "hmo_mode", "priority_law_watch"],
  },
  agent: {
    id: "agent",
    name: "Agent",
    monthly_pennies: 4900n,
    yearly_pennies: null,
    property_limit: 50,
    overage_pennies_per_property: 75n,
    trial_days: 14,
    capabilities: [
      ...LANDLORD_CAPS, "csv_import", "hmo_mode", "priority_law_watch",
      "agent_workspace", "attestations", "client_branding",
    ],
  },
};

export function planFor(id: string): Plan {
  return PLANS[id as PlanId] ?? PLANS.free;
}

export function can(planId: string, capability: Capability): boolean {
  return planFor(planId).capabilities.includes(capability);
}

export type LimitCheck =
  | { allowed: true; overage: number; overagePennies: bigint }
  | { allowed: false; limit: number; reason: string };

/**
 * Can this account hold another property?
 *
 * Plans that allow overage never block; they price it. Plans that do not, stop
 * at the limit with a message naming the plan that would cover it — a hard stop
 * with no way forward is how people end up unable to record a property they are
 * legally obliged to register.
 */
export function checkPropertyLimit(planId: string, propertyCount: number): LimitCheck {
  const plan = planFor(planId);
  if (plan.property_limit === null) {
    return { allowed: true, overage: 0, overagePennies: 0n };
  }

  const overage = Math.max(0, propertyCount - plan.property_limit);

  if (overage === 0) return { allowed: true, overage: 0, overagePennies: 0n };

  if (plan.overage_pennies_per_property !== null) {
    return {
      allowed: true,
      overage,
      overagePennies: plan.overage_pennies_per_property * BigInt(overage),
    };
  }

  const next = nextPlanFor(propertyCount, plan.id);
  return {
    allowed: false,
    limit: plan.property_limit,
    reason: next
      ? `Your plan covers ${plan.property_limit} propert${plan.property_limit === 1 ? "y" : "ies"}. ` +
        `${PLANS[next].name} covers ${PLANS[next].property_limit ?? "more"}.`
      : `Your plan covers ${plan.property_limit} properties.`,
  };
}

/** The cheapest plan that would cover this many properties. */
export function nextPlanFor(propertyCount: number, current: PlanId): PlanId | null {
  const order: PlanId[] = ["free", "landlord", "portfolio", "agent"];
  const currentIndex = order.indexOf(current);
  for (const id of order.slice(currentIndex + 1)) {
    const plan = PLANS[id];
    if (plan.property_limit === null || plan.property_limit >= propertyCount
        || plan.overage_pennies_per_property !== null) {
      return id;
    }
  }
  return null;
}

/** Monthly cost including any overage, in pennies. */
export function monthlyCostPennies(planId: string, propertyCount: number): bigint {
  const plan = planFor(planId);
  const check = checkPropertyLimit(planId, propertyCount);
  const overage = check.allowed ? check.overagePennies : 0n;
  return plan.monthly_pennies + overage;
}
