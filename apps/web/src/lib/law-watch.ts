import { ALL_RULES } from "@letsorted/rules";
import { adapters } from "../adapters/index";
import { contentHash } from "../adapters/law-watch/index";
import { withoutAccount } from "./db";

/**
 * Law Watch.
 *
 * Fetches a curated list of source URLs, normalises and hashes the content, and
 * on change stores the diff, asks a model for a plain-English summary, and opens
 * an ADMIN REVIEW TASK.
 *
 * The constitutional bit: **it never edits a rule.** A model noticing that a
 * page changed is not the same as knowing the law changed, and the distance
 * between those two is exactly where a compliance product does real harm. The
 * model's summary is a draft for a human; only an admin publishes, and even then
 * publishing writes a "what changed" note, not a rule.
 */

export type LawWatchRun = {
  checked: number;
  changed: number;
  failed: { url: string; error: string }[];
};

/** Line-level diff. Enough for a human to see what moved, without a dependency. */
export function diffText(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const out: string[] = [];
  for (const line of beforeLines) {
    if (!afterSet.has(line)) out.push(`- ${line}`);
  }
  for (const line of afterLines) {
    if (!beforeSet.has(line)) out.push(`+ ${line}`);
  }
  return out.join("\n");
}

/**
 * Check the watched sources.
 *
 * `sourceIds` narrows the run to specific sources — useful for re-checking one
 * after fixing its URL, rather than re-fetching every source to test one.
 */
export async function runLawWatch(
  options: { sourceIds?: string[] } = {},
): Promise<LawWatchRun> {
  const { lawWatch, llm } = adapters();

  return withoutAccount(async (client) => {
    await client.query("select set_config('app.is_admin', 'true', false)");

    const { rows: sources } = await client.query<{ id: string; label: string; url: string }>(
      `select id, label, url from live_law_watch_sources
        where enabled = true
          and ($1::uuid[] is null or id = any($1::uuid[]))`,
      [options.sourceIds ?? null],
    );

    const result: LawWatchRun = { checked: 0, changed: 0, failed: [] };

    for (const source of sources) {
      result.checked++;

      const fetched = await lawWatch.fetch(source.url);
      if (!fetched.ok) {
        result.failed.push({ url: source.url, error: fetched.error });
        continue;
      }

      const hash = contentHash(fetched.data.text);

      const { rows: previous } = await client.query<{ id: string; content_sha256: string; normalised_text: string }>(
        `select id, content_sha256, normalised_text from law_watch_snapshots
          where source_id = $1 order by fetched_at desc limit 1`,
        [source.id],
      );
      const prior = previous[0];

      // Unchanged: record nothing. Storing a snapshot per poll would bury the
      // real changes in noise and grow without bound.
      if (prior && prior.content_sha256 === hash) continue;

      const { rows: inserted } = await client.query<{ id: string }>(
        `insert into law_watch_snapshots (source_id, content_sha256, normalised_text)
         values ($1, $2, $3) returning id`,
        [source.id, hash, fetched.data.text],
      );
      const snapshotId = inserted[0]!.id;

      // The first sight of a source is a baseline, not a change.
      if (!prior) continue;

      const diff = diffText(prior.normalised_text, fetched.data.text);
      const summary = await llm.summariseLawChange({
        sourceLabel: source.label,
        diff,
        knownRuleIds: ALL_RULES.map((r) => r.id),
      });

      await client.query(
        `insert into law_watch_changes
           (source_id, from_snapshot_id, to_snapshot_id, diff, model_summary,
            affected_rule_ids, review_state)
         values ($1, $2, $3, $4, $5, $6, 'pending')`,
        [
          source.id, prior.id, snapshotId, diff,
          summary.ok ? summary.data.summary : null,
          summary.ok ? summary.data.affected_rule_ids : [],
        ],
      );

      result.changed++;
    }

    await client.query("select set_config('app.is_admin', 'false', false)");
    return result;
  });
}

export type PendingChange = {
  id: string;
  source_label: string;
  source_url: string;
  diff: string;
  model_summary: string | null;
  affected_rule_ids: string[];
  detected_on: string;
  review_state: string;
};

export async function listChanges(
  isAdmin: boolean,
  state: "pending" | "approved" | "all" = "pending",
): Promise<PendingChange[]> {
  return withoutAccount(async (client) => {
    await client.query("select set_config('app.is_admin', $1, false)", [String(isAdmin)]);
    try {
      const { rows } = await client.query<PendingChange>(
        `select c.id, s.label as source_label, s.url as source_url, c.diff,
                c.model_summary, c.affected_rule_ids,
                to_char(c.created_at, 'YYYY-MM-DD') as detected_on,
                c.review_state::text as review_state
           from live_law_watch_changes c
           join law_watch_sources s on s.id = c.source_id
          where ($1 = 'all' or c.review_state::text = $1)
          order by c.created_at desc
          limit 50`,
        [state],
      );
      return rows;
    } finally {
      await client.query("select set_config('app.is_admin', 'false', false)");
    }
  });
}

/**
 * An admin approves or rejects a detected change.
 *
 * Approving publishes a dated "what changed" note to the user-facing feed. It
 * does NOT touch the rule corpus — changing a rule is a code change, reviewed
 * like any other, precisely so that no single click can alter what the product
 * tells people the law is.
 */
export async function reviewChange(
  adminUserId: string,
  changeId: string,
  decision: "approved" | "rejected",
  editedSummary: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (decision === "approved" && (!editedSummary || editedSummary.trim().length < 20)) {
    return {
      ok: false,
      error: "Write a summary in your own words before publishing. The model's draft is a starting point, not the note.",
    };
  }

  return withoutAccount(async (client) => {
    await client.query("select set_config('app.is_admin', 'true', false)");
    try {
      const { rowCount } = await client.query(
        `update law_watch_changes
            set review_state = $2::review_state,
                model_summary = coalesce($3, model_summary),
                reviewed_by = $4, reviewed_at = now(),
                published_at = case when $2 = 'approved' then now() else null end,
                updated_at = now()
          where id = $1 and review_state = 'pending'`,
        [changeId, decision, editedSummary, adminUserId],
      );
      if (!rowCount) return { ok: false as const, error: "That change has already been reviewed." };
      return { ok: true as const };
    } finally {
      await client.query("select set_config('app.is_admin', 'false', false)");
    }
  });
}
