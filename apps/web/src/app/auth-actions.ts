"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, signIn, signUp, startSession } from "../lib/auth";

/** Auth server actions. Errors are returned, never thrown at the user. */

export type AuthResult = { ok: true } | { ok: false; error: string };

const signUpSchema = z.object({
  email: z.string().email("Enter an email address we can reach you on."),
  // Length over composition rules: a long passphrase beats a short one with a
  // symbol in it, and composition rules push people towards Password1!
  password: z.string().min(10, "Use at least 10 characters. A few words you will remember is ideal."),
  name: z.string().min(1, "Tell us your name."),
  accountType: z.enum(["landlord", "agent"]).default("landlord"),
});

export async function signUpAction(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
    accountType: formData.get("accountType") ?? "landlord",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  try {
    const { userId } = await signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name,
      accountName: parsed.data.name,
      accountType: parsed.data.accountType,
    });
    await startSession(userId);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("already registered")) {
      return { ok: false, error: "There is already an account with that email. Try signing in." };
    }
    return { ok: false, error: "We could not create that account. Please try again." };
  }

  redirect("/dashboard");
}

const signInSchema = z.object({
  email: z.string().email("Enter your email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function signInAction(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  const userId = await signIn(parsed.data.email, parsed.data.password);
  if (!userId) {
    // One message for both cases, so this cannot be used to discover which
    // email addresses have accounts.
    return { ok: false, error: "That email and password do not match." };
  }

  await startSession(userId);
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/");
}
