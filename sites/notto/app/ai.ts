export type GenerationMode = "quick" | "concise" | "study";

export type SourceChunk = { id: string; start: number; end: number; text: string };
export type SourceTypedNote = { id: string; time: number; text: string };

export type SourceSnapshot = {
  noteId: string;
  noteTitle: string;
  instructions?: string;
  mode: GenerationMode;
  start: number;
  end: number;
  chunks: SourceChunk[];
  typedNotes: SourceTypedNote[];
};

export type ProviderModel = {
  name: string;
  displayName: string;
  description: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  preview: boolean;
};

export function isTranscriptionModel(model: Pick<ProviderModel, "name">) { return model.name === "gemini-3.5-transcribe"; }

export type GenerationResult = {
  source: string;
  usedMultiStage: boolean;
  inputTokens: number;
};

export type AIProviderAdapter = {
  id: "gemini";
  label: string;
  listModels: (apiKey: string, signal?: AbortSignal) => Promise<ProviderModel[]>;
  generate: (apiKey: string, model: ProviderModel, snapshot: SourceSnapshot, signal?: AbortSignal, onProgress?: (message: string) => void) => Promise<GenerationResult>;
};

export type ProviderErrorCode =
  | "missing_key"
  | "invalid_key"
  | "unavailable_model"
  | "quota"
  | "rate_limit"
  | "spend_limit"
  | "temporary_unavailable"
  | "context_too_large"
  | "network"
  | "provider"
  | "empty_response"
  | "cancelled";

