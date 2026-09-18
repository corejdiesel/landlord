import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { mockedAdapters } from "../lib/env";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "Let Sorted — stay on the right side of the new landlord rules",
    template: "%s · Let Sorted",
  },
  description:
    "Check when you have to register your rental property in England, keep your certificates in date, and prove you did it.",
  applicationName: "Let Sorted",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f0" },
    { media: "(prefers-color-scheme: dark)", color: "#16150f" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const mocked = mockedAdapters();

  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap"
        />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        {mocked.length > 0 ? (
          <div className="dev-banner" role="status">
            Demo mode — {mocked.length} service{mocked.length === 1 ? " is" : "s are"} simulated
            {" "}({mocked.join(", ")}). Nothing here is sent anywhere.
          </div>
        ) : null}
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
