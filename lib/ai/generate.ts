import "server-only";
import { generateObject } from "ai";
import type { z } from "zod";
import {
  MODEL_IDS,
  fallbackModel,
  hasFallback,
  hasPrimary,
  primaryModel,
} from "@/lib/ai/model";

export type CallMeta = {
  model: string;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  attempts: number;
};

export type StructuredRequest<S extends z.ZodType> = {
  /** Short stable name used in agent_events, e.g. "draft_writer". */
  name: string;
  /** Bump when the prompt text changes materially. */
  promptVersion: string;
  schema: S;
  instructions: string;
  prompt: string;
  temperature?: number;
};

export class AiUnavailableError extends Error {
  constructor(message = "No LLM provider is configured. Set GROQ_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/**
 * Structured generation with provider fallback.
 * Tries Groq first, then Gemini. Returns the parsed object plus call metadata
 * so callers can log to agent_events without re-deriving anything.
 */
export async function generateStructured<S extends z.ZodType>(
  req: StructuredRequest<S>,
): Promise<{ object: z.infer<S>; meta: CallMeta }> {
  const started = Date.now();
  const candidates: Array<{ id: string; make: () => ReturnType<typeof primaryModel> }> = [];
  if (hasPrimary()) candidates.push({ id: MODEL_IDS.primary, make: primaryModel });
  if (hasFallback()) candidates.push({ id: MODEL_IDS.fallback, make: fallbackModel });
  if (candidates.length === 0) throw new AiUnavailableError();

  let lastError: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const result = await generateObject({
        model: candidate.make(),
        schema: req.schema,
        instructions: req.instructions,
        prompt: req.prompt,
        temperature: req.temperature ?? 0.4,
        maxRetries: 1,
      });
      return {
        object: result.object as z.infer<S>,
        meta: {
          model: candidate.id,
          promptVersion: req.promptVersion,
          tokensIn: result.usage?.inputTokens ?? 0,
          tokensOut: result.usage?.outputTokens ?? 0,
          latencyMs: Date.now() - started,
          attempts: i + 1,
        },
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`All model providers failed for ${req.name}`);
}

export type FileInput = {
  /** Raw bytes of the document. */
  data: Uint8Array;
  mediaType: "application/pdf" | "image/png" | "image/jpeg";
  filename?: string;
};

/**
 * Structured extraction from a document (PDF or image). Gemini only; throws
 * AiUnavailableError when no Google key is configured.
 */
export async function generateStructuredFromFile<S extends z.ZodType>(
  req: Omit<StructuredRequest<S>, "prompt"> & { prompt: string; file: FileInput },
): Promise<{ object: z.infer<S>; meta: CallMeta }> {
  const { hasVision, visionModel, VISION_MODEL_ID } = await import("@/lib/ai/model");
  if (!hasVision()) throw new AiUnavailableError("Document extraction needs GOOGLE_GENERATIVE_AI_API_KEY.");
  const started = Date.now();
  const result = await generateObject({
    model: visionModel(),
    schema: req.schema,
    instructions: req.instructions,
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: req.file.data, mediaType: req.file.mediaType, filename: req.file.filename },
          { type: "text", text: req.prompt },
        ],
      },
    ],
    temperature: req.temperature ?? 0,
    maxRetries: 1,
  });
  return {
    object: result.object as z.infer<S>,
    meta: {
      model: VISION_MODEL_ID,
      promptVersion: req.promptVersion,
      tokensIn: result.usage?.inputTokens ?? 0,
      tokensOut: result.usage?.outputTokens ?? 0,
      latencyMs: Date.now() - started,
      attempts: 1,
    },
  };
}
