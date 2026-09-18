import { Client } from "pg";
import { migrate } from "../scripts/migrate.js";

/**
 * Migrate the test database exactly once for the whole run.
 *
 * Vitest runs each test file in its own fork, so per-file setup would have
 * several processes racing to drop and recreate the schema. Global setup runs
 * once in the parent, before any fork starts.
 */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted_test";
  await migrate(url, { reset: true, quiet: true });

  // The schema reset drops grants on `public`, so re-grant the tamper-test role.
  const owner = new Client({ connectionString: url });
  await owner.connect();
  try {
    const { rows } = await owner.query("select 1 from pg_roles where rolname = 'letsorted_bypass'");
    if (rows.length > 0) {
      await owner.query("grant usage on schema public to letsorted_bypass");
      await owner.query("grant all on all tables in schema public to letsorted_bypass");
      await owner.query("grant all on all sequences in schema public to letsorted_bypass");
      await owner.query("grant execute on all functions in schema public to letsorted_bypass");
    }
  } finally {
    await owner.end();
  }
}
