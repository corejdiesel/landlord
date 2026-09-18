/**
 * Mint a session cookie for a seeded user, for local testing and screenshots.
 *
 *   pnpm tsx scripts/dev-session.ts ops@brightside.test
 *
 * Prints the raw token. Only the hash is stored, so this is the one moment the
 * token exists — exactly as it would be when set on a real sign-in.
 * Refuses to run against a non-local database.
 */
import { createHash, randomBytes } from "node:crypto";
import { Client } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted";

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: pnpm tsx scripts/dev-session.ts <email>");
    process.exit(1);
  }
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL)) {
    console.error("Refusing to mint a session against a non-local database.");
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      "select id from app_user_for_login($1)", [email],
    );
    const user = rows[0];
    if (!user) {
      console.error(`No user with email ${email}. Run pnpm db:seed first.`);
      process.exit(1);
    }

    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + 7 * 86_400_000);
    await client.query("select app_create_session($1, $2, $3)", [
      user.id, createHash("sha256").update(token).digest("hex"), expires,
    ]);
    console.log(token);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
