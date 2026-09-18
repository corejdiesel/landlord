/**
 * Migration runner.
 *
 * Deliberately tiny: migrations are plain .sql files applied in filename order
 * and recorded in schema_migrations. Keeping them as SQL (rather than in an ORM)
 * is what lets the RLS policies live in the migrations and be tested directly.
 *
 *   pnpm db:migrate            apply pending migrations
 *   pnpm db:migrate --reset    drop and recreate the schema first
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "db", "migrations");

export async function migrate(
  connectionString: string,
  { reset = false, quiet = false }: { reset?: boolean; quiet?: boolean } = {},
): Promise<string[]> {
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];

  try {
    if (reset) {
      // `drop schema public cascade` also removes the types and functions, so a
      // reset genuinely starts from nothing rather than from a half-state.
      await client.query("drop schema if exists public cascade");
      await client.query("create schema public");
      await client.query("grant all on schema public to current_user");
    }

    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows } = await client.query<{ filename: string }>("select filename from schema_migrations");
    const done = new Set(rows.map((r) => r.filename));

    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      // Each migration runs in its own transaction: a failure leaves the
      // database on the last good migration rather than partway through one.
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        applied.push(file);
        if (!quiet) console.log(`  applied ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }

    if (!quiet && applied.length === 0) console.log("  nothing to apply");
    return applied;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_URL ?? "postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted";
  const reset = process.argv.includes("--reset");
  console.log(`Migrating ${url.replace(/:[^:@]*@/, ":***@")}${reset ? " (reset)" : ""}`);
  migrate(url, { reset })
    .then(() => console.log("Done."))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
