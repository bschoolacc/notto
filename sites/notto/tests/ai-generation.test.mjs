import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerationPrompt, generateWithGemini, listGeminiModels, MODE_PROMPTS, ProviderError } from "../app/ai.ts";

const realisticSource = {
  noteId: "lecture-1",
  noteTitle: "Neural Networks: Backpropagation",
  mode: "study",
  start: 0,
  end: 180,
  chunks: [
    { id: "c1", start: 0, end: 60, text: "Today we derive gradient descent. The loss is one half times y hat minus y squared." },
    { id: "c2", start: 60, end: 120, text: "Using the chain rule, the gradient flows backward through each layer. Theta is updated by subtracting eta times the gradient." },
    { id: "c3", start: 120, end: 180, text: "For example, with a learning rate of zero point zero one, large gradients can make training unstable. Review the derivation before Friday." },
  ],
  typedNotes: [{ id: "n1", time: 87, text: "Exam: explain why the chain rule connects the layers." }],
};

test("each complete prompt contains timestamps, transcript, typed notes, and flexible-section rules", () => {
  for (const mode of ["quick", "concise", "study"]) {
    const prompt = buildGenerationPrompt({ ...realisticSource, mode });
    assert.ok(prompt.includes(MODE_PROMPTS[mode]));
    assert.ok(prompt.includes("[00:00–01:00]"));
    assert.ok(prompt.includes("[01:27] Exam: explain why the chain rule"));
    assert.ok(prompt.includes("Source end: 03:00"));
    assert.ok(prompt.includes("Omit every optional heading"));
    assert.ok(prompt.includes("Action Items"));
  }
});

test("Gemini model listing is live-shaped, filtered, and stable text models rank first", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ models: [
    { name: "models/gemini-flash-stable", displayName: "Gemini Flash", inputTokenLimit: 1000000, outputTokenLimit: 8192, supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-flash-lite", displayName: "Gemini Flash Lite", inputTokenLimit: 1000000, outputTokenLimit: 8192, supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", displayName: "Embedding", inputTokenLimit: 2048, supportedGenerationMethods: ["embedContent"] },
  ] }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const models = await listGeminiModels("test-key");
    assert.deepEqual(models.map((model) => model.name), ["gemini-flash-stable", "gemini-flash-lite"]);
  } finally { global.fetch = originalFetch; }
});

test("generated notes are exactly Gemini's response and the full source is sent", async () => {
  const originalFetch = global.fetch;
  const returned = "## Detailed Study Guide\n\n### Core idea\n\nBackpropagation applies the chain rule.\n\n### Action Items\n\n- [ ] Review the derivation before Friday.";
  let generationPrompt = "";
  global.fetch = async (url, init) => {
    if (String(url).endsWith(":countTokens")) return new Response(JSON.stringify({ totalTokens: 900 }), { status: 200, headers: { "Content-Type": "application/json" } });
    const body = JSON.parse(init.body);
    generationPrompt = body.contents[0].parts[0].text;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: returned }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await generateWithGemini("test-key", { name: "gemini-flash-stable", displayName: "Gemini Flash", description: "", inputTokenLimit: 1000000, outputTokenLimit: 8192, preview: false }, realisticSource);
    assert.equal(result.source, returned);
    assert.ok(generationPrompt.includes(realisticSource.chunks[0].text));
    assert.ok(generationPrompt.includes(realisticSource.chunks[2].text));
    assert.ok(generationPrompt.includes(realisticSource.typedNotes[0].text));
  } finally { global.fetch = originalFetch; }
});

test("provider errors never produce fallback notes or expose the key", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "API key not valid" } }), { status: 400, headers: { "Content-Type": "application/json" } });
  try {
    await assert.rejects(() => listGeminiModels("secret-test-key"), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, "invalid_key");
      assert.ok(!error.message.includes("secret-test-key"));
      return true;
    });
  } finally { global.fetch = originalFetch; }
});

test("an already-cancelled request sends no provider calls", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error("should not run"); };
  const controller = new AbortController(); controller.abort();
  try {
    await assert.rejects(() => listGeminiModels("test-key", controller.signal), (error) => error.code === "cancelled");
    assert.equal(calls, 0);
  } finally { global.fetch = originalFetch; }
});

test("cancel interrupts rate-limit backoff instead of starting another request", async () => {
  const originalFetch = global.fetch;
  const controller = new AbortController();
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    setTimeout(() => controller.abort(), 10);
    return new Response(JSON.stringify({ error: { message: "Too many requests" } }), { status: 429 });
  };
  try {
    await assert.rejects(() => listGeminiModels("test-key", controller.signal), (error) => error.code === "cancelled");
    assert.equal(calls, 1);
  } finally { global.fetch = originalFetch; }
});

test("nontransient client errors are not retried", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return new Response("{}", { status: 400 }); };
  try {
    await assert.rejects(() => listGeminiModels("test-key"), ProviderError);
    assert.equal(calls, 1);
  } finally { global.fetch = originalFetch; }
});

