import { buildGenerationPrompt, isTranscriptionModel, ProviderError, type ProviderModel, type SourceSnapshot } from "./ai.ts";

export type ModelSelection = "recommended" | "manual";
export type ModelTask = "quick" | "notes" | "audio";
export type ModelPreferences = { selectedModel: string; modelSelection: ModelSelection; autoFallback: boolean; saveKey: boolean };

// Order is intentional, not inferred from context-window size or a model's name.
// The owner's Oct 4, 2026 screenshots show 20 RPD for 3.8/3.7 Flash and
// 14,400 RPD / 16K input TPM for these Gemma models. Other projects may differ.
const BASIC_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
const QUICK_MODELS = ["gemma-4-31b-it", "gemma-4-26b-a4b-it", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", ...BASIC_MODELS];
const AUDIO_MODELS = new Set(["gemini-3.5-transcribe", ...BASIC_MODELS, "gemini-3-flash-preview", "gemini-3.1-pro-preview", "gemini-2.5-pro"]);
export const MAX_MODEL_ATTEMPTS = 3;
export const QUICK_PROMPT_BYTE_LIMIT = 12000;

export function parseModelPreferences(raw: string | null): ModelPreferences {
  const defaults: ModelPreferences = { selectedModel: "", modelSelection: "recommended", autoFallback: true, saveKey: false };
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
    const selectedModel = typeof value.selectedModel === "string" ? value.selectedModel : "";
    return {
      selectedModel,
      // Older versions could not distinguish a manual choice from their default.
      // Keep saved choices rather than silently replacing an existing preference.
      modelSelection: value.modelSelection === "recommended" ? "recommended" : value.modelSelection === "manual" || selectedModel ? "manual" : "recommended",
      autoFallback: value.autoFallback !== false,
      saveKey: value.saveKey === true,
    };
  } catch { return defaults; }
}

export function supportsAudio(model: ProviderModel) { return AUDIO_MODELS.has(model.name); }

export function taskForSnapshot(snapshot: SourceSnapshot): ModelTask {
  // This is a conservative routing threshold, not a context limit or a claim
  // about remaining quota. Include instructions/notes and account for Unicode.
  return snapshot.mode === "quick" && new TextEncoder().encode(buildGenerationPrompt(snapshot)).byteLength <= QUICK_PROMPT_BYTE_LIMIT ? "quick" : "notes";
}

export function modelCandidates(models: ProviderModel[], task: ModelTask, preferences: Pick<ModelPreferences, "modelSelection" | "selectedModel" | "autoFallback"> & { transcriptionInstructions?: string }): ProviderModel[] {
  const textModels = models.filter((model) => !isTranscriptionModel(model));
  const eligible = task === "audio" ? models.filter((model) => supportsAudio(model) && (!preferences.transcriptionInstructions?.trim() || !isTranscriptionModel(model))) : task === "notes" && preferences.modelSelection === "recommended" ? textModels.filter((model) => !model.name.startsWith("gemma-")) : textModels;
  const byName = new Map(eligible.map((model) => [model.name, model]));
  const curated = [...new Set(task === "quick" ? QUICK_MODELS : task === "audio" ? ["gemini-3.5-transcribe", ...BASIC_MODELS] : BASIC_MODELS)].flatMap((name) => byName.has(name) ? [byName.get(name)!] : []);
  const primary = preferences.modelSelection === "manual"
    ? byName.get(preferences.selectedModel)
    : curated[0] ?? eligible.find((model) => !model.preview) ?? eligible[0];
  // Do not silently replace an incompatible manual selection (e.g. Gemma audio).
  if (!primary) return [];
  return [primary, ...(preferences.autoFallback ? curated.filter((model) => model.name !== primary.name) : [])].slice(0, MAX_MODEL_ATTEMPTS);
}

export function defaultModel(models: ProviderModel[]) {
  const preferences = { modelSelection: "recommended" as const, selectedModel: "", autoFallback: false };
  return modelCandidates(models, "notes", preferences)[0] ?? modelCandidates(models, "quick", preferences)[0];
}

const FALLBACK_REASONS: Partial<Record<ProviderError["code"], string>> = {
  quota: "usage limit reached", rate_limit: "rate limit reached", unavailable_model: "model unavailable",
  temporary_unavailable: "service temporarily unavailable", context_too_large: "source needs more capacity",
};

export async function withModelFallback<T>(
  candidates: ProviderModel[],
  operation: (model: ProviderModel, attempt: number) => Promise<T>,
  signal?: AbortSignal,
  onAttempt?: (model: ProviderModel, attempt: number, reason?: string) => void,
): Promise<{ value: T; model: ProviderModel; attemptedModels: string[] }> {
  const unique = [...new Map(candidates.map((model) => [model.name, model])).values()].slice(0, MAX_MODEL_ATTEMPTS);
  const attemptedModels: string[] = [];
  let reason: string | undefined;
  let lastError: unknown;
  for (const [index, model] of unique.entries()) {
    if (signal?.aborted) throw new ProviderError("cancelled", "Request cancelled. No result was saved.");
    attemptedModels.push(model.name);
    onAttempt?.(model, index, reason);
    try {
      const value = await operation(model, index);
      if (signal?.aborted) throw new ProviderError("cancelled", "Request cancelled. No result was saved.");
      return { value, model, attemptedModels };
    } catch (error) {
      if (signal?.aborted) throw new ProviderError("cancelled", "Request cancelled. No result was saved.");
      reason = error instanceof ProviderError ? FALLBACK_REASONS[error.code] : undefined;
      if (!reason) throw error;
      lastError = error;
    }
  }
  if (lastError instanceof ProviderError) throw new ProviderError(lastError.code, `${lastError.message}${attemptedModels.length > 1 ? ` Tried ${attemptedModels.length} models; no result was saved. Check Google AI Studio usage or choose a model in Settings.` : ""}`);
  throw new ProviderError("unavailable_model", "No compatible model is selected. Refresh models or choose Recommended in AI settings.");
}
