/**
 * Structured-AI narrative generation via the Vercel AI SDK. Schema-validated
 * output (retried on invalid); routed through the Vercel AI Gateway when
 * configured, otherwise a direct provider. Model id comes from env — never
 * hard-coded. The engine's numbers are authoritative; this only explains them.
 */
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  buildNarrativePrompt,
  NARRATIVE_PROMPT_VERSION,
  NARRATIVE_SCHEMA_VERSION,
  reportNarrativeSchema,
  type ReportNarrative,
} from "./narrative";
import type { ReportDataset } from "./types";

export interface NarrativeProvenance {
  provider: string;
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  usage: unknown;
  generationMs: number;
}

export interface NarrativeResult {
  narrative: ReportNarrative;
  provenance: NarrativeProvenance;
}

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY);
}

export async function generateNarrative(ds: ReportDataset): Promise<NarrativeResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("AI not configured: set AI_GATEWAY_API_KEY (or OPENAI_API_KEY).");
  }
  // Verify the current available model list before setting this in production.
  const modelId = process.env.AI_REPORT_MODEL ?? "openai/gpt-4o-mini";
  const baseURL = process.env.AI_GATEWAY_BASE_URL; // Vercel AI Gateway endpoint (optional)

  const provider = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  // With the gateway keep the provider-prefixed id; direct OpenAI wants the bare name.
  const modelName =
    !baseURL && modelId.includes("/") ? modelId.split("/").pop()! : modelId;

  const { system, prompt } = buildNarrativePrompt(ds);
  const started = Date.now();
  const result = await generateText({
    model: provider(modelName),
    system,
    prompt,
    experimental_output: Output.object({ schema: reportNarrativeSchema }),
    maxRetries: 2,
    temperature: 0.2,
  });

  return {
    narrative: result.experimental_output,
    provenance: {
      provider: baseURL ? "vercel-ai-gateway" : "openai",
      modelId,
      promptVersion: NARRATIVE_PROMPT_VERSION,
      schemaVersion: NARRATIVE_SCHEMA_VERSION,
      usage: result.usage,
      generationMs: Date.now() - started,
    },
  };
}
