import test from "node:test";
import assert from "node:assert/strict";
import { ProviderError, generateWithGemini, listGeminiModels, providerFetch } from "../app/ai.ts";
import { defaultModel, modelCandidates, parseModelPreferences, taskForSnapshot, withModelFallback, QUICK_PROMPT_BYTE_LIMIT } from "../app/model-policy.ts";
import { parseNativeTranscript, transcribeAudio, transcriptionSetup } from "../app/transcription.ts";
import { makeBackup, parseBackup } from "../app/notebook.ts";

const names = ["gemini-2.5-pro", "gemini-3.1-flash-lite", "gemma-4-26b-a4b-it", "gemini-3.7-flash", "gemma-4-31b-it", "gemini-3.8-flash"];
const models = names.map((name) => ({ name, displayName: name, description: "", inputTokenLimit: name.startsWith("gemma") ? 262144 : 1048576, outputTokenLimit: 65536, preview: false }));
const recommended = { modelSelection: "recommended", selectedModel: "", autoFallback: true };
const source = { noteId: "n", noteTitle: "Lecture", mode: "quick", start: 0, end: 60, chunks: [{ id: "a", start: 0, end: 60, text: "Recall the idea first, then check the source." }], typedNotes: [] };
const completeText = "## Current topic\nRecall practice.\n\n## Action Items\nNo explicit action items were mentioned.";
const candidates = (task, prefs = recommended, available = models) => modelCandidates(available, task, prefs);

test("recommended defaults favor capacity for Basic and high allowance for short checkpoints", () => {
  assert.equal(defaultModel(models).name, "gemini-3.8-flash");
  assert.deepEqual(candidates("notes").map((model) => model.name), ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.1-flash-lite"]);
  assert.deepEqual(candidates("quick").map((model) => model.name), ["gemma-4-31b-it", "gemma-4-26b-a4b-it", "gemini-3.1-flash-lite"]);
  assert.deepEqual(candidates("audio").map((model) => model.name), ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.1-flash-lite"]);
  assert.equal(defaultModel([...models].reverse()).name, "gemini-3.8-flash");
});

test("long or Unicode-heavy checkpoints and instructions use Basic without dropping content", () => {
  assert.equal(taskForSnapshot(source), "quick");
  assert.equal(taskForSnapshot({ ...source, mode: "concise" }), "notes");
  assert.equal(taskForSnapshot({ ...source, mode: "study" }), "notes");
  const long = { ...source, chunks: [{ ...source.chunks[0], text: "中".repeat(QUICK_PROMPT_BYTE_LIMIT / 3) }] };
  assert.equal(taskForSnapshot(long), "notes");
  assert.equal(long.chunks[0].text.length, QUICK_PROMPT_BYTE_LIMIT / 3);
  assert.equal(taskForSnapshot({ ...source, instructions: "字".repeat(4000) }), "notes");
  assert.equal(candidates(taskForSnapshot(long))[0].name, "gemini-3.8-flash");
});

test("only available compatible models are selected; missing favorites do not break connection", () => {
  const available = models.filter((model) => !["gemini-3.8-flash", "gemma-4-31b-it"].includes(model.name));
  assert.equal(defaultModel(available).name, "gemini-3.7-flash");
  assert.equal(candidates("quick", recommended, available)[0].name, "gemma-4-26b-a4b-it");
  assert.deepEqual(candidates("audio", recommended, models.filter((model) => model.name.startsWith("gemma"))), []);
  assert.deepEqual(candidates("notes", recommended, models.filter((model) => model.name.startsWith("gemma"))), []);
  assert.equal(defaultModel(models.filter((model) => model.name.startsWith("gemma"))).name, "gemma-4-31b-it");
  assert.equal(defaultModel([]), undefined);
});

test("manual selections and fallback opt-out survive storage migration", () => {
  const legacy = parseModelPreferences(JSON.stringify({ selectedModel: "gemini-2.5-pro", saveKey: true }));
  assert.equal(legacy.modelSelection, "manual");
  assert.equal(candidates("notes", legacy)[0].name, "gemini-2.5-pro");
  const manualGemma = { modelSelection: "manual", selectedModel: "gemma-4-31b-it", autoFallback: false };
  assert.equal(candidates("notes", manualGemma).length, 1);
  assert.deepEqual(candidates("audio", manualGemma), []);
  const saved = { ...recommended, selectedModel: "gemini-3.8-flash", autoFallback: false, saveKey: false };
  assert.deepEqual(parseModelPreferences(JSON.stringify(saved)), saved);
  assert.equal(candidates("quick", saved).length, 1);
  for (const raw of [null, "{bad", "[]", "null", "42"]) assert.equal(parseModelPreferences(raw).modelSelection, "recommended");
  assert.equal(parseModelPreferences('{"saveKey":"true"}').saveKey, false);
});

test("real-shaped generation falls back on quota and keeps the complete source and actual model", async () => {
  const original = globalThis.fetch;
  const prompts = [];
  const attempts = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith(":countTokens")) return Response.json({ totalTokens: 1000 });
    prompts.push(JSON.parse(init.body).contents[0].parts[0].text);
    if (String(url).includes("gemma-4-31b-it")) return Response.json({ error: { message: "Daily quota exceeded for this model" } }, { status: 429 });
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: completeText }] } }] });
  };
  try {
    const result = await withModelFallback(candidates("quick"), (model) => generateWithGemini("test-key", model, source), undefined, (model, attempt, reason) => attempts.push({ name: model.name, attempt, reason }));
    assert.equal(result.model.name, "gemma-4-26b-a4b-it");
    assert.equal(result.value.source, completeText);
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0], prompts[1]);
    assert.match(prompts[1], /Recall the idea first/);
    assert.equal(attempts[1].reason, "usage limit reached");
    const note = { id: "n", title: "Lecture", createdAt: 1, updatedAt: 2, chunks: source.chunks, typedNotes: [], summarizedThrough: 60, summaries: [{ id: "s", kind: "quick", start: 0, end: 60, createdAt: 2, source: result.value.source, model: result.model.name, fallbackFrom: result.attemptedModels.slice(0, -1) }] };
    assert.deepEqual(parseBackup(makeBackup([note]))[0].summaries[0].fallbackFrom, ["gemma-4-31b-it"]);
    assert.equal(parseBackup(makeBackup([note]))[0].summaries[0].model, "gemma-4-26b-a4b-it");
  } finally { globalThis.fetch = original; }
});

