"use client";

import { useActionState } from "react";
import { Card, Status } from "../components/ui";
import type { AuthResult } from "./auth-actions";

export function AuthForm({ action, submitLabel, mode }: {
  action: (prev: AuthResult | null, formData: FormData) => Promise<AuthResult>;
  submitLabel: string;
  mode: "sign-in" | "sign-up";
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <Card>
      <form action={formAction} className="stack">
        {state && !state.ok ? (
          <div role="alert">
            <Status tone="danger">{state.error}</Status>
          </div>
        ) : null}

        {mode === "sign-up" ? (
          <div>
            <label htmlFor="name">Your name</label>
            <input id="name" name="name" type="text" required autoComplete="name" />
          </div>
        ) : null}

        <div>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>

        <div>
          <label htmlFor="password">Password</label>
          {mode === "sign-up" ? (
            <p className="hint" id="password-hint">
              At least 10 characters. A few words you will remember beats something short and clever.
            </p>
          ) : null}
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            aria-describedby={mode === "sign-up" ? "password-hint" : undefined}
          />
        </div>

        {mode === "sign-up" ? (
          <fieldset>
            <legend>What are you?</legend>
            <div className="stack">
              <label style={{ fontWeight: 400 }}>
                <input type="radio" name="accountType" value="landlord" defaultChecked /> A landlord
              </label>
              <label style={{ fontWeight: 400 }}>
                <input type="radio" name="accountType" value="agent" /> A letting agent
              </label>
            </div>
          </fieldset>
        ) : null}

        <div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Working…" : submitLabel}
          </button>
        </div>
      </form>
    </Card>
  );
}
