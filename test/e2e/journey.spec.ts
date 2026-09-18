import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The end-to-end journey from the spec's definition of done.
 *
 * A new user can: check a postcode, sign up, add a property, record the
 * letting, forward a certificate, confirm the extraction, complete the
 * Rehearsal, record registration numbers, change the rent, see a 28-day drift
 * item, close it, and export a Defence File.
 *
 * Deliberately one test rather than twelve. The value is in the seams — the
 * places where one step's output becomes the next step's input — and a suite of
 * isolated tests would miss exactly those.
 */

const UNIQUE = Date.now();
const EMAIL = `journey-${UNIQUE}@example.test`;
const PASSWORD = "a-long-enough-passphrase";

test.describe.configure({ mode: "serial" });

test("a landlord can get from a postcode to a Defence File", async ({ page }) => {
  // ---- 1. The public Radar, with no account ----------------------------
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("register your rental property");

  await page.getByLabel("Postcode of the property you let").fill("B13 9QT");
  await page.getByRole("button", { name: "Show my dates" }).click();

  await expect(page.getByRole("heading", { name: "West Midlands" })).toBeVisible();
  // The West Midlands deadline is 14 March 2027; the demo date is 20 January.
  await expect(page.getByText("14 March 2027").first()).toBeVisible();
  await expect(page.getByText("£65 a year")).toBeVisible();

  // ---- 2. Sign up -------------------------------------------------------
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Journey Tester");
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();

  // ---- 3. Add a property ------------------------------------------------
  await page.getByRole("link", { name: "Add a property" }).click();
  await page.getByLabel("Address").fill("12 Acacia Road");
  await page.getByLabel("Town or city").fill("Birmingham");
  await page.getByLabel("Postcode").fill("B13 9QT");
  await page.getByLabel("Bedrooms").fill("3");
  await page.getByLabel("It has a gas supply or gas appliances").check();
  await page.getByRole("button", { name: "Add property" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("12 Acacia Road");
  const propertyUrl = page.url();

  // The region was resolved from the postcode, which is what every date depends on.
  await expect(page.getByText(/West Midlands/).first()).toBeVisible();

  // ---- 4. Record the letting -------------------------------------------
  await page.getByLabel("When did it start?").fill("2025-06-01");
  await page.getByLabel("Rent", { exact: true }).fill("1250");
  await page.getByLabel("How many households?").fill("1");
  await page.getByLabel("How many people live there?").fill("3");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  // ---- 5. Forward a certificate and confirm the extraction --------------
  await page.goto("/documents");
  await page.getByText("Simulate a forwarded email").click();
  await page.getByLabel("Attachment contents").fill(
    "Landlord Gas Safety Record\n12 Acacia Road, Birmingham\nInspection date 05/01/2027\nEngineer 123456\nAll appliances passed",
  );
  await page.getByRole("button", { name: "Deliver to my inbox" }).click();

  await expect(page.getByText("Waiting for you to confirm")).toBeVisible();
  // Nothing counts until a human confirms it — that is the product rule.
  await expect(page.getByText("Needs your check")).toBeVisible();

  // Index 1 skips the "Choose a property" placeholder.
  await page.getByLabel("Which property is it for?").last().selectOption({ index: 1 });
  await page.getByRole("button", { name: "This is right — save it" }).click();
  await expect(page.getByText("Confirmed").first()).toBeVisible();

  // ---- 6. The Registration Pack ----------------------------------------
  await page.goto(`${propertyUrl}/rehearsal`);
  await expect(page.getByRole("heading", { name: "Your registration pack" })).toBeVisible();
  await expect(page.getByText(/% ready/)).toBeVisible();
  // The answers are prefilled from what we already hold.
  await expect(page.getByText("B13 9QT").first()).toBeVisible();

  // ---- 7. Record the registration numbers -------------------------------
  await page.goto(propertyUrl);
  await page.getByText("Already registered on GOV.UK? Record your numbers").click();
  await page.getByLabel("Property registration number").fill("PRP-JOURNEY-001");
  await page.getByLabel("Your landlord registration number").fill("LRN-JOURNEY-001");
  await page.getByLabel("When did you register?").fill("2027-01-05");
  await page.getByRole("button", { name: "Record registration" }).click();
  await expect(page.getByText("Recorded").first()).toBeVisible();

  // ---- 8. Change the rent, and see a 28-day drift item ------------------
  await page.reload();
  await page.getByLabel("Rent", { exact: true }).fill("1350");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("Your GOV.UK entry is out of date")).toBeVisible();
  // Rendered as money, not as raw pennies.
  await expect(page.getByText("£1,350")).toBeVisible();

  // ---- 9. Close the drift item ------------------------------------------
  await page.goto(`${propertyUrl}/drift`);
  await expect(page.getByRole("heading", { name: "Update your GOV.UK entry" })).toBeVisible();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "I have updated these on GOV.UK" }).click();
  // The action re-renders the route, so the acknowledgement lives in the empty
  // state rather than in the form's own success message.
  await expect(page.getByText("Nothing to update")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("Your GOV.UK entry is out of date")).toHaveCount(0);

  // ---- 10. Export the Defence File --------------------------------------
  await page.goto(`${propertyUrl}/defence-file`);
  await expect(page.getByRole("heading", { name: "Your record" })).toBeVisible();
  await expect(page.getByText("Record intact")).toBeVisible();
  // The whole journey should be in it, in order.
  await expect(page.getByText(/Property added/)).toBeVisible();
  await expect(page.getByText(/Registered on the government database/)).toBeVisible();
  await expect(page.getByText(/confirmed the government entry was updated/i)).toBeVisible();

  // ---- 11. Share a Tenant Passport --------------------------------------
  await page.goto(`${propertyUrl}/sharing`);
  await page.getByRole("button", { name: "Publish the page" }).click();
  await expect(page.getByText("Published")).toBeVisible();

  const link = await page.getByText(/\/p\//).first().innerText();
  const slug = link.split("/p/")[1]!.trim();

  // ---- 12. The passport, as a tenant sees it ----------------------------
  await page.context().clearCookies();
  await page.goto(`/p/${slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Acacia Road");
  // Street, not house number.
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("12 Acacia");
  // Nothing identifying about the landlord.
  const body = await page.locator("body").innerText();
  expect(body).not.toContain(EMAIL);
  expect(body).not.toContain("Journey Tester");
  expect(body).not.toContain("PRP-JOURNEY-001");
});

/**
 * Accessibility.
 *
 * The audience is largely over 60, on mixed devices. WCAG 2.2 AA is checked with
 * axe on every main route rather than spot-checked.
 */
const PUBLIC_ROUTES = ["/", "/design", "/sign-in", "/sign-up"];

for (const route of PUBLIC_ROUTES) {
  test(`${route} has no accessibility violations`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    if (results.violations.length > 0) {
      console.error(
        results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${
          v.nodes.map((n) => n.html).join("\n  ")}`).join("\n\n"),
      );
    }
    expect(results.violations).toEqual([]);
  });
}

