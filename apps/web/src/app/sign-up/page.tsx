import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../auth-form";
import { signUpAction } from "../auth-actions";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <div className="wrap-narrow stack-lg" style={{ paddingTop: "var(--space-8)", paddingBottom: "var(--space-9)" }}>
      <h1>Create an account</h1>
      <p>
        We ask for as little as we can. You can add your properties afterwards,
        one at a time or all at once.
      </p>
      <AuthForm action={signUpAction} submitLabel="Create account" mode="sign-up" />
      <p>Already have one? <Link href="/sign-in">Sign in</Link>.</p>
    </div>
  );
}
