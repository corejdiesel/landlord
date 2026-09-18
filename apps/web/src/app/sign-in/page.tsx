import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../auth-form";
import { signInAction } from "../auth-actions";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="wrap-narrow stack-lg" style={{ paddingTop: "var(--space-8)", paddingBottom: "var(--space-9)" }}>
      <h1>Sign in</h1>
      <AuthForm action={signInAction} submitLabel="Sign in" mode="sign-in" />
      <p>New here? <Link href="/sign-up">Create an account</Link>.</p>
    </div>
  );
}