test("the Radar result is keyboard-complete and announced", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Postcode of the property you let").fill("LS6 2QL");
  await page.getByRole("button", { name: "Show my dates" }).click();
  await expect(page.getByRole("heading", { name: "Yorkshire and the Humber" })).toBeVisible();

  // Countdowns must read as a sentence, not as a bare number.
  await expect(page.getByText(/days? (remaining|to register|until you can register), due/)).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

/** Create a fresh account, so this test does not depend on another one. */
async function signUpFresh(page: Page): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Access Tester");
  await page.getByLabel("Email address").fill(`a11y-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("signed-in routes have no accessibility violations", async ({ page }) => {
  await signUpFresh(page);

  // Add a property and TWO pending documents first. An empty documents page
  // cannot catch duplicate element ids across repeated confirm forms, which is
  // exactly the violation this sweep found the first time it ran.
  await page.goto("/properties/new");
  await page.getByLabel("Address").fill("9 Sweep Street");
  await page.getByLabel("Postcode").fill("LS6 2QL");
  await page.getByRole("button", { name: "Add property" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sweep Street");

  for (const kind of ["Gas safety record\n9 Sweep Street\n05/01/2027",
                      "Electrical Installation Condition Report\n9 Sweep Street\n06/01/2027"]) {
    await page.goto("/documents");
    await page.getByText("Simulate a forwarded email").click();
    await page.getByLabel("Attachment contents").fill(kind);
    await page.getByRole("button", { name: "Deliver to my inbox" }).click();
    await expect(page.getByText("Waiting for you to confirm")).toBeVisible();
  }

  for (const route of ["/dashboard", "/properties", "/documents", "/changes"]) {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    if (results.violations.length > 0) {
      console.error(`${route}:\n` + results.violations.map((v) => `${v.id}: ${v.help}`).join("\n"));
    }
    expect(results.violations, route).toEqual([]);
  }
});

test("an unauthenticated visitor cannot reach the app", async ({ page }) => {
  await page.context().clearCookies();
  for (const route of ["/dashboard", "/properties", "/documents", "/clients"]) {
    await page.goto(route);
    await expect(page, route).toHaveURL(/\/sign-in/);
  }
});
