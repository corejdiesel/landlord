"use client";

import { useActionState } from "react";
import { Card, Status } from "../../../../components/ui";
import { saveTenancy } from "../actions";

export type TenancyDefaults = {
  kind: string;
  started_on: string;
  rent_pounds: number;
  rent_frequency: string;
  bills_included: boolean;
  households: number;
  occupants: number;
};

export function TenancyForm({ propertyId, tenancy, isRegistered }: {
  propertyId: string; tenancy: TenancyDefaults | null; isRegistered: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveTenancy, null);

  return (
    <Card>
      <form action={formAction} className="stack">
        <input type="hidden" name="property_id" value={propertyId} />

        {state?.ok ? (
          <div role="status"><Status tone="ok">Saved</Status></div>
        ) : null}
        {state && !state.ok ? (
          <div role="alert"><Status tone="danger">{state.error}</Status></div>
        ) : null}

        {isRegistered ? (
          <p className="hint" style={{ margin: 0 }}>
            This property is on the register. Changing anything here starts a 28-day
            clock to update your GOV.UK entry — we will track it for you.
          </p>
        ) : null}

        <div>
          <label htmlFor="kind">Type of tenancy</label>
          <select id="kind" name="kind" defaultValue={tenancy?.kind ?? "assured"}>
            <option value="assured">Assured tenancy</option>
            <option value="rent_act_regulated">Rent Act regulated</option>
            <option value="lodger">Lodger (you live there too)</option>
            <option value="high_rent">High rent (£100,000 a year or more)</option>
            <option value="low_rent">Low rent</option>
            <option value="supported_exempt">Supported exempt accommodation</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label htmlFor="started_on">When did it start?</label>
          <input id="started_on" name="started_on" type="date" required
                 defaultValue={tenancy?.started_on ?? ""} />
        </div>

        <div>
          <label htmlFor="rent_pounds">Rent</label>
          <input id="rent_pounds" name="rent_pounds" type="number" step="0.01" min={0} required
                 defaultValue={tenancy?.rent_pounds ?? ""} />
        </div>

        <div>
          <label htmlFor="rent_frequency">How often is it paid?</label>
          <select id="rent_frequency" name="rent_frequency" defaultValue={tenancy?.rent_frequency ?? "monthly"}>
            <option value="monthly">Monthly</option>
            <option value="four_weekly">Every 4 weeks</option>
            <option value="weekly">Weekly</option>
            <option value="other">Other</option>
          </select>
        </div>

        <label style={{ fontWeight: 400 }}>
          <input type="checkbox" name="bills_included" defaultChecked={tenancy?.bills_included ?? false} />
          {" "}The rent includes bills
        </label>

        <div>
          <label htmlFor="households">How many households?</label>
          <p className="hint" id="households-hint">
            One person or a family living together is one household. Three unrelated
            tenants sharing is three.
          </p>
          <input id="households" name="households" type="number" min={0} max={50} required
                 defaultValue={tenancy?.households ?? 1} aria-describedby="households-hint" />
        </div>

        <div>
          <label htmlFor="occupants">How many people live there?</label>
          <p className="hint" id="occupants-hint">
            Include children and babies. Do not count guests staying under 90 days.
          </p>
          <input id="occupants" name="occupants" type="number" min={0} max={200} required
                 defaultValue={tenancy?.occupants ?? 1} aria-describedby="occupants-hint" />
        </div>

        <div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Card>
  );
}
