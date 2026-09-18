import type { Metadata } from "next";
import { NewPropertyForm } from "./form";

export const metadata: Metadata = { title: "Add a property" };

export default function NewPropertyPage() {
  return (
    <div className="wrap-narrow stack-lg" style={{ paddingTop: "var(--space-6)", paddingLeft: 0, paddingRight: 0 }}>
      <h1>Add a property</h1>
      <p>
        We work out which region it is in from the postcode, because that is what
        decides your dates — and it is not something anyone knows off the top of
        their head.
      </p>
      <NewPropertyForm />
    </div>
  );
}