test("audio fallbacks preserve the clip and prompt and never call Gemma", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).includes("gemini-3.8-flash")) return Response.json({ error: { message: "Daily quota exceeded" } }, { status: 429 });
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"segments":[{"start":0,"end":1,"text":"Hello"}]}' }] } }] });
  };
  try {
    const result = await withModelFallback(candidates("audio"), (model) => transcribeAudio("test-key", model, new Blob(["abc"], { type: "audio/wav" }), "Keep names.", "en-US", 2));
    assert.equal(result.model.name, "gemini-3.7-flash");
    assert.deepEqual(result.value, [{ start: 0, end: 1, text: "Hello" }]);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => !call.url.includes("gemma")));
    assert.deepEqual(calls[0].body.contents, calls[1].body.contents);
    assert.equal(calls[0].body.generationConfig.temperature, 1);
    assert.deepEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingLevel: "low" });
    await assert.rejects(transcribeAudio("test-key", models.find((model) => model.name === "gemma-4-31b-it"), new Blob(["abc"], { type: "audio/wav" }), "", "en-US", 2), /does not accept audio/);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});

test("authentication, spending, network, malformed and incomplete results stop without a fallback", async () => {
  for (const code of ["invalid_key", "missing_key", "spend_limit", "network", "provider", "empty_response", "cancelled"]) {
    let calls = 0;
    await assert.rejects(withModelFallback(candidates("notes"), async () => { calls++; throw new ProviderError(code, "Stop here"); }), (error) => error.code === code);
    assert.equal(calls, 1, code);
  }
  let calls = 0;
  await assert.rejects(withModelFallback(candidates("notes"), async () => { calls++; throw new Error("Invalid transcript"); }), /Invalid transcript/);
  assert.equal(calls, 1);
});