test("truncated output is never accepted as a complete saved summary", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith(":countTokens") ? { totalTokens: 900 } : { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "## Action Items\n- Partial response" }] } }] }), { status: 200 });
  try {
    await assert.rejects(() => generateWithGemini("test-key", { name: "flash", displayName: "Flash", description: "", inputTokenLimit: 1000000, outputTokenLimit: 8192, preview: false }, realisticSource), (error) => error.code === "empty_response" && /incomplete/.test(error.message));
  } finally { global.fetch = originalFetch; }
});

test("model thought parts do not enter lecture notes", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith(":countTokens") ? { totalTokens: 900 } : { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "internal reasoning", thought: true }, { text: "## Action Items\nNo explicit action items were mentioned." }] } }] }), { status: 200 });
  try {
    const result = await generateWithGemini("test-key", { name: "flash", displayName: "Flash", description: "", inputTokenLimit: 1000000, outputTokenLimit: 8192, preview: false }, realisticSource);
    assert.ok(!result.source.includes("internal reasoning"));
  } finally { global.fetch = originalFetch; }
});

test("multi-stage extraction includes typed notes in gaps between transcript chunks", async () => {
  const originalFetch = global.fetch;
  const prompts = [];
  let counts = 0;
  global.fetch = async (url, init) => {
    const text = JSON.parse(init.body).contents[0].parts[0].text;
    if (String(url).endsWith(":countTokens")) return new Response(JSON.stringify({ totalTokens: ++counts === 1 ? 40000 : 900 }), { status: 200 });
    prompts.push(text);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "## Action Items\nNo explicit action items were mentioned." }] } }] }), { status: 200 });
  };
  try {
    const source = { ...realisticSource, chunks: [{ id: "a", start: 0, end: 60, text: "a".repeat(60000) }, { id: "b", start: 120, end: 180, text: "b".repeat(60000) }], typedNotes: [{ id: "gap", time: 90, text: "GAP_NOTE_MUST_SURVIVE" }] };
    const result = await generateWithGemini("test-key", { name: "flash", displayName: "Flash", description: "", inputTokenLimit: 20000, outputTokenLimit: 8192, preview: false }, source);
    assert.equal(result.usedMultiStage, true);
    assert.equal(prompts.filter((prompt) => prompt.includes("GAP_NOTE_MUST_SURVIVE")).length, 1);
  } finally { global.fetch = originalFetch; }
});

test("model pagination includes later pages, deduplicates names, and escapes page tokens", async () => {
  const originalFetch=global.fetch; const calls=[];
  global.fetch=async (url)=>{ calls.push(String(url)); return new Response(JSON.stringify(calls.length===1?{models:[{name:"models/flash-a",inputTokenLimit:100000,supportedGenerationMethods:["generateContent"]}],nextPageToken:"next&token"}:{models:[{name:"models/flash-a",inputTokenLimit:100000,supportedGenerationMethods:["generateContent"]},{name:"models/flash-b",inputTokenLimit:100000,supportedGenerationMethods:["generateContent"]}]})); };
  try { const result=await listGeminiModels("test-key"); assert.equal(result.length,2); assert.ok(calls[1].includes("pageToken=next%26token")); } finally { global.fetch=originalFetch; }
});

test("repeated model pagination tokens stop instead of looping forever", async () => {
  const originalFetch=global.fetch; let calls=0;
  global.fetch=async()=>{calls++; return new Response(JSON.stringify({models:[],nextPageToken:"same"}));};
  try { await assert.rejects(()=>listGeminiModels("test-key"),error=>error.code==="provider"); assert.equal(calls,2); } finally {global.fetch=originalFetch;}
});

test("oversized repair does not send a generation request outside the context budget", async () => {
  const originalFetch=global.fetch; let counts=0; let generations=0;
  global.fetch=async(url)=>{if(String(url).endsWith(":countTokens"))return new Response(JSON.stringify({totalTokens:++counts===1?900:9999999})); generations++; return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"A draft without its required section."}]}}]}));};
  try {await assert.rejects(()=>generateWithGemini("test-key",{name:"flash",displayName:"Flash",description:"",inputTokenLimit:100000,outputTokenLimit:8192,preview:false},realisticSource),error=>error.code==="context_too_large"); assert.equal(generations,1);}finally{global.fetch=originalFetch;}
});

test("a legitimate fenced code block survives inside generated Markdown",async()=>{
  const originalFetch=global.fetch; const source='```text\nRecall the formula\n```\n\n## Action Items\nNo explicit action items were mentioned.';
  global.fetch=async(url)=>new Response(JSON.stringify(String(url).endsWith(":countTokens")?{totalTokens:900}:{candidates:[{finishReason:"STOP",content:{parts:[{text:source}]}}]}));
  try{const result=await generateWithGemini("test-key",{name:"flash",displayName:"Flash",description:"",inputTokenLimit:100000,outputTokenLimit:8192,preview:false},realisticSource);assert.equal(result.source,source);}finally{global.fetch=originalFetch;}
});
