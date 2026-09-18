import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diffText, listChanges, reviewChange, runLawWatch } from "../apps/web/src/lib/law-watch.js";
import { connect, createAccount, ensureTestSchema, setContext, type Fixture } from "./helpers/db.js";

/**
 * Law Watch.
 *
 * The property that matters most: it never edits a rule. A model noticing that
 * a page changed is not the same as knowing the law changed, and a compliance
 * product that closes that gap automatically is the dangerous version of this
 * feature.
 */

describe("diffing", () => {
  it("reports nothing for identical text", () => {
    expect(diffText("a\nb", "a\nb")).toBe("");
  });

  it("reports added and removed lines", () => {
    const diff = diffText("a\nb\nc", "a\nc\nd");
    expect(diff).toContain("- b");
    expect(diff).toContain("+ d");
  });

  it("reports a wholesale rewrite as such", () => {
    const diff = diffText("old text", "new text");
    expect(diff).toContain("- old text");
    expect(diff).toContain("+ new text");
  });
});

describe("running the watch", () => {
  let client: Client;
  let admin: Fixture;
  /**
   * Law Watch is account-independent, so every test file shares its source
   * list. Runs are scoped to this test's own source id — otherwise a parallel
   * file adding a source makes the counts here nondeterministic.
   */
  let sourceId: string;

  beforeAll(async () => {
    await ensureTestSchema();
    client = await connect();
    admin = await createAccount(client, "LawAdmin");
    await setContext(client, { accountId: admin.accountId, userId: admin.userId, isAdmin: true });
    const { rows } = await client.query<{ id: string }>(
      "insert into law_watch_sources (label, url) values ('Test guidance', $1) returning id",
      ["https://example.test/law-watch-guidance"],
    );
    sourceId = rows[0]!.id;
  }, 60_000);

  afterAll(async () => { await client?.end(); });

  it("records a baseline on first sight, and calls it no change", async () => {
    const run = await runLawWatch({ sourceIds: [sourceId] });
    expect(run.checked).toBeGreaterThan(0);
    // Assert the fetches SUCCEEDED. An earlier version of this test passed
    // because the fetcher was running live in tests and every fetch failed, so
    // "changed: 0" meant "we learned nothing" rather than "nothing changed".
    expect(run.failed).toEqual([]);
    // The first fetch is a baseline: there is nothing to diff against.
    expect(run.changed).toBe(0);

    await setContext(client, { accountId: admin.accountId, userId: admin.userId, isAdmin: true });
    const { rows } = await client.query("select id from law_watch_snapshots");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("records nothing when a source has not changed", async () => {
    const before = await client.query<{ count: string }>(
      "select count(*) as count from law_watch_snapshots where source_id = $1", [sourceId],
    );
    const run = await runLawWatch({ sourceIds: [sourceId] });
    expect(run.failed).toEqual([]);
    expect(run.changed).toBe(0);
    const after = await client.query<{ count: string }>(
      "select count(*) as count from law_watch_snapshots where source_id = $1", [sourceId],
    );
    // Storing a snapshot per poll would bury real changes in noise.
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
  });

  it("opens a pending review task when a source changes", async () => {
    await setContext(client, { accountId: admin.accountId, userId: admin.userId, isAdmin: true });
    // The mock fetcher returns different content for a versioned URL, which is
    // how a source amendment is simulated without any network.
    await client.query("update law_watch_sources set url = $1 where id = $2", [
      "https://example.test/law-watch-guidance?v=2", sourceId,
    ]);

    const run = await runLawWatch({ sourceIds: [sourceId] });
    expect(run.failed).toEqual([]);
    expect(run.changed).toBe(1);

    const pending = (await listChanges(true, "pending"))
      .filter((c) => c.source_url.includes("law-watch-guidance"));
    expect(pending.length).toBe(1);
    expect(pending[0]!.diff.length).toBeGreaterThan(0);
    expect(pending[0]!.model_summary).toBeTruthy();
  });

  it("never edits a rule", async () => {
    // There is deliberately no code path from a detected change to the rule
    // corpus. Rules live in packages/rules and change only in a reviewed commit.
    const source = await import("../apps/web/src/lib/law-watch.js");
    expect(Object.keys(source).sort()).toEqual(
      ["diffText", "listChanges", "reviewChange", "runLawWatch"],
    );
  });
});

describe("the admin review queue", () => {
  let client: Client;
  let admin: Fixture;
  let changeId: string;
  let reviewSourceId: string;

  beforeAll(async () => {
    await ensureTestSchema();
    client = await connect();
    admin = await createAccount(client, "ReviewAdmin");
    await setContext(client, { accountId: admin.accountId, userId: admin.userId, isAdmin: true });
    const { rows } = await client.query<{ id: string }>(
      "insert into law_watch_sources (label, url) values ('Review source', $1) returning id",
      ["https://example.test/review-source"],
    );
    reviewSourceId = rows[0]!.id;
    await runLawWatch({ sourceIds: [reviewSourceId] });
    await setContext(client, { accountId: admin.accountId, userId: admin.userId, isAdmin: true });
    await client.query("update law_watch_sources set url = $1 where id = $2", [
      "https://example.test/review-source?v=3", reviewSourceId,
    ]);
    await runLawWatch({ sourceIds: [reviewSourceId] });
    const pending = (await listChanges(true, "pending"))
      .filter((c) => c.source_url.includes("review-source"));
    changeId = pending[0]!.id;
  }, 60_000);

  afterAll(async () => { await client?.end(); });

  it("hides a pending change from ordinary users", async () => {
    expect((await listChanges(false, "all")).map((c) => c.id)).not.toContain(changeId);
  });

  it("refuses to publish without a human-written summary", async () => {
    const result = await reviewChange(admin.userId, changeId, "approved", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/your own words/i);
  });

  it("refuses to publish a summary that is barely written", async () => {
    const result = await reviewChange(admin.userId, changeId, "approved", "ok");
    expect(result.ok).toBe(false);
  });

  it("publishes with a human summary, and only then shows it to users", async () => {
    const summary = "The guidance page now confirms the response period for pet requests.";
    expect(await reviewChange(admin.userId, changeId, "approved", summary)).toEqual({ ok: true });

    const visible = await listChanges(false, "approved");
    const published = visible.find((c) => c.id === changeId);
    expect(published).toBeDefined();
    expect(published!.model_summary).toBe(summary);
  });

  it("refuses a second review of the same change", async () => {
    const again = await reviewChange(admin.userId, changeId, "rejected", null);
    expect(again.ok).toBe(false);
  });

  it("lets an admin reject without a summary", async () => {
    await setContext(client, { accountId: admin.accountId, userId: admin.userId, isAdmin: true });
    await client.query("update law_watch_sources set url = $1 where id = $2", [
      "https://example.test/review-source?v=4", reviewSourceId,
    ]);
    await runLawWatch({ sourceIds: [reviewSourceId] });
    const pending = (await listChanges(true, "pending"))
      .filter((c) => c.source_url.includes("review-source"));
    expect(pending.length).toBeGreaterThan(0);
    expect(await reviewChange(admin.userId, pending[0]!.id, "rejected", null)).toEqual({ ok: true });
    expect((await listChanges(false, "approved")).map((c) => c.id)).not.toContain(pending[0]!.id);
  });
});