test("cancellation stops before a call, between models, and before accepting a late result", async () => {
  let calls = 0;
  await assert.rejects(withModelFallback(candidates("notes"), async () => { calls++; }, AbortSignal.abort()), (error) => error.code === "cancelled");
  assert.equal(calls, 0);
  for (const fail of [true, false]) {
    const controller = new AbortController(); calls = 0;
    await assert.rejects(withModelFallback(candidates("notes"), async () => { calls++; controller.abort(); if (fail) throw new ProviderError("quota", "Limit"); return "late"; }, controller.signal), (error) => error.code === "cancelled");
    assert.equal(calls, 1);
  }
});

test("fallbacks are deduplicated, bounded and explain exhaustion without creating a result", async () => {
  const attempts = [];
  await assert.rejects(withModelFallback([models[0], models[0], ...models], async (model) => { attempts.push(model.name); throw new ProviderError("unavailable_model", "Model unavailable"); }), (error) => error.code === "unavailable_model" && /Tried 3 models/.test(error.message));
  assert.equal(attempts.length, 3);
  assert.equal(new Set(attempts).size, 3);
  const result = await withModelFallback(candidates("notes"), async (model) => { if (model.name === "gemini-3.8-flash") throw new ProviderError("temporary_unavailable", "Unavailable"); return "complete"; });
  assert.equal(result.model.name, "gemini-3.7-flash");
});

test("provider spending limits and invalid configurations are not disguised as context or quota fallbacks", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { message: "Project spending limit exceeded" } }, { status: 429 }); };
  try {
    await assert.rejects(withModelFallback(candidates("notes"), (model) => generateWithGemini("key", model, { ...source, mode: "concise" })), (error) => error.code === "spend_limit");
    assert.equal(calls, 1); // includes the countTokens path: the error must not be swallowed
    globalThis.fetch = async () => { calls++; return Response.json({ error: { message: "Invalid generation_config.max_output_tokens" } }, { status: 400 }); };
    await assert.rejects(withModelFallback(candidates("notes"), () => providerFetch("https://example.invalid", "key", { method: "POST" })), (error) => error.code === "provider");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("quick Gemma requests disable thinking and Gemini 3 defaults use Google's recommended temperature", async () => {
  const original = globalThis.fetch;
  const configs = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith(":countTokens")) return Response.json({ totalTokens: 1000 });
    configs.push(JSON.parse(init.body).generationConfig);
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: completeText }] } }] });
  };
  try {
    await generateWithGemini("key", candidates("quick")[0], source);
    await generateWithGemini("key", candidates("notes")[0], { ...source, mode: "concise" });
    assert.deepEqual(configs[0].thinkingConfig, { thinkingLevel: "minimal" });
    assert.equal(configs[1].temperature, 1);
    assert.deepEqual(configs[1].thinkingConfig, { thinkingLevel: "medium" });
  } finally { globalThis.fetch = original; }
});

const dedicatedModel = { name: "gemini-3.5-transcribe", displayName: "Gemini 3.5 Transcribe", description: "Dedicated speech-to-text", preview: false };
const nativeParts = [{ text: "Hello world.", audioTranscription: { words: [{ word: "Hello", startOffset: "0.100s", endOffset: "0.450s" }, { word: "world.", startOffset: "0.500s", endOffset: "0.850s" }] } }];

test("dedicated transcription is discovered without a text context limit and never selected for notes", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ models: [{ name: "models/gemini-3.5-transcribe", displayName: dedicatedModel.displayName, supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.5-transcribe-live", supportedGenerationMethods: ["bidiGenerateContent"] }] });
  try {
    const listed = await listGeminiModels("key");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, dedicatedModel.name);
    assert.deepEqual(candidates("audio", recommended, [dedicatedModel, ...models]).map((model) => model.name), ["gemini-3.5-transcribe", "gemini-3.8-flash", "gemini-3.7-flash"]);
    assert.ok(candidates("quick", recommended, [dedicatedModel, ...models]).every((model) => model.name !== dedicatedModel.name));
    assert.ok(candidates("notes", recommended, [dedicatedModel, ...models]).every((model) => model.name !== dedicatedModel.name));
    assert.equal(candidates("audio", { ...recommended, transcriptionInstructions: "Preserve filler words." }, [dedicatedModel, ...models])[0].name, "gemini-3.8-flash");
  } finally { globalThis.fetch = original; }
});

