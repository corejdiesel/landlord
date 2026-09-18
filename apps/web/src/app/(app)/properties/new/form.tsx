"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, Status } from "../../../../components/ui";
import { createProperty } from "../actions";

export function NewPropertyForm() {
  const [state, formAction, pending] = useActionState(createProperty, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok && state.data && typeof state.data === "object" && "id" in state.data) {
      router.push(`/properties/${(state.data as { id: string }).id}`);
    }
  }, [state, router]);

  return (
    <Card>
      <form action={formAction} className="stack-lg">
        {state && !state.ok ? (
          <div role="alert"><Status tone="danger">{state.error}</Status></div>
        ) : null}

        <fieldset className="stack">
          <legend>Where it is</legend>
          <div>
            <label htmlFor="line1">Address</label>
            <input id="line1" name="line1" type="text" required autoComplete="address-line1" />
          </div>
          <div>
            <label htmlFor="town">Town or city</label>
            <input id="town" name="town" type="text" autoComplete="address-level2" />
          </div>
          <div>
            <label htmlFor="postcode">Postcode</label>
            <input id="postcode" name="postcode" type="text" required autoComplete="postal-code" />
          </div>
        </fieldset>

        <fieldset className="stack">
          <legend>What it is</legend>
          <div>
            <label htmlFor="type">Property type</label>
            <select id="type" name="type" defaultValue="terraced">
              <option value="detached">Detached</option>
              <option value="semi_detached">Semi-detached</option>
              <option value="terraced">Terraced</option>
              <option value="flat">Flat</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="ownership">How you own it</label>
            <select id="ownership" name="ownership" defaultValue="freehold">
              <option value="freehold">Freehold</option>
              <option value="leasehold">Leasehold</option>
              <option value="share_of_freehold">Share of freehold</option>
              <option value="commonhold">Commonhold</option>
            </select>
          </div>
          <div>
            <label htmlFor="bedrooms">Bedrooms</label>
            <p className="hint" id="bedrooms-hint">
              Do not count rooms smaller than 4.64 square metres — the register excludes them.
            </p>
            <input id="bedrooms" name="bedrooms" type="number" min={0} max={50} defaultValue={2}
                   aria-describedby="bedrooms-hint" />
          </div>
          <div>
            <label htmlFor="storeys">Storeys</label>
            <p className="hint" id="storeys-hint">You need a smoke alarm on each one.</p>
            <input id="storeys" name="storeys" type="number" min={1} max={20} defaultValue={2}
                   aria-describedby="storeys-hint" />
          </div>
          <div>
            <label htmlFor="furnished">Furnished?</label>
            <select id="furnished" name="furnished" defaultValue="unfurnished">
              <option value="furnished">Furnished</option>
              <option value="part_furnished">Part furnished</option>
              <option value="unfurnished">Unfurnished</option>
            </select>
          </div>
        </fieldset>

        <fieldset className="stack">
          <legend>Safety and licensing</legend>
          <label style={{ fontWeight: 400 }}>
            <input type="checkbox" name="has_gas" /> It has a gas supply or gas appliances
          </label>
          <label style={{ fontWeight: 400 }}>
            <input type="checkbox" name="hmo" /> It is a house in multiple occupation
          </label>
          <div>
            <label htmlFor="licence_kind">Does the council require a licence?</label>
            <select id="licence_kind" name="licence_kind" defaultValue="none_needed">
              <option value="none_needed">No licence needed</option>
              <option value="selective">Selective licence</option>
              <option value="hmo_mandatory">Mandatory HMO licence</option>
              <option value="hmo_additional">Additional HMO licence</option>
            </select>
          </div>
        </fieldset>

        <div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add property"}
          </button>
        </div>
      </form>
    </Card>
  );
}
