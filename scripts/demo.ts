/**
 * `pnpm demo` — reset, seed and start with mocks on and time travel enabled.
 *
 * The spec's definition of done: a fully navigable product with no keys
 * configured. This is the one command that proves it.
 */
import { spawn } from "node:child_process";
import { migrate } from "./migrate.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted";
const DEMO_DATE = process.env.TIME_TRAVEL_DATE ?? "2027-01-20";

async function run(cmd: string, args: string[], env: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    child.on("error", reject);
  });
}

async function main(): Promise<void> {
  console.log("Resetting the database…");
  await migrate(DATABASE_URL, { reset: true, quiet: true });

  console.log("Seeding the four demo personas…");
  await run("pnpm", ["tsx", "scripts/seed.ts"], { DATABASE_URL, TIME_TRAVEL_DATE: DEMO_DATE });

  console.log("\nStarting with every adapter mocked and the date pinned.");
  console.log(`Time travel: ${DEMO_DATE}. Change it with TIME_TRAVEL_DATE.\n`);

  await run("pnpm", ["--filter", "@letsorted/web", "dev"], {
    DATABASE_URL,
    TIME_TRAVEL_DATE: DEMO_DATE,
    ALLOW_TIME_TRAVEL: "1",
    FORCE_MOCKS: "1",
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