test("dedicated speech-to-text uses its own config and actual provider word timestamps", async () => {
  const original = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, init) => { body = JSON.parse(init.body); return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: nativeParts } }] }); };
  try {
    const result = await transcribeAudio("key", dedicatedModel, new Blob(["abc"], { type: "audio/wav" }), "", "en-US", 2);
    assert.deepEqual(result, [{ start: 0.1, end: 0.85, text: "Hello world." }]);
    assert.equal(body.contents[0].parts.length, 1);
    assert.equal(body.contents[0].parts[0].inlineData.data, "YWJj");
    assert.deepEqual(body.generationConfig, { audioTranscriptionConfig: { languageCodes: ["en-US"], wordTimestamp: true } });
    await assert.rejects(generateWithGemini("key", dedicatedModel, source), /cannot write notes/);
    await assert.rejects(transcribeAudio("key", dedicatedModel, new Blob(["abc"], { type: "audio/wav" }), "Do something else", "en-US", 2), /does not accept free-form prompts/);
  } finally { globalThis.fetch = original; }
});

test("browser locales become accepted native language hints or automatic detection", () => {
  assert.deepEqual(transcriptionSetup(dedicatedModel, "", "es-ES").generationConfig.audioTranscriptionConfig.languageCodes, []);
  assert.deepEqual(transcriptionSetup(dedicatedModel, "", "zh-TW").generationConfig.audioTranscriptionConfig.languageCodes, []);
  assert.deepEqual(transcriptionSetup(dedicatedModel, "", "zh-CN").generationConfig.audioTranscriptionConfig.languageCodes, ["cmn-Hans-CN"]);
  assert.deepEqual(transcriptionSetup(dedicatedModel, "", "ja-JP").generationConfig.audioTranscriptionConfig.languageCodes, ["ja-JP"]);
});

test("native annotation validation preserves silence and rejects absent, malformed or out-of-range timing", () => {
  assert.deepEqual(parseNativeTranscript([{ audioTranscription: { words: [] } }], 3), []);
  assert.throws(() => parseNativeTranscript([{ text: "Speech without timestamps" }], 3), /without the requested timestamps/);
  for (const words of [null, [{ word: "Hi", startOffset: "-1s", endOffset: "1s" }], [{ word: "Hi", startOffset: "2s", endOffset: "1s" }], [{ word: "Hi", startOffset: "0s", endOffset: "20s" }], [{ word: "Hi", startOffset: "0s" }]]) assert.throws(() => parseNativeTranscript([{ audioTranscription: { words } }], 3));
  const result = parseNativeTranscript([{ audioTranscription: { words: [{ word: "你", startOffset: "0s", endOffset: "0.2s" }, { word: "好", startOffset: "0.2s", endOffset: "0.4s" }, { word: "。", startOffset: "0.4s", endOffset: "0.5s" }, { word: "Next", startOffset: "2s", endOffset: "2.5s" }] } }], 3);
  assert.deepEqual(result.map((segment) => segment.text), ["你好。", "Next"]);
});

test("a native transcription quota can fall back to Flash's JSON adapter without confusing formats", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).includes("gemini-3.5-transcribe")) return Response.json({ error: { message: "Daily quota exceeded" } }, { status: 429 });
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"segments":[{"start":0,"end":1,"text":"Hi"}]}' }] } }] });
  };
  try {
    const result = await withModelFallback(candidates("audio", recommended, [dedicatedModel, ...models]), (model) => transcribeAudio("key", model, new Blob(["abc"], { type: "audio/wav" }), "", "en-US", 2));
    assert.equal(result.model.name, "gemini-3.8-flash");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.generationConfig.audioTranscriptionConfig.wordTimestamp, true);
    assert.equal(calls[1].body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(result.value, [{ start: 0, end: 1, text: "Hi" }]);
  } finally { globalThis.fetch = original; }
});
