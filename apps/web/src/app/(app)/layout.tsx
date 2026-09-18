import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentSession } from "../../lib/auth";
import { signOutAction } from "../auth-actions";

/** Shell for every signed-in screen. Unauthenticated visitors go to sign-in. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/sign-in");

  return (
    <div className="stack-lg" style={{ paddingBottom: "var(--space-9)" }}>
      <header style={{ borderBottom: "1px solid var(--rule)", paddingTop: "var(--space-4)", paddingBottom: "var(--space-4)" }}>
        <div className="wrap spread">
          <Link href="/dashboard" style={{ fontFamily: "var(--font-serif)", fontSize: "var(--text-lg)", fontWeight: 600, textDecoration: "none", color: "var(--ink)" }}>
            Let Sorted
          </Link>
          <nav aria-label="Main" className="row" style={{ gap: "var(--space-5)" }}>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/properties">Properties</Link>
            <Link href="/documents">Documents</Link>
            <Link href="/clients">Clients</Link>
            {session.isAdmin ? <Link href="/admin/law-watch">Law Watch</Link> : null}
            <form action={signOutAction}>
              <button className="btn btn-quiet" type="submit" style={{ minHeight: "auto", padding: "var(--space-2) var(--space-3)" }}>
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <div className="wrap">{children}</div>
    </div>
  );
}
