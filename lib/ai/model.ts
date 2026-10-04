import "server-only";
import { createGroq } from "@ai-sdk/groq";
import { createGoogle } from "@ai-sdk/google";
import { optionalEnv, requireEnv } from "@/lib/env";

/**
 * Model ids are configuration, never hard-coded in prompts or callers.
 * Groq (gpt-oss) is the primary text model: fast, free tier 30 RPM / 8K TPM.
 * Gemini Flash-Lite is the fallback and the vision/PDF model.
 */
export const MODEL_IDS = {
  primary: optionalEnv("AI_PRIMARY_MODEL") ?? "openai/gpt-oss-20b",
  fallback: optionalEnv("AI_FALLBACK_MODEL") ?? "gemini-3.5-flash-lite",
} as const;

export function primaryModel() {
  const groq = createGroq({ apiKey: requireEnv("GROQ_API_KEY") });
  return groq(MODEL_IDS.primary);
}

export function fallbackModel() {
  const google = createGoogle({
    apiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
  });
  return google(MODEL_IDS.fallback);
}

export function hasFallback() {
  return Boolean(optionalEnv("GOOGLE_GENERATIVE_AI_API_KEY"));
}

export function hasPrimary() {
  return Boolean(optionalEnv("GROQ_API_KEY"));
}

/**
 * Vision-capable model for document extraction. Only Gemini on the free
 * tier can read PDFs and images, so there is no Groq fallback here.
 */
export const VISION_MODEL_ID = optionalEnv("AI_VISION_MODEL") ?? "gemini-3.5-flash-lite";

export function visionModel() {
  const google = createGoogle({
    apiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
  });
  return google(VISION_MODEL_ID);
}

export function hasVision() {
  return Boolean(optionalEnv("GOOGLE_GENERATIVE_AI_API_KEY"));
}
