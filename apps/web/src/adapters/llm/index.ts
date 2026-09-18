import { z } from "zod";
import { env } from "../../lib/env";
import {
  EXTRACT_DOCUMENT_PROMPT_VERSION,
  EXTRACT_DOCUMENT_SYSTEM,
  extractDocumentUserPrompt,
} from "../../prompts/extract-document.v1";
import type { AdapterResult, DocumentExtraction, LlmAdapter } from "../types";

/**
 * LLM adapter.
 *
 * Structured output is validated with Zod before it goes anywhere near the
 * database, and nothing the model produces changes compliance state until a
 * human confirms it in the UI (see .claude/rules/compliance-content.md).
 */

const extractionSchema = z.object({
  kind: z.enum([
    "gas_safety_record", "eicr", "eic", "epc", "licence",
    "deposit_certificate", "tenancy_agreement", "other",
  ]),
  property_address: z.string().nullable(),
  issued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  engineer_id: z.string().nullable(),
  outcome: z.enum(["satisfactory", "unsatisfactory", "not_applicable", "unknown"]),
  observation_codes: z.array(z.string()).default([]),
  epc_rating: z.string().regex(/^[A-G]$/).nullable(),
  confidence: z.record(z.number().min(0).max(1)).default({}),
});

const lawChangeSchema = z.object({
  summary: z.string().min(1).max(2000),
  affected_rule_ids: z.array(z.string()).default([]),
});

const answerSchema = z.object({
  answer: z.string().min(1),
  cited_rule_ids: z.array(z.string()).default([]),
  refused: z.boolean().default(false),
});

/** Call log, so model, prompt version and token counts are recorded per call. */
export type LlmCallRecord = {
  model: string;
  prompt_version: string;
  input_tokens: number;
  output_tokens: number;
  at: string;
};

const callLog: LlmCallRecord[] = [];
export function llmCallLog(): LlmCallRecord[] {
  return [...callLog];
}

export class LiveLlmAdapter implements LlmAdapter {
  async extractDocument(input: {
    filename: string; mimeType: string; content: Buffer | string;
  }): Promise<AdapterResult<DocumentExtraction>> {
    const e = env();
    try {
      // Imported lazily so the SDK is not a hard dependency of a mocked run.
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY! });

      const isImage = input.mimeType.startsWith("image/");
      const content = isImage
        ? [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: input.mimeType as "image/png",
                data: Buffer.isBuffer(input.content) ? input.content.toString("base64") : input.content,
              },
            },
            { type: "text" as const, text: extractDocumentUserPrompt(input.filename) },
          ]
        : [
            {
              type: "text" as const,
              text: `${extractDocumentUserPrompt(input.filename)}\n\n---\n${String(input.content).slice(0, 50_000)}`,
            },
          ];

      const res = await client.messages.create({
        model: e.ANTHROPIC_MODEL_FAST,
        max_tokens: 2048,
        system: EXTRACT_DOCUMENT_SYSTEM,
        messages: [{ role: "user", content }],
      });

      callLog.push({
        model: e.ANTHROPIC_MODEL_FAST,
        prompt_version: EXTRACT_DOCUMENT_PROMPT_VERSION,
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        at: new Date().toISOString(),
      });

      const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      const parsed = extractionSchema.safeParse(JSON.parse(stripFence(text)));
      if (!parsed.success) {
        return { ok: false, error: `Model output did not match the schema: ${parsed.error.message}`, source: "live" };
      }
      return { ok: true, data: parsed.data, source: "live" };
    } catch (err) {
      return { ok: false, error: (err as Error).message, source: "live" };
    }
  }

  async summariseLawChange(input: { sourceLabel: string; diff: string; knownRuleIds: string[] }) {
    const e = env();
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY! });
      const res = await client.messages.create({
        model: e.ANTHROPIC_MODEL_REASONING,
        max_tokens: 1500,
        system:
          "You summarise changes to UK housing law sources for landlords in plain English. " +
          "State only what changed in the text you are given. Never infer a new legal requirement. " +
          "Suggest which of the supplied rule IDs might be affected. Respond with JSON only.",
        messages: [
          {
            role: "user",
            content: `Source: ${input.sourceLabel}\nKnown rule IDs: ${input.knownRuleIds.join(", ")}\n\nDiff:\n${input.diff.slice(0, 40_000)}`,
          },
        ],
      });
      const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      const parsed = lawChangeSchema.safeParse(JSON.parse(stripFence(text)));
      if (!parsed.success) return { ok: false as const, error: parsed.error.message, source: "live" as const };
      return { ok: true as const, data: parsed.data, source: "live" as const };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message, source: "live" as const };
    }
  }

  async answerQuestion(input: { question: string; context: string }) {
    const e = env();
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY! });
      const res = await client.messages.create({
        model: e.ANTHROPIC_MODEL_REASONING,
        max_tokens: 1200,
        system:
          "You answer questions about a landlord's own compliance position using ONLY the supplied " +
          "rules and data. Cite rule IDs inline. If the question needs a solicitor — possession " +
          "strategy, a dispute, tax — set refused true and say who to ask instead. " +
          "Never give legal advice. Respond with JSON only.",
        messages: [{ role: "user", content: `Context:\n${input.context}\n\nQuestion: ${input.question}` }],
      });
      const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      const parsed = answerSchema.safeParse(JSON.parse(stripFence(text)));
      if (!parsed.success) return { ok: false as const, error: parsed.error.message, source: "live" as const };
      return { ok: true as const, data: parsed.data, source: "live" as const };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message, source: "live" as const };
    }
  }
}

