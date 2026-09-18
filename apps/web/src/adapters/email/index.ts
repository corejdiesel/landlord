import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "../../lib/env";
import type { AdapterResult, EmailAdapter, OutboundEmail } from "../types";

/**
 * Outbound email.
 *
 * This build never sends a real message (spec 2.2). Mail is written to a local
 * catcher directory and listed at /dev/mail. Because missed reminders are the
 * product's nightmare scenario, every send is also ledgered by the caller —
 * the adapter itself stays dumb.
 */
export class MailCatcherAdapter implements EmailAdapter {
  private dir(): string {
    return resolve(process.cwd(), env().MAIL_DIR);
  }

  async send(message: OutboundEmail): Promise<AdapterResult<{ id: string }>> {
    const dir = this.dir();
    await mkdir(dir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(
      resolve(dir, `${id}.json`),
      JSON.stringify({ ...message, id, caught_at: new Date().toISOString() }, null, 2),
    );
    return { ok: true, data: { id }, source: "mock" };
  }

  async sent(): Promise<OutboundEmail[]> {
    const dir = this.dir();
    try {
      const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort().reverse();
      return await Promise.all(
        files.slice(0, 200).map(async (f) => JSON.parse(await readFile(resolve(dir, f), "utf8")) as OutboundEmail),
      );
    } catch {
      return [];
    }
  }
}

export function emailAdapter(_mode: "live" | "mock"): EmailAdapter {
  // There is no live implementation on purpose: sending real mail is outside
  // this build's limits. Wiring one in is a single class here.
  return new MailCatcherAdapter();
}
