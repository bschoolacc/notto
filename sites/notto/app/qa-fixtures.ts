import { ProviderError, type AIProviderAdapter } from "./ai";
import type { Note } from "./note-storage";
import { qaScenario } from "./browser-keys";

// Explicit development fixtures. Production never substitutes a live provider.
export function qaFixtures() {
  const scenario = qaScenario();
  if (!scenario) return null;
  const seed: Note = {
    id: "qa-lecture", title: "The science of better learning", createdAt: 1790880000000, updatedAt: 1790880000000, summarizedThrough: 0,
    chunks: [{ id: "qa-chunk", start: 0, end: 60, text: "Retrieval practice strengthens memory by asking you to recall a concept without looking at the answer. Space practice across several days. Compare a confident guess with the original evidence. Complete three practice questions before Friday." }],
    typedNotes: [{ id: "qa-thought", time: 20, text: "Ask how spacing changes when the exam is next week.\nTry a short recall quiz after each lecture." }], summaries: [],
  };
  class FixtureRecognition {
    continuous = true; interimResults = true; lang = "en-US";
    onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    timer: ReturnType<typeof setTimeout> | null = null;
    start() { this.timer = setTimeout(() => { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Practice retrieving the idea, then check your answer against the lecture." } }] }); }, 700); }
    stop() { if (this.timer) clearTimeout(this.timer); this.onend?.(); }
  }
  const contexts: AudioContext[] = [];
  const provider: AIProviderAdapter = {
    id: "gemini", label: "Development fixture",
    async listModels(key, signal) {
      if (signal?.aborted) throw new ProviderError("cancelled", "Cancelled.");
      if (key === "bad-key") throw new ProviderError("invalid_key", "Gemini rejected this API key. Check the key in Google AI Studio and try again.");
      return [{ name: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash (QA fixture)", description: "Simulated response, development only", inputTokenLimit: 1000000, outputTokenLimit: 8000, preview: false }];
    },
    async generate(key, _model, snapshot, signal, progress) {
      progress?.("Checking source size…");
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(new ProviderError("cancelled", "Generation was cancelled. The source range is ready to retry.")); return; }
        const abort = () => { clearTimeout(timer); reject(new ProviderError("cancelled", "Generation was cancelled. The source range is ready to retry.")); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, scenario === "slow" ? 12000 : 700);
        signal?.addEventListener("abort", abort, { once: true });
      });
      if (key === "rate-limit") throw new ProviderError("rate_limit", "Gemini is rate-limiting this project. Wait a moment, then retry.");
      return { inputTokens: 160, usedMultiStage: false, source: `# ${snapshot.mode === "study" ? "Learning that lasts" : snapshot.mode === "concise" ? "Lecture notes" : "Current topic"}\n\n**Retrieval practice** and spaced review make the study process active.\n\n## Key ideas\n\n- Recall the idea before checking the source.\n  - Compare your answer with the evidence.\n- Space practice across several days.\n\n| Practice | Purpose |\n| --- | --- |\n| Recall quiz | Test retrieval |\n| Spaced review | Revisit over time |\n\nThe example relationship is $R(t)=e^{-t/S}$.\n\n> Check confident guesses against the lecture.\n\n\`\`\`text\nRecall → check → repeat\n\`\`\`\n\n## Action Items\n\n- [ ] Complete three practice questions before Friday.` };
    },
  };
  return {
    scenario, notes: scenario === "empty" || scenario === "mic-error" ? [] : [seed], provider, SpeechRecognition: FixtureRecognition,
    async transcribe(key: string, signal: AbortSignal) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error("Transcription cancelled.")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, scenario === "slow" ? 12000 : 700);
        if (signal.aborted) { abort(); return; }
        signal.addEventListener("abort", abort, { once: true });
      });
      if (key === "rate-limit") throw new ProviderError("rate_limit", "Gemini is rate-limiting this project. Wait a moment, then retry.");
      return [{ start: 0, end: 1, text: "This is a development transcript fixture for testing the review workflow." }];
    },
    sampleBackup() { return new File([JSON.stringify({ format: "notto-notebook", version: 1, notes: [{ ...seed, id: "qa-restored", title: "Restored sample lecture" }] })], "sample-notebook.json", { type: "application/json" }); },
    sampleAudio() {
      const bytes = new ArrayBuffer(44 + 16000 * 2); const view = new DataView(bytes);
      const text = (offset: number, value: string) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
      text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, 32000, true);
      for (let index = 0; index < 16000; index++) view.setInt16(44 + index * 2, Math.sin(index * 440 * Math.PI * 2 / 16000) * 1000, true);
      return new File([bytes], "sample-lecture.wav", { type: "audio/wav" });
    },
    async getUserMedia() {
      if (scenario === "mic-error") throw new DOMException("Permission denied", "NotAllowedError");
      const context = new AudioContext(); contexts.push(context);
      const oscillator = context.createOscillator(); oscillator.frequency.value = 440;
      const gain = context.createGain(); gain.gain.value = 0.03;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      return destination.stream;
    },
    dispose() { contexts.forEach((context) => void context.close().catch(() => {})); },
  };
}