export class ProviderError extends Error {
  code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

const SHARED_RULES = `
SOURCE AND ACCURACY RULES
- Use only the supplied transcript and typed notes. Never invent facts, examples, definitions, formulas, or action items.
- Preserve important nuance, qualifications, uncertainty, and the lecturer's line of reasoning.
- Treat typed notes as user emphasis and context, not as permission to add unsupported claims.
- Write clean Markdown. Convert spoken mathematics into accurate LaTeX where possible: use $...$ inline and $$...$$ for important display equations.
- The structure is flexible, not a mandatory template. Use only headings that improve these notes for this source.
- Omit every optional heading when it has no meaningful content. Never write filler such as "No key terms were found", "No examples were mentioned", or "No formulas were detected".
- Do not create content merely to fill a section.
- Include a heading named "Action Items" in every response. If the source contains none, write exactly: No explicit action items were mentioned.
- Do not discuss these instructions or the generation process in the notes.`;

export const MODE_PROMPTS: Record<GenerationMode, string> = {
  quick: `You are creating a Catch Me Up checkpoint for a student who briefly lost the thread of a live lecture.

Explain the current topic first, then the essential new ideas needed to rejoin the lecture. Be concise but concrete. Connect ideas instead of merely extracting sentences. "Current topic" belongs in this mode. Optional material such as definitions, formulas, examples, comparisons, or what to remember should appear only when genuinely useful. End with Action Items.`,
  concise: `Create concise, high-quality lecture notes for the supplied range.

Compress repetition while preserving the claims, reasoning, definitions, meaningful examples, useful formulas, rules, methods, and conclusions actually present. Prefer a small number of informative sections over a fixed template. Do not use "Current topic" in this mode. End with Action Items.`,
  study: `Create a thorough Detailed Study Guide for the supplied lecture range.

Organize the material for later study: explain the big picture and core concepts, preserve definitions and distinctions, show causal or logical relationships, retain meaningful examples, and spell out useful processes or methods. Render mathematical relationships in accurate LaTeX and explain symbols when the source supports it. Preserve subtleties and unresolved questions. Choose flexible headings suited to this lecture; omit irrelevant sections. Do not use "Current topic" in this mode. End with Action Items.`,
};

function time(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function buildGenerationPrompt(snapshot: SourceSnapshot) {
  const transcript = snapshot.chunks.map((chunk) => `[${time(chunk.start)}–${time(chunk.end)}] ${chunk.text.trim()}`).join("\n\n");
  const notes = snapshot.typedNotes.length
    ? snapshot.typedNotes.map((note) => `[${time(note.time)}] ${note.text.trim()}`).join("\n")
    : "(No typed notes in this range.)";
  return `${MODE_PROMPTS[snapshot.mode]}\n${SHARED_RULES}${snapshot.instructions?.trim() ? `\n\nUSER PREFERENCES (source accuracy still applies)\n${snapshot.instructions.trim().slice(0, 4000)}` : ""}\n\nLECTURE\nTitle: ${snapshot.noteTitle || "Untitled Note"}\nSource start: ${time(snapshot.start)}\nSource end: ${time(snapshot.end)}\n\nTIMESTAMPED TRANSCRIPT\n${transcript || "(No transcript text in this range.)"}\n\nTIMESTAMPED TYPED NOTES\n${notes}`;
}

function isPreview(model: Pick<ProviderModel, "name" | "displayName">) {
  return /preview|experimental|exp\b/i.test(`${model.name} ${model.displayName}`);
}

function suitableModel(raw: { name?: string; displayName?: string; description?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number; outputTokenLimit?: number }): ProviderModel | null {
  if (!raw.name || !raw.supportedGenerationMethods?.includes("generateContent")) return null;
  if (raw.name.replace(/^models\//, "") === "gemini-3.5-transcribe") return { name: "gemini-3.5-transcribe", displayName: raw.displayName || "Gemini 3.5 Transcribe", description: raw.description || "Dedicated speech-to-text model", inputTokenLimit: raw.inputTokenLimit, outputTokenLimit: raw.outputTokenLimit, preview: false };
  const searchable = `${raw.name} ${raw.displayName ?? ""} ${raw.description ?? ""}`;
  if (/imagen|image generation|embedding|embed-|text-embedding|aqa|tts|speech generation|live api|robotics/i.test(searchable)) return null;
  if ((raw.inputTokenLimit ?? 0) < 16000) return null;
  const model = {
    name: raw.name.replace(/^models\//, ""),
    displayName: raw.displayName || raw.name.replace(/^models\//, ""),
    description: raw.description || "",
    inputTokenLimit: raw.inputTokenLimit,
    outputTokenLimit: raw.outputTokenLimit,
    preview: false,
  };
  model.preview = isPreview(model);
  return model;
}

function modelScore(model: ProviderModel) {
  const label = `${model.name} ${model.displayName}`.toLowerCase();
  let score = Math.log2(Math.max(1, model.inputTokenLimit ?? 1));
  if (label.includes("flash")) score += 18;
  if (label.includes("pro")) score += 10;
  if (label.includes("lite")) score -= 14;
  if (model.preview) score -= 9;
  if (/gemini-1\.|gemini-2\.0/.test(label)) score -= 7;
  return score;
}

async function safeErrorMessage(response: Response) {
  try {
    const payload = await response.json() as { error?: { message?: string; status?: string } };
    return `${payload.error?.status ?? ""} ${payload.error?.message ?? ""}`.slice(0, 600);
  } catch {
    return "";
  }
}

function mappedError(status: number, providerMessage: string): ProviderError {
  const lower = providerMessage.toLowerCase();
  if (status === 401 || status === 403 || /api key not valid|invalid api key|permission_denied/.test(lower)) {
    return new ProviderError("invalid_key", "Gemini rejected this API key. Check the key in Google AI Studio and try again.");
  }
  if (status === 404 || /model.+not found|not supported for generatecontent/.test(lower)) {
    return new ProviderError("unavailable_model", "The selected Gemini model is no longer available for text generation. Refresh models and choose another one.");
  }
  if (status === 429) {
    if (/spend|billing|budget|payment|credit|balance/.test(lower)) return new ProviderError("spend_limit", "Google reports a billing or spending limit. Check the project's billing settings; Notto will not switch models for this error.");
    if (/daily|per day|rpd|quota.*exceed|free[_ -]?tier/.test(lower)) return new ProviderError("quota", "Google reports a usage limit for this request. Check this model's usage in AI Studio or retry after the limit resets.");
    return new ProviderError("rate_limit", "Gemini is rate-limiting this project. Wait a moment, then retry.");
  }
  if (status === 400 && /input.*(?:token|size|too long)|(?:context|token).*(?:limit|exceed|too large|too long)|too many input tokens|exceeds.*(?:context|token)/.test(lower)) {
    return new ProviderError("context_too_large", "This source is larger than the selected model can safely process. Choose a model with a larger context window.");
  }
  if (status >= 500) return new ProviderError("temporary_unavailable", "Gemini is temporarily unavailable. Your transcript is safe; retry in a moment.");
  return new ProviderError("provider", "Gemini could not complete this request. Refresh the model list and try again.");
}

function cancelled() {
  return new ProviderError("cancelled", "Generation was cancelled. The source range is ready to retry.");
}

async function retryDelay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) throw cancelled();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function providerFetch(url: string, apiKey: string, init: RequestInit, signal?: AbortSignal, attempt = 0): Promise<Response> {
  if (!apiKey.trim()) throw new ProviderError("missing_key", "Add and test a Gemini API key in Settings before generating notes.");
  if (signal?.aborted) throw cancelled();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 90000);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim(), ...(init.headers ?? {}) } });
    // Consume the body under the same timeout; a stalled body must not strand the UI.
    const body = await response.text();
    response = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch {
    if (signal?.aborted) throw cancelled();
    throw new ProviderError("network", controller.signal.aborted ? "Gemini took too long to respond. The source range is ready to retry." : "Could not reach Gemini. Check your connection and try again; your transcript is safe.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  if (signal?.aborted) throw cancelled();
  if (response.ok) return response;
  const providerMessage = await safeErrorMessage(response);
  const mapped = mappedError(response.status, providerMessage);
  const retryable = (mapped.code === "rate_limit" || response.status >= 500) && attempt < 2;
  if (retryable) {
    await retryDelay(700 * (attempt + 1), signal);
    return providerFetch(url, apiKey, init, signal, attempt + 1);
  }
  throw mapped;
}

export async function listGeminiModels(apiKey: string, signal?: AbortSignal) {
  const available = new Map<string, ProviderModel>();
  const visited = new Set<string>();
  let token = "";
  for (let page = 0; page < 20; page += 1) {
    const response = await providerFetch(`${GEMINI_API}/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, apiKey, { method: "GET", headers: {} }, signal);
    const payload = await response.json() as { models?: Array<Parameters<typeof suitableModel>[0]>; nextPageToken?: string };
    for (const raw of payload.models ?? []) { const model = suitableModel(raw); if (model) available.set(model.name, model); }
    if (!payload.nextPageToken) return [...available.values()].sort((a, b) => modelScore(b) - modelScore(a));
    if (visited.has(payload.nextPageToken)) break;
    token = payload.nextPageToken; visited.add(token);
  }
  throw new ProviderError("provider", "Gemini returned an incomplete model list. Refresh models to retry.");
}

async function countTokens(apiKey: string, model: ProviderModel, text: string, signal?: AbortSignal) {
  const response = await providerFetch(`${GEMINI_API}/models/${encodeURIComponent(model.name)}:countTokens`, apiKey, {
    method: "POST",
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }] }),
  }, signal);
  const payload = await response.json() as { totalTokens?: number };
  if (!Number.isFinite(payload.totalTokens) || (payload.totalTokens ?? -1) < 0) throw new ProviderError("provider", "Gemini did not return an input-size estimate.");
  return payload.totalTokens as number;
}

function responseText(payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> }) {
  return payload.candidates?.[0]?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("\n").trim() ?? "";
}

export function requestThinkingConfig(model: ProviderModel, mode: GenerationMode | "audio") {
  if (/^gemma-4-(?:31b|26b-a4b)-it$/.test(model.name) && mode === "quick") return { thinkingConfig: { thinkingLevel: "minimal" } };
  if (/^gemini-3\.[78]-flash$/.test(model.name)) return { thinkingConfig: { thinkingLevel: mode === "quick" || mode === "audio" ? "low" : "medium" } };
  return {};
}

function generationConfig(mode: GenerationMode, model: ProviderModel) {
  const desired = mode === "quick" ? 2400 : mode === "concise" ? 4800 : 8000;
  return { temperature: model.name.startsWith("gemini-3") ? 1 : 0.25, maxOutputTokens: Math.max(1024, Math.min(desired, model.outputTokenLimit ?? desired)), ...requestThinkingConfig(model, mode) };
}

async function generateText(apiKey: string, model: ProviderModel, prompt: string, mode: GenerationMode, signal?: AbortSignal) {
  const response = await providerFetch(`${GEMINI_API}/models/${encodeURIComponent(model.name)}:generateContent`, apiKey, {
    method: "POST",
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: generationConfig(mode, model) }),
  }, signal);
  const payload = await response.json() as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
  const finish = payload.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP") throw new ProviderError("empty_response", finish === "MAX_TOKENS" ? "Gemini reached its output limit. No incomplete summary was saved; retry with a higher-capacity model." : "Gemini did not complete this response. No summary was saved; retry or choose another model.");
  const rawText = responseText(payload);
  const wrapper = rawText.match(/^```(?:markdown|md)?\s*\n([\s\S]+)\n```$/i);
  const text = (wrapper ? wrapper[1] : rawText).trim();
  if (!text) throw new ProviderError("empty_response", "Gemini returned an empty or malformed response. No summary was saved; retry or choose another model.");
  return text;
}

function hasRequiredStructure(text: string) {
  const hasActions = /(^|\n)#{1,6}\s+Action Items:?\s*($|\n)/i.test(text);
  const hasFiller = /no (?:explicit )?(?:formulas?|examples?|key terms?|comparisons?|relationships?|important ideas?|processes?|rules?) (?:were|was|could be|are|is|detected|found|mentioned|discussed)/i.test(text);
  return hasActions && !hasFiller;
}

async function validateOrRepair(apiKey: string, model: ProviderModel, prompt: string, draft: string, mode: GenerationMode, signal?: AbortSignal) {
  if (hasRequiredStructure(draft)) return draft;
  const repair = `${prompt}\n\nREVISION REQUIRED\nThe draft below came from the model but violates the required output structure. Return a complete corrected version. It must contain an Action Items heading. Omit every other empty or filler section entirely. Do not add unsupported content.\n\nDRAFT\n${draft}`;
  if (await measuredTokens(apiKey, model, repair, signal) > safeInputLimit(model)) throw new ProviderError("context_too_large", "The required revision exceeds this model's safe context window. No incomplete summary was saved; choose a larger-context model and retry.");
  const corrected = await generateText(apiKey, model, repair, mode, signal);
  if (!hasRequiredStructure(corrected)) throw new ProviderError("empty_response", "Gemini's response did not include the required Action Items section or contained empty placeholder sections. No summary was saved; retry or choose another model.");
  return corrected;
}

function estimatedTokens(text: string) {
  return Math.ceil(text.length / 3.5);
}

async function measuredTokens(apiKey: string, model: ProviderModel, text: string, signal?: AbortSignal) {
  try { return await countTokens(apiKey, model, text, signal); }
  catch (error) {
    if (error instanceof ProviderError && ["cancelled", "missing_key", "invalid_key", "unavailable_model", "quota", "rate_limit", "spend_limit", "network", "temporary_unavailable"].includes(error.code)) throw error;
    return estimatedTokens(text);
  }
}

function safeInputLimit(model: ProviderModel) {
  const input = model.inputTokenLimit ?? 100000;
  const outputRoom = Math.min(model.outputTokenLimit ?? 8192, 8192);
  return Math.max(12000, Math.floor(input * 0.88) - outputRoom - 1500);
}

function snapshotForRange(snapshot: SourceSnapshot, chunks: SourceChunk[], start = chunks[0]?.start ?? snapshot.start, end = chunks.at(-1)?.end ?? snapshot.end, includeEnd = true) {
  return { ...snapshot, start, end, chunks, typedNotes: snapshot.typedNotes.filter((note) => note.time >= start && (includeEnd ? note.time <= end : note.time < end)) };
}

async function splitAtChunkBoundaries(apiKey: string, model: ProviderModel, snapshot: SourceSnapshot, limit: number, signal?: AbortSignal) {
  if (!snapshot.chunks.length) {
    const typedGroups: SourceSnapshot[] = [];
    let notes: SourceTypedNote[] = [];
    const target = Math.floor(limit * 0.72);
    for (const note of snapshot.typedNotes) {
      const candidate = { ...snapshot, start: notes[0]?.time ?? note.time, end: note.time, chunks: [], typedNotes: [...notes, note] };
      if (notes.length && estimatedTokens(buildGenerationPrompt(candidate)) > target) {
        typedGroups.push({ ...snapshot, start: notes[0].time, end: notes.at(-1)!.time, chunks: [], typedNotes: notes });
        notes = [note];
      } else notes.push(note);
    }
    if (notes.length) typedGroups.push({ ...snapshot, start: notes[0].time, end: notes.at(-1)!.time, chunks: [], typedNotes: notes });
    for (const group of typedGroups) {
      if (await measuredTokens(apiKey, model, buildGenerationPrompt(group), signal) > limit) throw new ProviderError("context_too_large", "A typed note exceeds this model's safe context window. Split that note or choose a larger-context model; no content was omitted.");
    }
    return typedGroups;
  }

  const chunkGroups: SourceChunk[][] = [];
  let current: SourceChunk[] = [];
  const target = Math.floor(limit * 0.72);
  for (const chunk of snapshot.chunks) {
    const candidate = snapshotForRange(snapshot, [...current, chunk]);
    if (current.length && estimatedTokens(buildGenerationPrompt(candidate)) > target) {
      chunkGroups.push(current);
      current = [chunk];
    } else current.push(chunk);
  }
  if (current.length) chunkGroups.push(current);
  const groups = chunkGroups.map((chunks, index) => snapshotForRange(
    snapshot,
    chunks,
    index === 0 ? snapshot.start : chunks[0].start,
    index === chunkGroups.length - 1 ? snapshot.end : chunkGroups[index + 1][0].start,
    index === chunkGroups.length - 1,
  ));
  for (const group of groups) {
    const tokens = await measuredTokens(apiKey, model, buildGenerationPrompt(group), signal);
    if (tokens > limit) throw new ProviderError("context_too_large", "One natural transcript portion is larger than the selected model can process safely. No content was omitted; split an unusually large transcript chunk or choose a larger-context model.");
  }
  return groups;
}

export async function generateWithGemini(apiKey: string, model: ProviderModel, snapshot: SourceSnapshot, signal?: AbortSignal, onProgress?: (message: string) => void): Promise<GenerationResult> {
  if (isTranscriptionModel(model)) throw new ProviderError("unavailable_model", "This dedicated speech-to-text model cannot write notes. Choose Recommended or a text model.");
  const prompt = buildGenerationPrompt(snapshot);
  onProgress?.("Checking source size…");
  const inputTokens = await measuredTokens(apiKey, model, prompt, signal);
  const limit = safeInputLimit(model);
  if (inputTokens <= limit) {
    onProgress?.("Gemini is writing your notes…");
    const draft = await generateText(apiKey, model, prompt, snapshot.mode, signal);
    return { source: await validateOrRepair(apiKey, model, prompt, draft, snapshot.mode, signal), usedMultiStage: false, inputTokens };
  }

  const groups = await splitAtChunkBoundaries(apiKey, model, snapshot, limit, signal);
  const intermediate: string[] = [];
  for (const [index, group] of groups.entries()) {
    onProgress?.(`Processing lecture portion ${index + 1} of ${groups.length}…`);
    const source = buildGenerationPrompt(group);
    const extractionPrompt = `Create factual intermediate lecture notes for later synthesis. Preserve every important claim, definition, example, formula, process, qualification, question, and action item from this portion. Keep its timestamps. Do not add outside knowledge. This is an extraction pass, so do not force a final-study-guide template.\n\n${source}`;
    intermediate.push(`PORTION ${time(group.start)}–${time(group.end)}\n${await generateText(apiKey, model, extractionPrompt, "concise", signal)}`);
  }
  const synthesisPrompt = `${MODE_PROMPTS[snapshot.mode]}\n${SHARED_RULES}${snapshot.instructions?.trim() ? `\n\nUSER PREFERENCES\n${snapshot.instructions.trim().slice(0, 4000)}` : ""}\n\nThis selected source exceeded the model's safe input capacity and was processed at natural transcript boundaries. Synthesize the complete intermediate notes below into one coherent result. Remove repetition while preserving all important information and timestamps. All portions were processed.\n\nLECTURE\nTitle: ${snapshot.noteTitle || "Untitled Note"}\nSource start: ${time(snapshot.start)}\nSource end: ${time(snapshot.end)}\n\nINTERMEDIATE NOTES\n${intermediate.join("\n\n")}`;
  const synthesisTokens = await measuredTokens(apiKey, model, synthesisPrompt, signal);
  if (synthesisTokens > limit) throw new ProviderError("context_too_large", "Even the complete intermediate notes exceed this model's safe context window. No source was omitted; choose a larger-context model and retry.");
  onProgress?.("Combining all lecture portions…");
  const draft = await generateText(apiKey, model, synthesisPrompt, snapshot.mode, signal);
  return { source: await validateOrRepair(apiKey, model, synthesisPrompt, draft, snapshot.mode, signal), usedMultiStage: true, inputTokens };
}

export const geminiProvider: AIProviderAdapter = {
  id: "gemini",
  label: "Google Gemini",
  listModels: listGeminiModels,
  generate: generateWithGemini,
};