function stripFence(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fence?.[1] ?? text).trim();
}

/**
 * Deterministic mock.
 *
 * Reads plausible values out of the filename and any text content so the
 * Cert Inbox demo is genuinely exercisable with no key. Confidence values are
 * deliberately mixed, including at least one low-confidence field, so the
 * side-by-side confirm screen has something to highlight.
 */
export class MockLlmAdapter implements LlmAdapter {
  async extractDocument(input: {
    filename: string; mimeType: string; content: Buffer | string;
  }): Promise<AdapterResult<DocumentExtraction>> {
    const name = input.filename.toLowerCase();
    const text = Buffer.isBuffer(input.content) ? input.content.toString("utf8") : String(input.content);
    const haystack = `${name} ${text.slice(0, 5000)}`.toLowerCase();

    const kind: DocumentExtraction["kind"] =
      /gas|cp12/.test(haystack) ? "gas_safety_record"
      : /eicr|condition report/.test(haystack) ? "eicr"
      : /\beic\b|installation certificate/.test(haystack) ? "eic"
      : /epc|energy performance/.test(haystack) ? "epc"
      : /licence|license/.test(haystack) ? "licence"
      : /deposit/.test(haystack) ? "deposit_certificate"
      : /tenancy agreement/.test(haystack) ? "tenancy_agreement"
      : "other";

    const issued = firstIsoDate(text) ?? deterministicDate(input.filename, 0);
    const expires =
      kind === "gas_safety_record" ? addYearsIso(issued, 1)
      : kind === "eicr" || kind === "eic" ? addYearsIso(issued, 5)
      : kind === "epc" ? addYearsIso(issued, 10)
      : null;

    const unsatisfactory = /unsatisfactory|\bc1\b|\bc2\b/.test(haystack);

    return {
      ok: true,
      source: "mock",
      data: {
        kind,
        property_address: firstAddress(text),
        issued_on: issued,
        expires_on: expires,
        engineer_id: /gas/.test(haystack) ? "123456" : null,
        outcome: kind === "eicr" || kind === "eic"
          ? (unsatisfactory ? "unsatisfactory" : "satisfactory")
          : "unknown",
        observation_codes: unsatisfactory ? ["C2"] : [],
        epc_rating: kind === "epc" ? "C" : null,
        confidence: {
          kind: 0.96,
          issued_on: 0.91,
          expires_on: kind === "gas_safety_record" ? 0.88 : 0.72,
          // Address matching is the field that most often needs a human eye,
          // so the mock keeps it low to exercise the confirm screen.
          property_address: 0.48,
          outcome: kind === "eicr" ? 0.93 : 0.4,
        },
      },
    };
  }

  async summariseLawChange(input: { sourceLabel: string; diff: string; knownRuleIds: string[] }) {
    const added = input.diff.split("\n").filter((l) => l.startsWith("+")).length;
    const removed = input.diff.split("\n").filter((l) => l.startsWith("-")).length;
    return {
      ok: true as const,
      source: "mock" as const,
      data: {
        summary:
          `The page "${input.sourceLabel}" changed: ${added} line(s) added and ${removed} removed. ` +
          `This is a mock summary generated without a model, for review only. ` +
          `An admin must read the diff before anything is published.`,
        affected_rule_ids: input.knownRuleIds.slice(0, 2),
      },
    };
  }

  async answerQuestion(input: { question: string; context: string }) {
    const needsSolicitor = /possession|evict|court|dispute|tax|sue/i.test(input.question);
    if (needsSolicitor) {
      return {
        ok: true as const,
        source: "mock" as const,
        data: {
          answer:
            "That one needs a solicitor or your local authority rather than us. " +
            "We can tell you what is on file and what is due, but not what to do in a dispute.",
          cited_rule_ids: [],
          refused: true,
        },
      };
    }
    const cited = [...input.context.matchAll(/\b([A-Z]{3,4}-[A-Z0-9-]+)\b/g)].map((m) => m[1]!).slice(0, 3);
    return {
      ok: true as const,
      source: "mock" as const,
      data: {
        answer:
          "This is a mock answer produced without a model, from your own data only. " +
          (cited.length ? `The relevant rules are ${cited.join(", ")}.` : "No specific rule matched your question."),
        cited_rule_ids: cited,
        refused: false,
      },
    };
  }
}

function firstIsoDate(text: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return iso[0]!;
  const uk = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(text);
  if (uk) return `${uk[3]}-${uk[2]}-${uk[1]}`;
  return null;
}

function firstAddress(text: string): string | null {
  const m = /\b(\d+[A-Za-z]?\s+[A-Z][A-Za-z]+(?:\s+(?:Road|Street|Lane|Avenue|Close|Way|Drive|Court)))\b/.exec(text);
  return m?.[1] ?? null;
}

/** Stable pseudo-date from a filename, so mock output does not change per run. */
function deterministicDate(seed: string, offsetDays: number): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const base = Date.UTC(2026, 0, 1) + ((h % 300) + offsetDays) * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}

function addYearsIso(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y! + years, m! - 1, d!));
  // Clamp 29 Feb to 28 Feb in a common year rather than rolling into March.
  if (target.getUTCMonth() !== m! - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

export function llmAdapter(mode: "live" | "mock"): LlmAdapter {
  return mode === "live" ? new LiveLlmAdapter() : new MockLlmAdapter();
}
